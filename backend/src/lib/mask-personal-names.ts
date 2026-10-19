/**
 * Best-effort masking of personal identifiers in free-text transaction
 * descriptions, for anything shown on a PUBLIC page.
 *
 * Bendahara descriptions routinely name donors/recipients after an
 * honorific ("Infaq Bu Rohmi", "Infaq B. Dalimah & B. ngatir", "Beli Buah
 * Untuk P. Ratno"). A name is masked to its first letter + "***"
 * ("Infaq Bu R***") so members can still see WHAT the money was for.
 *
 * This is a heuristic, not a guarantee: a name written with no honorific
 * ("Infaq Rohmi") is indistinguishable from any other word and passes
 * through. That is why callers must make showing descriptions an explicit
 * per-tenant opt-in rather than a default.
 */

/** Tokens (lower-cased, trailing dot kept) that introduce a person's name. */
const HONORIFICS = new Set([
  'bu', 'bu.', 'ibu', 'ibu.', 'bpk', 'bpk.', 'bapak', 'pak', 'pak.',
  'mbak', 'mas', 'kak', 'umi', 'abi', 'abah', 'mbah',
  'ustadz', 'ustadzah', 'ust', 'ust.', 'hj', 'hj.', 'dr.', 'drs.',
  // single-letter abbreviations only count WITH the dot ("B." = Bu, "P." = Pak)
  'b.', 'p.', 'h.',
]);

/** Function/context words that can sit right after an honorific without being a name. */
const NOT_A_NAME = new Set([
  'dan', 'atau', 'untuk', 'dari', 'ke', 'di', 'yang', 'dengan', 'rp',
  'sisa', 'acara', 'kegiatan', 'biaya', 'transport', 'konsumsi', 'snack', 'infaq',
]);

/** After the first name token, at most this many more capitalised tokens are treated as part of the name. */
const MAX_EXTRA_NAME_TOKENS = 2;

const TOKEN_RE = /^([^\p{L}]*)(\p{L}[\p{L}'’.-]*)([\s\S]*)$/u;

function isCapitalised(word: string): boolean {
  const c = word.charAt(0);
  return c !== c.toLowerCase();
}

function maskToken(lead: string, core: string, trail: string): string {
  return `${lead}${core.charAt(0)}***${trail}`;
}

function maskNameRuns(text: string): string {
  // Even indices = words, odd indices = the whitespace between them.
  const parts = text.split(/(\s+)/);
  for (let i = 0; i < parts.length; i += 2) {
    // "(Bu" / "Bu," -> "bu": ignore punctuation hugging the honorific.
    const word = parts[i]!.toLowerCase().replace(/^[^\p{L}]+/u, '').replace(/[,;:)]+$/, '');
    if (!HONORIFICS.has(word)) continue;

    let consumed = 0;
    for (let j = i + 2; j < parts.length && consumed <= MAX_EXTRA_NAME_TOKENS; j += 2) {
      const m = TOKEN_RE.exec(parts[j]!);
      if (!m) break;
      const [, lead, core, trail] = m as unknown as [string, string, string, string];
      const lower = core.toLowerCase();
      if (NOT_A_NAME.has(lower)) break;
      // The first token after the honorific is the name whatever its case
      // ("B. ngatir"); follow-on tokens only count when capitalised.
      if (consumed > 0 && !isCapitalised(core)) break;
      parts[j] = maskToken(lead, core, trail);
      consumed++;
      i = j; // outer loop resumes after the masked run
      if (trail) break; // punctuation ends the name ("Bu Rohmi," / "(Bu Rohmi)")
    }
  }
  return parts.join('');
}

const PHONE_RE = /(?:\+62|\b62|\b0)8\d[\d\s-]{7,12}\d/g;
const LONG_DIGITS_RE = /\b\d{9,}\b/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

const MAX_LENGTH = 140;

/** Returns null for empty input so callers can fall back to a category label. */
export function maskPublicDescription(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  let out = maskNameRuns(trimmed);
  out = out.replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[no. telp]').replace(LONG_DIGITS_RE, '[nomor]');
  return out.length > MAX_LENGTH ? `${out.slice(0, MAX_LENGTH - 1).trimEnd()}…` : out;
}
