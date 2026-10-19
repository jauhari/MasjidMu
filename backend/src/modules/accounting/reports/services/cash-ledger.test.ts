import { describe, expect, it } from 'vitest';
import { assembleCashLedger, type EntryRow } from './cash-ledger.js';

/**
 * Real PCA Ponjong cash movements for July 2026 (opening = saldo at 30 Jun).
 * The expected saldo column is what the bendahara wrote by hand in the
 * physical cash book (Saldo/Jumlah column) -- the code must reproduce it.
 */
const JULY_OPENING = '7446000.00';
const JULY: { row: EntryRow; handwrittenSaldo: number }[] = [
  { row: { d: '2026-07-03', description: 'Infaq kaleng', category_name: 'Infaq Anggota & Donatur', net: '370000.00' }, handwrittenSaldo: 7_816_000 },
  { row: { d: '2026-07-03', description: 'kegiatan kemah', category_name: 'Beban Program & Kegiatan', net: '-300000.00' }, handwrittenSaldo: 7_516_000 },
  { row: { d: '2026-07-20', description: 'Infaq Bu Rohmi', category_name: 'Infaq Anggota & Donatur', net: '300000.00' }, handwrittenSaldo: 7_816_000 },
  { row: { d: '2026-07-20', description: 'Transport SWA', category_name: 'Beban Program & Kegiatan', net: '-300000.00' }, handwrittenSaldo: 7_516_000 },
  { row: { d: '2026-07-20', description: 'Snack parenting Rp 5000 x 185', category_name: 'Beban Program & Kegiatan', net: '-925000.00' }, handwrittenSaldo: 6_591_000 },
  { row: { d: '2026-07-20', description: 'Bueka 240ml 4 dus', category_name: 'Beban Program & Kegiatan', net: '-112000.00' }, handwrittenSaldo: 6_479_000 },
  { row: { d: '2026-07-20', description: 'Narasumber', category_name: 'Beban Program & Kegiatan', net: '-500000.00' }, handwrittenSaldo: 5_979_000 },
  { row: { d: '2026-07-20', description: 'Konsumsi Narasumber', category_name: 'Beban Program & Kegiatan', net: '-100000.00' }, handwrittenSaldo: 5_879_000 },
  { row: { d: '2026-07-20', description: 'Banner', category_name: 'Beban Program & Kegiatan', net: '-150000.00' }, handwrittenSaldo: 5_729_000 },
  { row: { d: '2026-07-26', description: 'Infaq Parenting', category_name: 'Infaq Anggota & Donatur', net: '681000.00' }, handwrittenSaldo: 6_410_000 },
];
const JULY_ROWS = JULY.map((j) => j.row);
const JULY_TOTALS = { totalMasuk: '1351000.00', totalKeluar: '2387000.00' };

describe('assembleCashLedger — July 2026 against the handwritten cash book', () => {
  const ledger = assembleCashLedger({ opening: JULY_OPENING, ...JULY_TOTALS, rows: JULY_ROWS, showDescriptions: false });

  it('reproduces every handwritten Saldo', () => {
    expect(ledger.entries.map((e) => Number(e.saldo))).toEqual(JULY.map((j) => j.handwrittenSaldo));
  });

  it('closing balance = opening + masuk - keluar = last saldo', () => {
    expect(ledger.openingBalance).toBe('7446000.00');
    expect(ledger.closingBalance).toBe('6410000.00');
    expect(ledger.entries.at(-1)!.saldo).toBe(ledger.closingBalance);
  });

  it('splits each movement into masuk or keluar, never both', () => {
    for (const e of ledger.entries) {
      expect(Number(e.masuk) > 0 && Number(e.keluar) > 0).toBe(false);
      expect(Number(e.masuk) + Number(e.keluar)).toBeGreaterThan(0);
    }
    expect(ledger.entries[0]).toMatchObject({ masuk: '370000.00', keluar: '0.00' });
    expect(ledger.entries[1]).toMatchObject({ masuk: '0.00', keluar: '300000.00' });
  });

  it('is not truncated and keeps the cash-book order', () => {
    expect(ledger.truncated).toBe(false);
    expect(ledger.entries.map((e) => e.date)).toEqual(JULY_ROWS.map((r) => r.d));
  });
});

