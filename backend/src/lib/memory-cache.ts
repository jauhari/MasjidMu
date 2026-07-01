/**
 * In-process TTL cache for local dev — avoids slow Upstash HTTP round-trips
 * that add 20–30s latency per API request on some networks.
 */

const store = new Map<string, { value: unknown; expiresAt: number }>();

export function memGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function memSet(key: string, value: unknown, ttlSec: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
}

export function memDel(key: string): void {
  store.delete(key);
}

export function memGetSet(key: string): string[] {
  const raw = memGet<string[]>(key);
  return raw ?? [];
}

export function memSadd(key: string, members: string[], ttlSec: number): void {
  const existing = new Set(memGetSet(key));
  for (const m of members) existing.add(m);
  memSet(key, [...existing], ttlSec);
}

export function memClearPrefix(prefix: string): number {
  let n = 0;
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      n++;
    }
  }
  return n;
}

export function memClear(): void {
  store.clear();
}