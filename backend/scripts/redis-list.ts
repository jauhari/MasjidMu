import { redis } from '../src/lib/redis.js';
const all = await redis.keys('*');
console.log('total keys:', all.length);
console.log(all);