describe('assembleCashLedger — keterangan and privacy switch', () => {
  const rows = JULY_ROWS;

  it('OFF (default): category name only — no description text leaks', () => {
    const l = assembleCashLedger({ opening: JULY_OPENING, ...JULY_TOTALS, rows, showDescriptions: false });
    expect(l.descriptionsVisible).toBe(false);
    expect(l.entries[2]!.keterangan).toBe('Infaq Anggota & Donatur');
    const blob = JSON.stringify(l);
    for (const leak of ['Rohmi', 'Transport SWA', 'Snack parenting', 'kemah']) expect(blob).not.toContain(leak);
  });

  it('ON: the description, with personal names masked', () => {
    const l = assembleCashLedger({ opening: JULY_OPENING, ...JULY_TOTALS, rows, showDescriptions: true });
    expect(l.descriptionsVisible).toBe(true);
    expect(l.entries[2]!.keterangan).toBe('Infaq Bu R***');
    expect(l.entries[3]!.keterangan).toBe('Transport SWA');
    expect(JSON.stringify(l)).not.toContain('Rohmi');
  });

  it('ON never changes any number', () => {
    const off = assembleCashLedger({ opening: JULY_OPENING, ...JULY_TOTALS, rows, showDescriptions: false });
    const on = assembleCashLedger({ opening: JULY_OPENING, ...JULY_TOTALS, rows, showDescriptions: true });
    expect(on.entries.map((e) => [e.date, e.masuk, e.keluar, e.saldo])).toEqual(
      off.entries.map((e) => [e.date, e.masuk, e.keluar, e.saldo]),
    );
  });

  it('falls back through description -> category -> generic label', () => {
    const l = assembleCashLedger({
      opening: '0',
      totalMasuk: '100.00',
      totalKeluar: '50.00',
      showDescriptions: true,
      rows: [
        { d: '2026-01-01', description: null, category_name: 'Infaq Anggota & Donatur', net: '100.00' },
        { d: '2026-01-02', description: '   ', category_name: null, net: '-50.00' },
        { d: '2026-01-03', description: null, category_name: null, net: '10.00' },
      ],
    });
    expect(l.entries.map((e) => e.keterangan)).toEqual(['Infaq Anggota & Donatur', 'Pengeluaran', 'Penerimaan']);
  });
});

describe('assembleCashLedger — edges', () => {
  it('empty period carries the opening balance through unchanged', () => {
    const l = assembleCashLedger({ opening: '6610000.00', totalMasuk: '0', totalKeluar: '0', rows: [], showDescriptions: false });
    expect(l.entries).toEqual([]);
    expect(l.openingBalance).toBe('6610000.00');
    expect(l.closingBalance).toBe('6610000.00');
    expect(l.truncated).toBe(false);
  });

  it('truncates past 1000 rows but derives the closing balance from the aggregate, not the rows', () => {
    const rows: EntryRow[] = Array.from({ length: 1001 }, (_, i) => ({
      d: '2026-01-01', description: `baris ${i}`, category_name: null, net: '1.00',
    }));
    const l = assembleCashLedger({ opening: '0', totalMasuk: '1001.00', totalKeluar: '0', rows, showDescriptions: false });
    expect(l.truncated).toBe(true);
    expect(l.entries).toHaveLength(1000);
    expect(l.entries.at(-1)!.saldo).toBe('1000.00');
    expect(l.closingBalance).toBe('1001.00'); // includes the row that was cut
  });

  it('handles a negative opening balance and decimals exactly', () => {
    const l = assembleCashLedger({
      opening: '-100.10', totalMasuk: '0.30', totalKeluar: '0',
      rows: [{ d: '2026-01-01', description: 'x', category_name: null, net: '0.10' }, { d: '2026-01-01', description: 'y', category_name: null, net: '0.20' }],
      showDescriptions: false,
    });
    expect(l.entries.map((e) => e.saldo)).toEqual(['-100.00', '-99.80']);
    expect(l.closingBalance).toBe('-99.80');
  });
});
