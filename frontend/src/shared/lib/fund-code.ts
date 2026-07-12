/**
 * Generate fund code following HisabMu / PSAK conventions.
 *
 * System seeds use short codes: UMUM, ZKT, INF, AML, NHL, WKF.
 * Custom (program/kampanye) codes use the same type prefix + slug:
 *
 *   generateFundCode('Program Ambulans', 'infaq_sedekah') → 'INF-AMBULANS'
 *   generateFundCode('Infaq Rutin PAP', 'infaq_sedekah')  → 'INF-PAP'
 *   generateFundCode('Zakat Fitrah Khusus', 'zakat')      → 'ZKT-FITRAH'
 *
 * Rules:
 *   - Prefix = PSAK type code (aligned with system seeds)
 *   - Slug from name: strip diacritics, stopwords, uppercase
 *   - Separator `-` between prefix and slug tokens
 *   - Max 20 chars (DB / API limit)
 *   - ensureUniqueFundCode() appends -2, -3… on collision
 */

export type FundTypeCode =
  | 'zakat'
  | 'infaq_sedekah'
  | 'amil'
  | 'nonhalal'
  | 'wakaf'
  | 'umum';

const TYPE_PREFIX: Record<FundTypeCode, string> = {
  zakat: 'ZKT',
  infaq_sedekah: 'INF',
  amil: 'AML',
  nonhalal: 'NHL',
  wakaf: 'WKF',
  umum: 'UMUM',
};

/** Words that rarely help uniqueness in fund names. */
const STOP = new Set([
  'DANA',
  'PROGRAM',
  'INFAQ',
  'INFAK',
  'SEDEKAH',
  'SEDEKAH',
  'ZAKAT',
  'WAKAF',
  'AMIL',
  'RUTIN',
  'UNTUK',
  'DARI',
  'DAN',
  'YANG',
  'THE',
  'OF',
  'A',
  'AN',
  'AND',
  'UNTUK',
  'KE',
  'DI',
  'PADA',
  'OLEH',
  'BAGI',
  'KHUSUS',
  'MASJID',
]);

function slugifyToken(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .trim();
}

/**
 * Build base code from name + fund type (no uniqueness suffix).
 */
export function generateFundCode(name: string, fundType: FundTypeCode): string {
  const prefix = TYPE_PREFIX[fundType] ?? 'PRG';
  const raw = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]+/g, ' ')
    .trim();

  if (!raw) return prefix;

  const tokens = raw
    .split(/\s+/)
    .map(slugifyToken)
    .filter((t) => t.length > 0 && !STOP.has(t));

  // Prefer meaningful tokens; if all stopwords, fall back to first word(s) of raw.
  const usable =
    tokens.length > 0
      ? tokens
      : raw
          .split(/\s+/)
          .map(slugifyToken)
          .filter(Boolean);

  // Keep at most 2 tokens for readability within 20-char budget.
  const slugParts = usable.slice(0, 2);
  if (slugParts.length === 0) return prefix;

  let code = `${prefix}-${slugParts.join('-')}`;
  if (code.length > 20) {
    // Truncate slug portion only
    const budget = 20 - prefix.length - 1;
    const joined = slugParts.join('-').slice(0, Math.max(3, budget)).replace(/-+$/, '');
    code = `${prefix}-${joined}`;
  }
  return code;
}

/**
 * Ensure code is unique among existing codes (case-insensitive).
 * Appends -2, -3… while staying ≤ 20 chars.
 */
export function ensureUniqueFundCode(base: string, existing: Iterable<string>): string {
  const taken = new Set([...existing].map((c) => c.toUpperCase()));
  if (!taken.has(base.toUpperCase())) return base;

  for (let n = 2; n < 100; n++) {
    const suffix = `-${n}`;
    const head = base.slice(0, Math.max(1, 20 - suffix.length)).replace(/-+$/, '');
    const candidate = `${head}${suffix}`;
    if (!taken.has(candidate.toUpperCase())) return candidate;
  }
  return `${base.slice(0, 16)}-${Date.now().toString(36).slice(-3).toUpperCase()}`;
}
