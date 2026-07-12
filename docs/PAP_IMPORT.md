# Impor Rekapan PAP

Fitur ini mengubah rekapan kas PAP berformat **Excel** atau **foto/scan** menjadi transaksi akuntansi terposting. Jalur impor tersedia di **Transaksi → Impor Rekapan PAP** untuk pengguna dengan izin `transactions.create` dan `transactions.post`.

## Alur kerja

1. Pilih sumber: Excel (`.xlsx` / `.xlsm`) atau 1–5 foto JPEG, PNG, atau WebP.
2. Pilih satu Dana/Program PAP, akun Kas/Bank, akun Pendapatan, dan akun Beban default.
3. Periksa dan koreksi hasil baca sebelum posting. Baris yang tidak valid tidak dipilih otomatis; confidence rendah perlu diakui secara eksplisit.
4. Masukkan alasan audit minimal 10 karakter dan pilih **Konfirmasi & Posting**.
5. Semua baris diposting atomik. Bila satu baris gagal, tidak ada transaksi baru yang disimpan.

Untuk setiap baris:

- **Masuk**: debit Kas/Bank, kredit Pendapatan.
- **Keluar**: debit Beban (akun default atau override per baris), kredit Kas/Bank.
- Kedua baris transaksi dan jurnal menerima `fundId` yang dipilih agar masuk Buku Dana PSAK 109.

## Excel

Header yang dikenali: `Tanggal`, `Uraian`, `No. Bukti`, `Masuk`, `Keluar`, `Saldo`.

Parser menerima nominal Indonesia dan Excel, termasuk `Rp 1.250.000`, `1.000.000,50`, formula dengan cached result, serta tanggal Excel/ISO/Indonesia. Tanggal kalender tidak valid dan nominal ambigu ditandai sebagai error, bukan diubah menjadi nol. Footer `Total`, `Grand Total`, atau `Jumlah` diabaikan.

Kolom saldo dipakai untuk rekonsiliasi running balance, bukan sebagai transaksi baru.

## Foto / scan dengan Claude Vision

Set `ANTHROPIC_API_KEY` di `backend/.env.local`:

```env
ANTHROPIC_API_KEY=sk-ant-api03-...
```

Key harus merupakan key yang valid untuk API Anthropic resmi. Jangan menyimpan atau mengirim key ke repository, frontend, atau chat.

OCR memakai `claude-opus-4-8` melalui SDK resmi dan hanya menyalin tabel ke tahap review. OCR tidak memilih akun atau dana, serta tidak boleh mem-posting data tanpa konfirmasi pengguna.

Batas unggahan foto:

- 1–5 gambar per impor
- JPEG, PNG, atau WebP
- Maksimum 8 MB per gambar
- Maksimum 20 MB total

## Audit, idempotensi, dan nomor

Migration `095_accounting_import_batches.sql` menyediakan batch audit dengan fingerprint sumber, fingerprint payload, sumber, dana, alasan, jumlah baris, hasil, dan status.

Fingerprint sumber mencegah impor ulang data yang sama. Retry batch yang sudah `committed` mengembalikan hasil sebelumnya dengan `duplicate: true` tanpa membuat transaksi baru.

Nomor transaksi dan jurnal dialokasikan dengan advisory lock per tenant/periode. Nomor tidak lagi berputar setelah `9999`; sistem menolak alokasi baru setelah batas tersebut untuk mencegah duplikasi.

## Setup dan verifikasi

```bash
# dari masjidmu-v2/
pnpm --dir backend db:migrate
pnpm --dir backend typecheck
pnpm --dir backend lint
pnpm --dir backend test
pnpm --dir frontend typecheck
pnpm --dir frontend build
```

Tes foto nyata hanya dilakukan setelah API key dikonfigurasi. Pastikan hasil OCR masuk layar review terlebih dahulu, koreksi baris yang meragukan, kemudian posting.
