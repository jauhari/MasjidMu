/**
 * Shared slug helpers for content modules with `(tenantId, slug)` uniqueness.
 *
 * Keep tx-agnostic: pass in the existing scanner instead of fighting Drizzle's
 * generic types — the caller is already inside `withTenant(...)`.
 */

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 180) || 'item';
}

/**
 * Given a list of slugs already taken in this tenant (caller fetches once),
 * return `base` if free, else `base-2`, `base-3`, ...
 */
export function pickFreeSlug(takenSlugs: Iterable<string>, base: string): string {
  const candidate = base || 'item';
  const set = new Set(takenSlugs);
  if (!set.has(candidate)) return candidate;
  for (let i = 2; i < 1000; i++) {
    const next = `${candidate}-${i}`;
    if (!set.has(next)) return next;
  }
  return `${candidate}-${Date.now()}`;
}
