/**
 * Generate a category code from a human-readable name + direction.
 *
 *   generateCategoryCode('ATK', 'expense')         → 'EXP_ATK'
 *   generateCategoryCode('Infaq Jumat', 'income')  → 'INC_INFAQ_JUMAT'
 *   generateCategoryCode('Beli Air & Listrik', 'expense')
 *                                                  → 'EXP_BELI_AIR_LISTRIK'
 *
 * Rules:
 *   - Strip diacritics (kept ASCII-friendly for code stores).
 *   - Uppercase.
 *   - Replace any run of non-alphanumeric chars with `_`.
 *   - Trim leading/trailing `_`.
 *   - Cap to 50 chars (matches DB column).
 *
 * Returns empty string when name is blank, so callers can decide whether to
 * keep an existing user-edited code untouched.
 */
export type CategoryDirection = 'income' | 'expense';

const PREFIX: Record<CategoryDirection, string> = {
  income: 'INC',
  expense: 'EXP',
};

export function slugifyToCode(s: string): string {
  return s
    .normalize('NFKD')
    // strip combining marks (è → e, etc.)
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function generateCategoryCode(name: string, direction: CategoryDirection): string {
  const slug = slugifyToCode(name);
  if (!slug) return '';
  const code = `${PREFIX[direction]}_${slug}`;
  return code.length > 50 ? code.slice(0, 50).replace(/_+$/, '') : code;
}
