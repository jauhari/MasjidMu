# Handoff — MasjidMu v2 (Konten & Event)

**Tanggal:** 2026-07-01  
**Tenant dev:** `al-uula` (Masjid Al-Uula)  
**Stack:** Vue 3 + Vite (frontend `:5173`), Hono + Postgres/Neon (backend `:3001`)

---

## Ringkasan sesi

Sesi ini fokus pada modul **konten** di sidebar **Lainnya** (Profil Masjid, Program, Event, Berita, Galeri, Pengumuman) plus perbaikan **Event** (pengulangan, bug submit, duplikat list, form PRO).

| Area | Status |
|------|--------|
| Event recurrence (mingguan, selapanan, interval, bulanan) | ✅ |
| Event tanpa waktu selesai & pengulangan tanpa tanggal akhir | ✅ |
| Fix `internal_error` saat submit event | ✅ |
| Fix duplikat 104 baris di list Event | ✅ |
| Modal scrollbar form Event | ✅ |
| CRUD + mass edit konten | ✅ |
| Form Event Baru — layout PRO | ✅ |

---

## 1. Event — pengulangan (recurrence)

### Database
- Migration `backend/src/db/migrations/sql/093_event_recurrence.sql`
- Kolom baru: `series_id`, `recurrence_type`, `interval_days`, `recurrence_until`, `occurrence_index`

### Backend
- `backend/src/lib/event-recurrence.ts` — generate occurrence (maks. 52), `groupEventsBySeries()`
- `backend/src/modules/content/events/route.ts`:
  - **POST** — buat seri + banyak occurrence sekaligus
  - **GET** `?group=series` — satu baris per seri (bukan per occurrence)
  - **DELETE** `?scope=series` — hapus seluruh seri
  - **POST** pakai `findTenantUser()` untuk `createdBy` (FK ke `users.id` UUID tenant, bukan auth user text ID)

### Frontend
- `frontend/src/features/events/EventsView.vue`:
  - Preset: Sekali, Mingguan, Selapanan (35 hari), Interval hari, Bulanan
  - Opsi **tanpa waktu selesai** (`endsAt: null`)
  - Opsi **tanpa tanggal selesai pengulangan** (`recurrenceOpenEnded` → ~52 jadwal ke depan)
  - Badge seri di list + label jadwal gabungan
  - Bulk delete dedupe per `seriesId`, pakai `?scope=series` untuk seri berulang

### Data uji yang dibersihkan
- Seri uji **"Test Pengajian Ahad"** (104 occurrence) di-**soft-delete** — penyebab list penuh duplikat.

---

## 2. Perbaikan bug Event

| Bug | Akar masalah | Fix |
|-----|--------------|-----|
| `internal_error` submit | `createdBy` = auth ID (`qGbYoPQeJuF…`) bukan `users.id` UUID | `findTenantUser()` di POST events |
| List 104 baris duplikat | List per occurrence + data uji ganda | GET `group=series` + cleanup data uji |
| Scrollbar modal aneh | Layout modal + scroll area | `Modal.vue`: flex column + `ScrollArea type="hover"` |

---

## 3. Mass edit konten (CRUD + bulk)

Pola mengikuti **Transaksi** — checkbox, bar aksi, modal field, konfirmasi hapus.

### Shared (baru)
| File | Fungsi |
|------|--------|
| `frontend/src/shared/composables/useBulkSelection.ts` | State checkbox / pilih semua |
| `frontend/src/shared/composables/useContentBulkActions.ts` | `bulkPatch`, `bulkDelete` loop API |
| `frontend/src/shared/lib/bulk-actions.ts` | `runBulk`, `bulkErrorMessage` |
| `frontend/src/shared/ui/ContentBulkBar.vue` | Bar aksi saat ada item terpilih |
| `frontend/src/shared/ui/BulkFieldModal.vue` | Modal ubah field massal |

### Status per modul

| Modul | Mass edit |
|-------|-----------|
| Profil Masjid | N/A (form tunggal, bukan list) |
| Program | Status, Publikkan/Sembunyikan, Hapus |
| Event | Status, Publikkan, Hapus (+ hapus seri) |
| Berita (Posts) | Status, Hapus |
| Pengumuman | Status, Ubah skup, Hapus |
| Galeri | Publikkan/Sembunyikan, Hapus album |

