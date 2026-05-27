/**
 * Smoke test: verify Upstash Redis connectivity.
 * Run: pnpm tsx scripts/redis-smoke.ts
 */
import { redis } from '../src/lib/redis.js';

async function main() {
  const key = `smoke-${Date.now()}`;
  console.log('1. SET...');
  await redis.set(key, 'ok', { ex: 60 });
  console.log('   ✓');

  console.log('2. GET...');
  const value = await redis.get(key);
  console.log(`   ✓ value: ${value}`);
  if (value !== 'ok') throw new Error(`Expected 'ok', got ${String(value)}`);

  console.log('3. EXPIRE check...');
  const ttl = await redis.ttl(key);
  console.log(`   ✓ ttl: ${ttl}s`);

  console.log('4. DEL...');
  await redis.del(key);
  console.log('   ✓');

  console.log('5. PING...');
  const ping = await redis.ping();
  console.log(`   ✓ ${ping}`);

  console.log('\n✅ Redis smoke test PASSED');
}

main().catch((e) => {
  console.error('❌ Redis smoke test failed:', e);
  process.exit(1);
});
