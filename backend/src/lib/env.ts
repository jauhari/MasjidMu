import { config } from 'dotenv';
import { z } from 'zod';

// Load .env.local first (highest priority for local dev), then .env as fallback
config({ path: '.env.local' });
config({ path: '.env' });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'preview', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  DATABASE_URL: z.string().url(),
  // Optional owner-level URL for migrations and DDL ops. App code uses
  // DATABASE_URL (NOBYPASSRLS); migrations may use DATABASE_URL_OWNER.
  DATABASE_URL_OWNER: z.string().url().optional(),

  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be ≥ 32 chars'),
  BETTER_AUTH_URL: z.string().url(),

  UPSTASH_REDIS_URL: z.string().url(),
  UPSTASH_REDIS_TOKEN: z.string().min(1),

  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY: z.string().min(1),
  R2_SECRET_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),

  RESEND_API_KEY: z.string().startsWith('re_').or(z.literal('re_test')),

  SENTRY_DSN: z.string().url().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