### Catatan khusus — Pengumuman
- **Tidak ada kolom `status`** di DB — status derived dari `publishedAt` (`backend/.../announcements/route.ts` → `withDerivedStatus()`).
- Bulk **Ubah status** harus PATCH:
  - Terpublikasi → `{ publishedAt: new Date().toISOString() }`
  - Draft → `{ publishedAt: null }`
- Bukan `{ status: 'draft' | 'published' }`.

---

## 4. Form Event Baru — redesign PRO

`frontend/src/features/events/EventsView.vue` — modal form dirombak:

- Modal **xl** + deskripsi konteks di header
- **5 section** berikon: Informasi dasar → Jadwal → Lokasi & media → Publikasi → RSVP
- **Strip pratinjau** live (judul + ringkasan jadwal)
- **Kartu pilihan** tipe pengulangan (ganti dropdown)
- **Switch** untuk toggle (tanpa waktu selesai, portal publik, RSVP, pengulangan tanpa batas)
- Input berikon (lokasi, cover), pratinjau cover dari URL
- RSVP collapsible — kapasitas hanya tampil jika RSVP aktif
- Error simpan di **`modalError`** (di dalam modal), bukan page-level

---

## 5. File kunci

```
backend/
  src/db/migrations/sql/093_event_recurrence.sql
  src/lib/event-recurrence.ts
  src/lib/user-mapping.js          # findTenantUser
  src/modules/content/events/route.ts
  src/modules/content/announcements/route.ts

frontend/
  src/shared/ui/Modal.vue
  src/shared/composables/useBulkSelection.ts
  src/shared/composables/useContentBulkActions.ts
  src/shared/lib/bulk-actions.ts
  src/shared/ui/ContentBulkBar.vue
  src/shared/ui/BulkFieldModal.vue
  src/features/events/EventsView.vue
  src/features/programs/ProgramsView.vue
  src/features/posts/PostsView.vue
  src/features/announcements/AnnouncementsView.vue
  src/features/galleries/GalleriesView.vue
  src/features/changelog/ChangelogView.vue   # entri changelog
```

---

## 6. Dev & verifikasi

```bash
# Dari masjidmu-v2/
pnpm --filter @masjidmu/backend dev    # :3001
pnpm --filter @masjidmu/frontend dev   # :5173
pnpm --filter @masjidmu/frontend typecheck
```

**Login dev:** `admin@masjidmu.id`, tenant slug `al-uula`

**Uji manual disarankan:**
1. Event baru — pengulangan mingguan + tanpa waktu selesai → submit sukses
2. List Event — satu baris per seri, bukan puluhan duplikat
3. Mass edit — pilih 2+ item di Program/Berita/Pengumuman/Galeri → ubah status / hapus
4. Pengumuman bulk status — draft ↔ terpublikasi (cek `publishedAt` di network tab)
5. Form Event Baru — layout section + pratinjau + switch

---

## 7. Follow-up opsional (belum dikerjakan)

- **createdBy bug serupa** di Program/Posts/Announcements POST (masih bisa pakai `c.get('user')!.id` — sama pola bug event)
- Toast sukses setelah bulk action (saat ini hanya error bar)
- Mass edit **item foto** dalam album galeri (belum diminta)
- Speakers + RSVP detail inline di EventsView (deferred di komentar MVP)

---

## 8. Suggested skills (agen berikutnya)

| Skill | Kapan |
|-------|--------|
| `verification-before-completion` | Sebelum klaim selesai — jalankan typecheck + uji manual |
| `systematic-debugging` / `gstack-investigate` | Jika API error atau bulk gagal sebagian |
| `impeccable` / `design-taste-frontend` | Polish UI modul konten lain |
| `supabase-postgres-best-practices` | Optimasi query list + pagination konten |
| `handoff` | Update dokumen ini setelah sesi berikutnya |

---

## 9. Changelog

Entri aplikasi diperbarui di `frontend/src/features/changelog/ChangelogView.vue` (tanggal **2026-07-01**). Lihat halaman **Changelog** di sidebar atau `/changelog`.