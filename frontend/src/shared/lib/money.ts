/**
 * Format & parse nominal uang (IDR / akuntansi Indonesia).
 *
 * Display:  1.793.000   |  1.793.000,50
 * Canonical (model): "1793000" | "1793000.5"
 *
 * Aturan input:
 *   - titik (.) = pemisah ribuan
 *   - koma (,)  = desimal
 *   - "10.000+25.000" = penjumlahan pintar
 */

/** Format canonical number → tampilan id-ID (titik ribuan, koma desimal). */
export function formatMoneyInput(
  value: string | number | null | undefined,
  opts?: { allowZero?: boolean; emptyAsZero?: boolean },
): string {
  if (value === null || value === undefined || value === '') {
    return opts?.emptyAsZero ? '0' : '';
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '';
  if (n === 0 && !opts?.allowZero && !opts?.emptyAsZero) return '';
  return new Intl.NumberFormat('id-ID', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(n);
}

/**
 * Parse string input user → canonical digit string (atau '' jika kosong/invalid).
 * Menerima: "1.793.000", "1793000", "Rp 1.793.000", "10.000+5.000", "1.500,5"
 */
export function parseMoneyInput(raw: string, opts?: { allowZero?: boolean }): string {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s) return '';

  // Buang prefix mata uang
  s = s.replace(/^Rp\.?\s*/i, '').trim();
  if (!s) return '';

  // Penjumlahan pintar: 10.000+25.000+500
  if (s.includes('+')) {
    const parts = s.split('+').map((p) => parseMoneyInput(p.trim(), { allowZero: true }));
    if (parts.every((p) => p !== '' && Number.isFinite(Number(p)))) {
      const sum = parts.reduce((a, p) => a + Number(p), 0);
      if (sum === 0 && !opts?.allowZero) return '';
      return normalizeCanonical(sum);
    }
  }

  // Hanya izinkan digit, titik, koma, spasi
  s = s.replace(/[^\d.,\s]/g, '').replace(/\s/g, '');
  if (!s) return '';

  // Deteksi format ID: titik ribuan, koma desimal
  // "1.793.000,50" → hapus titik, koma → titik
  // "1793000,5"    → koma → titik
  // "1.793.000"    → hapus titik
  // "1793.5" (EN)  → jarang di ID; jika 1 titik & ≤2 digit di belakang, anggap desimal
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if ((s.match(/\./g) ?? []).length > 1) {
    // Multiple dots → thousand separators
    s = s.replace(/\./g, '');
  } else if ((s.match(/\./g) ?? []).length === 1) {
    const [a, b] = s.split('.');
    // 1.793 (3 digits after) more likely thousands incomplete; 1.5 = decimal
    if (b && b.length === 3 && a && a.length <= 3) {
      // Ambiguous "1.793" — treat as thousands (1793) for ID typing flow
      s = a + b;
    } else if (b && b.length <= 2) {
      // decimal
      s = `${a}.${b}`;
    } else {
      s = s.replace(/\./g, '');
    }
  }

  const n = parseFloat(s);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n === 0 && !opts?.allowZero) return '';
  return normalizeCanonical(n);
}

function normalizeCanonical(n: number): string {
  // Hindari "1793000.00" → "1793000"; simpan max 2 desimal
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100);
}

/** Format untuk label/bantuan (dengan Rp). */
export function formatMoneyLabel(value: string | number | null | undefined): string {
  const f = formatMoneyInput(value, { allowZero: true });
  if (!f) return 'Rp 0';
  return `Rp ${f}`;
}
