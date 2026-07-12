/**
 * better-auth instance.
 *
 * Strategy:
 *   • Session cookies (not JWT) — instant logout via DB row delete
 *   • Per-subdomain cookie scope (no crossSubDomainCookies) — each masjid
 *     subdomain has its own session. Defense vs cross-tenant session leak.
 *   • Drizzle adapter writes to our existing `users` table; better-auth's
 *     own session/account tables get auto-created on first migrate.
 *   • organization plugin = multi-tenant native (member, role, invitation).
 *
 * Routes are mounted at `/api/auth/*` in app.ts via `auth.handler`.
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, organization } from 'better-auth/plugins';
import { db } from '../db/client.js';
import { env } from './env.js';

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),

  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,

  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    minPasswordLength: 8,
    requireEmailVerification: false, // flip to true once Resend wired
  },

  // Only wired up once both env vars are set (see lib/env.ts) — omitted
  // entirely otherwise so the client's "Login dengan Google" button gets a
  // clean "provider not configured" error instead of a broken flow.
  ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
        socialProviders: {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        },
      }
    : {}),

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7d refresh
    updateAge: 60 * 60 * 24, // refresh activity once per day
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5min in-memory cache to avoid DB hit per request
    },
  },

  advanced: {
    cookiePrefix: 'hisabmu',
    useSecureCookies: env.NODE_ENV === 'production',
    // crossSubDomainCookies INTENTIONALLY OMITTED — we want per-subdomain
    // scope. Super admin uses admin.hisabmu.id with separate flow.
  },

  trustedOrigins: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'https://hisabmu.id',
    'https://www.hisabmu.id',
    'https://admin.hisabmu.id',
    // Temporary — the actual production frontend until app.hisabmu.id (custom
    // domain) is set up. Remove once that's live.
    'https://hisabmu.pages.dev',
    // Wildcard subdomain authoritative origin matching is enforced via Hono
    // CORS regex in app.ts; better-auth gets a static list of canonical hosts.
  ],

  plugins: [
    admin(),
    organization({
      allowUserToCreateOrganization: false, // only super_admin provisions tenants
    }),
  ],
});

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;
