/**
 * Self-service registration — unauthenticated endpoint.
 *
 *   POST /api/register
 *
 * Creates a new tenant + first admin user in one atomic call:
 *   1. Create tenant (auto-generate slug from name)
 *   2. Seed default chart of accounts + funds
 *   3. Sign up via better-auth (email + password)
 *   4. Create app-side `users` row mapping auth user → tenant
 *   5. Create per-tenant `admin` role with all permissions
 *   6. Grant admin role to the new user
 *
 * Must be registered BEFORE the session/tenant/permission middleware
 * in app.ts — this is a public, unauthenticated endpoint.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { asSuperAdmin, withTenant } from '../../../db/client.js';
import {
  tenants,
  users,
  roles,
  permissions,
  rolePermissions,
  userRoles,
} from '../../../db/schema/core.js';
import { auth } from '../../../lib/auth.js';
import { ensureUserMapping } from '../../../lib/user-mapping.js';
import { seedDefaultChart } from '../../accounting/accounts/service.js';
import { fundSeedOptionsForEdition, seedFunds } from '../../accounting/funds/service.js';
import { logger } from '../../../lib/logger.js';
import { rateLimit } from '../../../middleware/rate-limit.js';

const editionEnum = z.enum(['masjid', 'laz', 'pesantren', 'yayasan']);

const registerSchema = z
  .object({
    name: z.string().min(2, 'Nama harus minimal 2 karakter').max(200),
    email: z.string().email('Email tidak valid'),
    password: z.string().min(8, 'Kata sandi harus minimal 8 karakter'),
    tenantName: z.string().min(2, 'Nama lembaga harus minimal 2 karakter').max(200),
    edition: editionEnum.optional(),
  });

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63);
}

export const registerRoute = new Hono()
  .use('*', rateLimit('login'))
  .post('/', zValidator('json', registerSchema), async (c) => {
    const body = c.req.valid('json');
    const normalizedEmail = body.email.toLowerCase().trim();

    // 1. Check email not already registered
    const existingUser = await asSuperAdmin(async (tx) => {
      const rows = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);
      return rows[0];
    });
    if (existingUser) {
      return c.json({ error: 'email_taken', detail: 'Email sudah terdaftar. Silakan masuk.' }, 409);
    }

    // 2. Generate unique slug
    let slug = slugify(body.tenantName);
    if (!slug || slug.length < 2) {
      slug = 'lembaga-' + Date.now().toString(36);
    }
    // Ensure uniqueness
    const slugTaken = await asSuperAdmin(async (tx) => {
      const rows = await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.slug, slug));
      return rows.length > 0;
    });
    if (slugTaken) {
      slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    }

    // 3. Create tenant
    const tenant = await asSuperAdmin(async (tx) => {
      const [t] = await tx
        .insert(tenants)
        .values({
          slug,
          name: body.tenantName,
          edition: body.edition ?? 'masjid',
        })
        .returning();
      return t!;
    });

    // 4. Seed default chart of accounts + funds
    try {
      await seedDefaultChart(tenant.id);
      const fundOpts = fundSeedOptionsForEdition(tenant.edition);
      if (fundOpts) {
        await withTenant(tenant.id, async (db) => seedFunds(tenant.id, fundOpts, db));
      }
    } catch (e) {
      logger.error({ err: e, tenantId: tenant.id }, 'register auto-seed failed (non-fatal)');
    }

    // 5. Create per-tenant roles (admin gets all permissions)
    const adminRole = await asSuperAdmin(async (tx) => {
      const allPerms = await tx.select().from(permissions);

      // Create admin role for this tenant
      const [admin] = await tx
        .insert(roles)
        .values({
          tenantId: tenant.id,
          code: 'admin',
          name: 'Admin',
          description: 'Admin lembaga — akses penuh',
          isSystem: false,
        })
        .returning();

      // Grant all permissions to admin
      if (admin && allPerms.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(allPerms.map((p) => ({ roleId: admin.id, permissionId: p.id })))
          .onConflictDoNothing();
      }

      // Create bendahara role with common permissions
      const bendaharaPerms = allPerms.filter(
        (p) =>
          p.code.startsWith('accounting.') ||
          p.code === 'reports.read' ||
          p.code === 'reports.export' ||
          p.code === 'profile.read' ||
          p.code.startsWith('content.'),
      );
      const [bendahara] = await tx
        .insert(roles)
        .values({
          tenantId: tenant.id,
          code: 'bendahara',
          name: 'Bendahara',
          description: 'Bendahara — akses pembukuan dan konten',
          isSystem: false,
        })
        .returning();
      if (bendahara && bendaharaPerms.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(bendaharaPerms.map((p) => ({ roleId: bendahara.id, permissionId: p.id })))
          .onConflictDoNothing();
      }

      return admin;
    });

    // 6. Sign up via better-auth
    let authUserId: string;
    try {
      const result = await auth.api.signUpEmail({
        body: {
          email: normalizedEmail,
          password: body.password,
          name: body.name,
        },
      });
      authUserId = result.user.id;
    } catch (e) {
      // If signup fails (e.g. email already in auth.user), try to find existing
      const msg = (e as Error).message;
      if (/already|exists|in use/i.test(msg)) {
        const found = await asSuperAdmin(async (tx) => {
          const r = await tx.execute<{ id: string }>(
            { sql: `SELECT id FROM "user" WHERE email = $1`, args: [normalizedEmail] } as any,
          );
          return r.rows[0]?.id;
        });
        if (!found) {
          // Clean up tenant
          await asSuperAdmin(async (tx) => {
            await tx.delete(tenants).where(eq(tenants.id, tenant.id));
          });
          return c.json({ error: 'signup_failed', detail: 'Gagal membuat akun. Coba lagi.' }, 500);
        }
        authUserId = found;
      } else {
        // Clean up tenant
        await asSuperAdmin(async (tx) => {
          await tx.delete(tenants).where(eq(tenants.id, tenant.id));
        });
        logger.error({ err: e }, 'better-auth signUpEmail failed');
        return c.json({ error: 'signup_failed', detail: 'Gagal membuat akun. Coba lagi.' }, 500);
      }
    }

    // 7. Create app-side user mapping
    const appUser = await ensureUserMapping(
      { id: authUserId, email: normalizedEmail, name: body.name },
      tenant.id,
    );

    // 8. Grant admin role to the new user
    if (adminRole) {
      await asSuperAdmin(async (tx) => {
        await tx
          .insert(userRoles)
          .values({ userId: appUser.id, roleId: adminRole.id })
          .onConflictDoNothing();
      });
    }

    // 9. Sign in (create session)
    try {
      const signInResult = await auth.api.signInEmail({
        body: {
          email: normalizedEmail,
          password: body.password,
        },
      });

      return c.json({
        ok: true,
        tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
        user: { id: signInResult.user.id, email: signInResult.user.email, name: signInResult.user.name },
        session: { token: signInResult.token },
      });
    } catch {
      // Sign-in failed but account was created — user can login manually
      return c.json({
        ok: true,
        needsLogin: true,
        tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      });
    }
  });
