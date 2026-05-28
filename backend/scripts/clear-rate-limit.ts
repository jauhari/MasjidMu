/**
 * Dev helper: clear all rate-limit keys in Redis. Useful when login attempts
 * lock you out during testing. Do not run in production.
 */
import { redis } from '../src/lib/redis.js';

async function main() {
  const prefixes = ['rl:login:*', 'rl:api:*', 'rl:export:*'];
  let total = 0;
  for (const p of prefixes) {
    const keys = await redis.keys(p);
    for (const k of keys) {
      await redis.del(k);
      total++;
    }
    console.log(`  ${p}: ${keys.length}`);
  }
  console.log(`\n✓ cleared ${total} rate-limit keys`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
