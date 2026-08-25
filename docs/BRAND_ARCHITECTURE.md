# Brand Architecture — MizanMu

Status: **Decided 2026-08-25** (Master Brand resmi: **MizanMu**).

## Master brand

**MizanMu** — platform tata kelola, akuntansi & transparansi lembaga umat berkemajuan (Masjid, Pesantren, Lembaga Amal/ZIS, Yayasan, dan Organisasi Sosial).

- "Mizan" = neraca/timbangan keadilan (Arab: *Al-Mizan*) + akuntansi seimbang (*double-entry*) & pertanggungjawaban amanah.
- Ber-suffix **"-Mu"** (identitas gerakan & persyarikatan berkemajuan), memayungi seluruh vertikal kelembagaan sosial/keagamaan.
- Tagline resmi: *"Neraca Akuntabilitas Lembaga Umat Berkemajuan"*
- Tagline alternatif: *"Satu Platform untuk Tata Kelola, Keuangan, dan Transparansi Amanah Lembaga."*

## Keluarga edisi (semua "by MizanMu")

Satu codebase (multi-tenant), beda template laporan + istilah + onboarding per edisi.

| Edisi          | Target                                  | Standar akuntansi |
| -------------- | --------------------------------------- | ----------------- |
| **MasjidMu**   | DKM masjid/mushola (wedge saat ini)     | ISAK 35           |
| **ZakatMu**    | LAZ, BAZNAS kab/kota, unit pengelola zakat | **PSAK 109**   |
| **PesantrenMu**| Pesantren (SPP, donasi, unit usaha)     | ISAK 35           |
| **YayasanMu**  | Panti, sekolah, klinik, NGO             | ISAK 35           |
| _(wakaf)_      | Nazhir wakaf                            | PSAK 112          |

> Untuk lembaga non-Muslim (gereja, yayasan umum) nanti pakai brand netral /
> white-label di atas engine yang sama — suffix "-Mu" kurang nyambung lintas agama.

## Insight strategi inti

**Standar akuntansi = peta ekspansi + moat.** Tiap standar yang didukung membuka satu
vertikal baru sebagai *fitur*, bukan reposisi brand:

- **ISAK 35** → semua nirlaba (masjid, yayasan, pesantren) — _pondasi sudah ada di COA._
- **PSAK 109** → organisasi pengelola zakat (OPZ) — _kunci pembuka Baznas/Lazis._
- **PSAK 112** → wakaf.

Jualannya bukan "akuntansi" tapi **transparansi & amanah** ke jamaah/donatur/regulator.
Transparansi → kepercayaan → donasi naik.

## Urutan eksekusi (disepakati)

1. **MasjidMu sebagai wedge** — gratis/murah, growth loop laporan transparansi. _(sudah jalan)_
2. **PSAK 109** — tambah fund accounting (Dana Zakat/Infak-Sedekah/Amil/Non-halal).
   Upsell natural ke masjid yang nampung zakat saat Ramadan, sekaligus beachhead ke LAZ.
   _(← sedang dikerjakan: pondasi skema `funds` + `fund_id` sudah ada)_
3. **Partner 1 ormas pusat** (LazisMu / LazisNu / Baznas provinsi) sebagai design partner →
   fitur konsolidasi multi-entitas → case study → rollout top-down.
4. **ISAK 35 generik + PSAK 112 wakaf** — buka pesantren, yayasan, panti, nazhir.

## Distribusi

Jualan masjid satuan = CAC mahal. Ormas (Muhammadiyah/NU/Baznas) adalah **agregator** —
menang di pusat = rollout ribuan cabang. Fitur **konsolidasi multi-entitas** (pusat lihat
semua cabang) adalah produk ber-ACV tinggi yang hanya dibeli institusi.
