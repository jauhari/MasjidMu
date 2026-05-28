/**
 * Profil Masjid module — singleton per-tenant.
 *
 * Routes:
 *   GET    /api/v1/mosque-profile   read profile (auto-creates empty row if missing)
 *   PATCH  /api/v1/mosque-profile   update fields (partial)
 *
 * The row is created on first GET so the UI always has a stable id to PATCH against.
 * Tenant scoping via RLS through withTenant.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { withTenant } from '../../../db/client.js';
import { mosqueProfiles } from '../../../db/schema/organization.js';
import { requireSession, type SessionVars } from '../../../middleware/session.js';
import { requireTenant, type TenantVars } from '../../../middleware/tenant.js';
import { requirePermission, type PermissionVars } from '../../../middleware/permission.js';
import { auditInterceptor } from '../../../lib/audit.js';

const updateSchema = z.object({
  officialName: z.string().max(200).nullable().optional(),
  shortName: z.string().max(100).nullable().optional(),
  province: z.string().max(100).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  district: z.string().max(100).nullable().optional(),
  village: z.string().max(100).nullable().optional(),
  postalCode: z.string().max(10).nullable().optional(),
  addressDetail: z.string().nullable().optional(),
  latitude: z.string().max(30).nullable().optional(),
  longitude: z.string().max(30).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().email().max(255).nullable().optional(),
  website: z.string().url().max(255).nullable().optional(),
  youtubeUrl: z.string().url().max(255).nullable().optional(),
  facebookUrl: z.string().url().max(255).nullable().optional(),
  instagramUrl: z.string().url().max(255).nullable().optional(),
  tiktokUrl: z.string().url().max(255).nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  bannerUrl: z.string().url().nullable().optional(),
  bankName: z.string().max(100).nullable().optional(),
  bankAccountName: z.string().max(200).nullable().optional(),
  bankAccountNumber: z.string().max(50).nullable().optional(),
  history: z.string().nullable().optional(),
  vision: z.string().nullable().optional(),
  mission: z.string().nullable().optional(),
});

export const mosqueProfileRoute = new Hono<{
  Variables: SessionVars & TenantVars & PermissionVars;
}>()
  .use('*', requireSession())
  .use('*', requireTenant())
  .use('*', auditInterceptor())

  .get('/', requirePermission('profile.read'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const row = await withTenant(tenantId, async (tx) => {
      const r = await tx.select().from(mosqueProfiles).where(eq(mosqueProfiles.tenantId, tenantId));
      if (r[0]) return r[0];
      const [created] = await tx.insert(mosqueProfiles).values({ tenantId }).returning();
      return created!;
    });
    return c.json({ data: row });
  })

  .patch('/', requirePermission('profile.update'), zValidator('json', updateSchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const body = c.req.valid('json');
    const updated = await withTenant(tenantId, async (tx) => {
      const existing = await tx
        .select()
        .from(mosqueProfiles)
        .where(eq(mosqueProfiles.tenantId, tenantId));
      if (!existing[0]) {
        const [created] = await tx
          .insert(mosqueProfiles)
          .values({ tenantId, ...body })
          .returning();
        return created!;
      }
      const [r] = await tx
        .update(mosqueProfiles)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(mosqueProfiles.tenantId, tenantId))
        .returning();
      return r!;
    });
    return c.json({ data: updated });
  });
