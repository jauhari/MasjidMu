import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseImportFile } from './import.js';

describe('parseImportFile strict normalization', () => {
  it('reports invalid amounts while preserving empty amount cells as zero', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('JURNAL');
    sheet.addRow(['Tanggal', 'Keterangan', 'Akun', 'Debit', 'Kredit']);
    sheet.addRow(['01/02/2026', 'Valid', 'Kas', '1.000', null]);
    sheet.addRow(['01/02/2026', 'Valid', 'Pendapatan', null, '1.000']);
    sheet.addRow(['02/02/2026', 'Invalid', 'Kas', '-500', null]);

    const result = await parseImportFile(new Uint8Array(await workbook.xlsx.writeBuffer()));

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      date: '2026-02-01',
      totalDebit: '1000.00',
      totalCredit: '1000.00',
      balanced: true,
    });
    expect(result.errors).toEqual([{ row: 4, message: 'debit: jumlah tidak boleh negatif' }]);
  });

  it('strictly rejects rollover dates', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('JURNAL');
    sheet.addRow(['Tanggal', 'Keterangan', 'Akun Debet', 'Akun Kredit', 'Jumlah']);
    sheet.addRow(['31/02/2026', 'Invalid date', 'Kas', 'Pendapatan', 1000]);

    const result = await parseImportFile(new Uint8Array(await workbook.xlsx.writeBuffer()));

    expect(result.groups).toEqual([]);
    expect(result.errors).toEqual([{ row: 2, message: 'tanggal tidak valid: 31/02/2026' }]);
  });
});
