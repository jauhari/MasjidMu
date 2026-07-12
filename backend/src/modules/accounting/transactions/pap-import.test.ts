import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parsePAPExcel, reconcilePAPReviewRows } from './pap-import.js';

describe('parsePAPExcel', () => {
  it('parses PAP rows, skips blanks/footer totals, and keeps source metadata', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('PAP');
    sheet.addRow(['LAPORAN PENERIMAAN DAN PENGELUARAN']);
    sheet.addRow([]);
    sheet.addRow(['Tanggal', 'Uraian', 'No Bukti', 'Masuk', 'Keluar', 'Saldo']);
    sheet.addRow([new Date(Date.UTC(2026, 0, 1)), 'Saldo awal', 'REF-000', 1000, null, 1000]);
    sheet.addRow(['02/01/2026', 'Infak Jumat', 'REF-001', 'Rp 1.250.000', null, 1251000]);
    sheet.addRow(['03/01/2026', 'Listrik', 'REF-002', null, '250.000', 1001000]);
    sheet.addRow([]);
    sheet.addRow([null, 'TOTAL', null, { formula: 'SUM(D4:D6)', result: 1251000 }, 250000, 1001000]);

    const buffer = await workbook.xlsx.writeBuffer();
    const result = await parsePAPExcel(new Uint8Array(buffer));

    expect(result.source).toMatchObject({ kind: 'excel', sheetName: 'PAP', headerRow: 3 });
    expect(result.source.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((row) => [row.direction, row.amount])).toEqual([
      ['income', '1000.00'],
      ['income', '1250000.00'],
      ['expense', '250000.00'],
    ]);
    expect(result.rows[1]).toMatchObject({
      date: '2026-01-02',
      referenceNo: 'REF-001',
      writtenBalance: '1251000.00',
      warnings: [],
      source: { row: 5, ref: 'PAP!A5:F5' },
    });
    expect(result.rows[1]!.source.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.totals).toEqual({
      income: '1251000.00',
      expense: '250000.00',
      net: '1001000.00',
      finalWrittenBalance: '1001000.00',
    });
    expect(result.warnings).toEqual([]);
  });

  it('adds deterministic running-balance reconciliation warnings', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('PAP');
    sheet.addRow(['Tanggal', 'Uraian', 'No Bukti', 'Masuk', 'Keluar', 'Saldo']);
    sheet.addRow(['01/01/2026', 'Awal', 'A', 1000, null, 1000]);
    sheet.addRow(['02/01/2026', 'Belanja', 'B', null, 200, 900]);

    const result = await parsePAPExcel(new Uint8Array(await workbook.xlsx.writeBuffer()));
    expect(result.rows[1]!.warnings).toEqual([
      'saldo berjalan tidak cocok: tertulis 900.00, seharusnya 800.00',
    ]);
    expect(reconcilePAPReviewRows(result.rows)).toEqual(result.rows);
  });
});
