import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });

export default defineConfig({
  schema: './src/db/schema/*.ts',
  out: './src/db/migrations/meta',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://placeholder',
  },
  verbose: true,
  strict: true,
  casing: 'snake_case',
});
