import { describe, expect, it } from 'vitest';
import { maskPublicDescription } from './mask-personal-names.js';

describe('maskPublicDescription — names after an honorific', () => {
  // Every case below is a real PCA Ponjong cash-book description.
  const cases: [string, string][] = [
    ['Infaq Bu Rohmi', 'Infaq Bu R***'],
    ['Infaq Bu Ana', 'Infaq Bu A***'],
    ['Infaq Bu Karsilah', 'Infaq Bu K***'],
    ['Infaq B. Latiyem', 'Infaq B. L***'],
    ['Infaq B. Sari', 'Infaq B. S***'],
    ['Infaq P. Sutrisno', 'Infaq P. S***'],
    ['Transport B. Sumarmi', 'Transport B. S***'],
    ['Infaq dari B. Yanti', 'Infaq dari B. Y***'],
    // two-token names ("Umi" is itself an honorific but here it is part of the name)
    ['Infaq B. Umi Syarifah', 'Infaq B. U*** S***'],
    ['Infaq dari B. Umi Fadhilah', 'Infaq dari B. U*** F***'],
    // several people in one line, and a lower-case name
    ['Infaq B. Dalimah & B. ngatir', 'Infaq B. D*** & B. n***'],
    ['Beli Buah Untuk P. Ratno & B. Suwarni @ Rp. 100.000', 'Beli Buah Untuk P. R*** & B. S*** @ Rp. 100.000'],
    // the name stops at the next lower-case word
    ['Terima dari Bu Dalimah sisa sumbangan Sumatra', 'Terima dari Bu D*** sisa sumbangan Sumatra'],
  ];
  it.each(cases)('%s', (input, expected) => {
    expect(maskPublicDescription(input)).toBe(expected);
  });
});

describe('maskPublicDescription — text that must stay readable', () => {
  const untouched = [
    'Infaq Anggota (Hamba Allah)',
    'Infaq kaleng',
    'Infaq Kencleng',
    'Infaq dari jamaah KBIHU',
    'Infaq dari Open Donasi',
    'Snack parenting Rp 5000 x 185',
    'Subsidi kegiatan gerak jalan PRA Genjahan',
    'Acara MHH di UMY 2 utusan @ Rp. 50.000',
    'Baksos Majelis Tabligh 5 Paket @ Rp. 50.000',
    'Transport Acara Gerak Jalan Wonosari',
    'Sisa Baitul Arqam Pimpinan dan Guru TK ABA 2026',
    'Dana dari Bendahara Lama',
    'Papan Nama',
    'Bagi hasil kaos Rihlah',
    'Infaq dr jamaah KBIHU', // "dr" here means "dari", not "dokter"
  ];
  it.each(untouched)('%s', (input) => {
    expect(maskPublicDescription(input)).toBe(input);
  });
});

describe('maskPublicDescription — other identifiers and edges', () => {
  it('masks phone numbers, long account numbers and emails', () => {
    expect(maskPublicDescription('Transfer ke 081234567890')).toBe('Transfer ke [no. telp]');
    expect(maskPublicDescription('Rek 1234567890123')).toBe('Rek [nomor]');
    expect(maskPublicDescription('kirim ke ani@mail.com')).toBe('kirim ke [email]');
  });
  it('does not treat rupiah amounts as account numbers', () => {
    expect(maskPublicDescription('Biaya peserta SWA 2 utusan @ Rp 300.000')).toBe('Biaya peserta SWA 2 utusan @ Rp 300.000');
    expect(maskPublicDescription('Total Rp 1.000.000')).toBe('Total Rp 1.000.000');
  });
  it('masks case-insensitively and ends the name at punctuation', () => {
    expect(maskPublicDescription('INFAQ BU ROHMI')).toBe('INFAQ BU R***');
    expect(maskPublicDescription('Infaq (Bu Rohmi), parenting')).toBe('Infaq (Bu R***), parenting');
  });
  it('returns null for empty/whitespace input and trims runs of spaces', () => {
    expect(maskPublicDescription(null)).toBeNull();
    expect(maskPublicDescription('   ')).toBeNull();
    expect(maskPublicDescription('Infaq   kaleng ')).toBe('Infaq kaleng');
  });
  it('truncates very long text', () => {
    const out = maskPublicDescription('x'.repeat(300))!;
    expect(out.length).toBeLessThanOrEqual(140);
    expect(out.endsWith('…')).toBe(true);
  });
});
