<script setup lang="ts">
/**
 * Events list + create/edit modal + delete.
 *
 * MVP: edit basic fields only. Speakers + RSVPs viewable from detail row
 * but managed inline elsewhere (deferred).
 */
import { computed, onMounted, reactive, ref, watch, type Component } from 'vue';
import {
  Plus,
  Pencil,
  Trash2,
  FileText,
  CalendarClock,
  Repeat,
  MapPin,
  Image as ImageIcon,
  Globe,
  Users,
  CalendarDays,
  RefreshCw,
  Timer,
  CalendarRange,
} from 'lucide-vue-next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useContentBulkActions } from '@/shared/composables/useContentBulkActions';
import { bulkErrorMessage } from '@/shared/lib/bulk-actions';
import { api, formatApiError } from '@/shared/api/client';
import AppCheckbox from '@/shared/ui/AppCheckbox.vue';
import AppSelect from '@/shared/ui/AppSelect.vue';
import BulkFieldModal from '@/shared/ui/BulkFieldModal.vue';
import Button from '@/shared/ui/Button.vue';
import ConfirmDialog from '@/shared/ui/ConfirmDialog.vue';
import ContentBulkBar from '@/shared/ui/ContentBulkBar.vue';
import DateTimePicker from '@/shared/ui/DateTimePicker.vue';
import FormField from '@/shared/ui/FormField.vue';
import Modal from '@/shared/ui/Modal.vue';
import PageHeader from '@/shared/ui/PageHeader.vue';
import { cn } from '@/lib/utils';

type Status = 'draft' | 'published' | 'cancelled' | 'completed';
type RecurrenceType = 'none' | 'weekly' | 'interval_days' | 'monthly';
type RecurrencePreset = 'once' | 'weekly' | 'selapanan' | 'interval' | 'monthly';

interface Event {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  rsvpEnabled: boolean;
  rsvpCapacity: number | null;
  status: Status;
  isPublic: boolean;
  seriesId: string | null;
  recurrenceType: RecurrenceType;
  intervalDays: number | null;
  recurrenceUntil: string | null;
  occurrenceIndex: number;
  seriesCount?: number;
  seriesFirstStartsAt?: string;
  seriesLastStartsAt?: string;
}

const items = ref<Event[]>([]);
const loading = ref(true);
const saving = ref(false);
const deleting = ref(false);
const error = ref<string | null>(null);

const filterStatus = ref<'' | Status>('');

const statusFilterOptions = [
  { value: '', label: 'Semua status' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Terbit' },
  { value: 'completed', label: 'Selesai' },
  { value: 'cancelled', label: 'Batal' },
];

const statusFormOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Terbit' },
  { value: 'completed', label: 'Selesai' },
  { value: 'cancelled', label: 'Batal' },
];

const editing = ref<Event | null>(null);
const modalOpen = ref(false);
const confirmOpen = ref(false);
const toDelete = ref<Event | null>(null);
const deleteEntireSeries = ref(false);
const bulkStatusOpen = ref(false);
const bulkStatus = ref<Status>('published');
const bulkDeleteOpen = ref(false);

const RECURRENCE_META: Record<
  RecurrencePreset,
  { label: string; hint: string; icon: Component }
> = {
  once: { label: 'Sekali', hint: 'Satu kegiatan pada tanggal mulai', icon: CalendarDays },
  weekly: { label: 'Mingguan', hint: 'Berulang setiap minggu', icon: CalendarRange },
  selapanan: { label: 'Selapanan', hint: 'Interval 35 hari', icon: RefreshCw },
  interval: { label: 'Interval', hint: 'Atur jarak hari sendiri', icon: Timer },
  monthly: { label: 'Bulanan', hint: 'Tanggal yang sama tiap bulan', icon: CalendarDays },
};

const recurrencePresets = (Object.keys(RECURRENCE_META) as RecurrencePreset[]).map((key) => ({
  key,
  ...RECURRENCE_META[key],
}));

const modalError = ref<string | null>(null);

const form = reactive({
  title: '',
  description: '',
  coverUrl: '',
  startsAt: '',
  endsAt: '',
  location: '',
  rsvpEnabled: false,
  rsvpCapacity: '' as string,
  status: 'draft' as Status,
  isPublic: true,
  recurrencePreset: 'once' as RecurrencePreset,
  intervalDays: '7',
  recurrenceUntil: '',
  recurrenceOpenEnded: false,
  noEndsAt: true,
});

function defaultRecurrenceUntil(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 6);
  return d.toISOString().slice(0, 10);
}

function resetForm(e?: Event | null): void {
  form.title = e?.title ?? '';
  form.description = e?.description ?? '';
  form.coverUrl = e?.coverUrl ?? '';
  form.startsAt = e?.startsAt ? e.startsAt.slice(0, 16) : '';
  form.endsAt = e?.endsAt ? e.endsAt.slice(0, 16) : '';
  form.location = e?.location ?? '';
  form.rsvpEnabled = e?.rsvpEnabled ?? false;
  form.rsvpCapacity = e?.rsvpCapacity != null ? String(e.rsvpCapacity) : '';
  form.status = e?.status ?? 'draft';
  form.isPublic = e?.isPublic ?? true;
  form.recurrencePreset = 'once';
  form.intervalDays = '7';
  form.recurrenceUntil = defaultRecurrenceUntil();
  form.recurrenceOpenEnded = false;
  form.noEndsAt = e?.endsAt == null;
}

function recurrencePayload(): {
  recurrenceType: RecurrenceType;
  intervalDays: number | null;
  recurrenceUntil: string | null;
  recurrenceOpenEnded: boolean;
} {
  if (editing.value || form.recurrencePreset === 'once') {
    return {
      recurrenceType: 'none',
      intervalDays: null,
      recurrenceUntil: null,
      recurrenceOpenEnded: false,
    };
  }
  const openEnded = form.recurrenceOpenEnded;
  const until =
    openEnded || !form.recurrenceUntil
      ? null
      : new Date(`${form.recurrenceUntil}T23:59:59`).toISOString();
  if (form.recurrencePreset === 'weekly') {
    return {
      recurrenceType: 'weekly',
      intervalDays: null,
      recurrenceUntil: until,
      recurrenceOpenEnded: openEnded,
    };
  }
  if (form.recurrencePreset === 'monthly') {
    return {
      recurrenceType: 'monthly',
      intervalDays: null,
      recurrenceUntil: until,
      recurrenceOpenEnded: openEnded,
    };
  }
  if (form.recurrencePreset === 'selapanan') {
    return {
      recurrenceType: 'interval_days',
      intervalDays: 35,
      recurrenceUntil: until,
      recurrenceOpenEnded: openEnded,
    };
  }
  const days = Number(form.intervalDays);
  return {
    recurrenceType: 'interval_days',
    intervalDays: Number.isFinite(days) && days >= 1 ? days : 7,
    recurrenceUntil: until,
    recurrenceOpenEnded: openEnded,
  };
}

function recurrenceBadge(e: Event): string | null {
  if (e.recurrenceType === 'none' || !e.seriesId) return null;
  if (e.recurrenceType === 'weekly') return 'Mingguan';
  if (e.recurrenceType === 'monthly') return 'Bulanan';
  if (e.recurrenceType === 'interval_days') {
    if (e.intervalDays === 35) return 'Selapanan';
    if (e.intervalDays != null) return `${e.intervalDays} hari`;
  }
  return 'Berulang';
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await api.get<{ data: Event[] }>('/api/v1/events', {
      query: { status: filterStatus.value || undefined, limit: 50, group: 'series' },
    });
    items.value = res.data;
  } catch (err) {
    error.value = formatApiError(err, 'Gagal memuat event');
  } finally {
    loading.value = false;
  }
}

watch(filterStatus, load);

const {
  selectedCount,
  selectedItems,
  isAllSelected,
  isSelected,
  toggleSelectAll,
  toggleSelect,
  clearSelection,
  bulkActing,
  bulkError,
  bulkPatch,
} = useContentBulkActions(items, '/api/v1/events', 'event', load);

async function applyBulkStatus(): Promise<void> {
  await bulkPatch({ status: bulkStatus.value });
  bulkStatusOpen.value = false;
}

async function confirmBulkDelete(): Promise<void> {
  if (selectedCount.value === 0) return;
  bulkActing.value = true;
  bulkError.value = null;
  const targets: { id: string; series: boolean }[] = [];
  const seen = new Set<string>();
  for (const e of selectedItems.value as Event[]) {
    const isSeries = !!(e.seriesId && (e.seriesCount ?? 1) > 1);
    const key = isSeries ? e.seriesId! : e.id;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ id: e.id, series: isSeries });
  }
  let failed = 0;
  let firstError = '';
  for (const t of targets) {
    try {
      await api.delete(`/api/v1/events/${t.id}`, {
        query: t.series ? { scope: 'series' } : undefined,
      });
    } catch (err) {
      failed++;
      if (!firstError) {
        const e = err as { body?: { error?: string } };
        firstError = e.body?.error ?? (err as Error).message;
      }
    }
  }
  const result = { failed, total: targets.length, firstError };
  clearSelection();
  await load();
  bulkError.value = bulkErrorMessage(result, 'event');
  bulkActing.value = false;
  bulkDeleteOpen.value = false;
}

watch(
  () => form.noEndsAt,
  (v) => {
    if (v) form.endsAt = '';
  },
);

function openCreate(): void {
  editing.value = null;
  modalError.value = null;
  resetForm(null);
  modalOpen.value = true;
}

function openEdit(e: Event): void {
  editing.value = e;
  modalError.value = null;
  resetForm(e);
  modalOpen.value = true;
}

const schedulePreview = computed(() => {
  const parts: string[] = [];
  if (form.startsAt) {
    parts.push(fmtDate(new Date(form.startsAt).toISOString()));
    if (form.noEndsAt) {
      parts.push('tanpa waktu selesai');
    } else if (form.endsAt) {
      parts.push(`hingga ${fmtDate(new Date(form.endsAt).toISOString())}`);
    }
  }
  if (!editing.value && form.recurrencePreset !== 'once') {
    const meta = RECURRENCE_META[form.recurrencePreset];
    let recur = meta.label;
    if (form.recurrenceOpenEnded) recur += ' · tanpa batas';
    else if (form.recurrenceUntil) recur += ` · sampai ${form.recurrenceUntil}`;
    parts.push(recur);
  }
  if (form.location) parts.push(form.location);
  return parts.length > 0 ? parts.join(' · ') : 'Isi jadwal untuk melihat ringkasan';
});

async function save(): Promise<void> {
  saving.value = true;
  error.value = null;
  modalError.value = null;
  try {
    const recurrence = recurrencePayload();
    const payload = {
      title: form.title,
      description: form.description || null,
      coverUrl: form.coverUrl || null,
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt:
        form.noEndsAt || !form.endsAt
          ? null
          : new Date(form.endsAt).toISOString(),
      location: form.location || null,
      rsvpEnabled: form.rsvpEnabled,
      rsvpCapacity: form.rsvpCapacity ? Number(form.rsvpCapacity) : null,
      status: form.status,
      isPublic: form.isPublic,
      ...recurrence,
    };
    if (editing.value) {
      await api.patch(`/api/v1/events/${editing.value.id}`, payload);
    } else {
      await api.post('/api/v1/events', payload);
    }
    modalOpen.value = false;
    await load();
  } catch (err) {
    modalError.value = formatApiError(err, 'Gagal menyimpan event');
  } finally {
    saving.value = false;
  }
}

function seriesScheduleLabel(e: Event): string {
  const count = e.seriesCount ?? 1;
  if (count <= 1) {
    return `${fmtDate(e.startsAt)}${e.endsAt ? ` — ${fmtDate(e.endsAt)}` : ''}`;
  }
  const from = e.seriesFirstStartsAt ?? e.startsAt;
  const to = e.seriesLastStartsAt ?? e.startsAt;
  return `${fmtDate(from)} — ${fmtDate(to)} · ${count} jadwal`;
}

function askDelete(e: Event): void {
  toDelete.value = e;
  deleteEntireSeries.value = (e.seriesCount ?? 1) > 1;
  confirmOpen.value = true;
}

async function doDelete(): Promise<void> {
  if (!toDelete.value) return;
  deleting.value = true;
  try {
    const scope =
      deleteEntireSeries.value && toDelete.value.seriesId ? 'series' : undefined;
    await api.delete(`/api/v1/events/${toDelete.value.id}`, {
      query: scope ? { scope } : undefined,
    });
    confirmOpen.value = false;
    toDelete.value = null;
    await load();
  } catch (err) {
    error.value = formatApiError(err, 'Gagal menghapus event');
  } finally {
    deleting.value = false;
  }
}

const STATUS_LABEL: Record<Status, string> = {
  draft: 'Draft',
  published: 'Terbit',
  cancelled: 'Batal',
  completed: 'Selesai',
};

const STATUS_BADGE: Record<Status, string> = {
  draft: 'bg-muted text-muted-foreground',
  published: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
  completed: 'bg-blue-50 text-blue-700 border-blue-200',
};

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader
      title="Event & Kegiatan"
      description="Kelola jadwal kegiatan masjid"
      :crumbs="[{ label: 'Dashboard', to: '/' }, { label: 'Konten' }, { label: 'Event' }]"
    >
      <template #actions>
        <Button @click="openCreate"><Plus class="h-4 w-4" /> Tambah</Button>
      </template>
    </PageHeader>

    <Card>
      <CardContent class="flex flex-wrap items-center gap-2 pt-6">
        <AppSelect v-model="filterStatus" :options="statusFilterOptions" class="max-w-[160px]" />
      </CardContent>
    </Card>

    <ContentBulkBar
      :selected-count="selectedCount"
      :all-selected="isAllSelected"
      :acting="bulkActing"
      :error="bulkError"
      @toggle-all="toggleSelectAll"
      @clear="clearSelection"
    >
      <Button variant="secondary" size="sm" :disabled="bulkActing" @click="bulkStatusOpen = true">
        Ubah status
      </Button>
      <Button variant="secondary" size="sm" :disabled="bulkActing" @click="bulkPatch({ isPublic: true })">
        Publikkan
      </Button>
      <Button variant="danger" size="sm" :disabled="bulkActing" @click="bulkDeleteOpen = true">
        Hapus
      </Button>
    </ContentBulkBar>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <Card v-if="loading">
      <CardContent class="flex flex-col gap-2 pt-6">
        <Skeleton v-for="i in 3" :key="i" class="h-20 w-full" />
      </CardContent>
    </Card>

    <Card v-else-if="items.length > 0">
      <CardContent class="p-0">
        <ul class="divide-y divide-border">
          <li
            v-for="e in items"
            :key="e.id"
            class="flex items-start justify-between gap-4 px-5 py-4"
            :class="isSelected(e.id) ? 'bg-primary/5' : ''"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <AppCheckbox
                  class="shrink-0"
                  :model-value="isSelected(e.id)"
                  @update:model-value="toggleSelect(e.id)"
                />
                <p class="truncate text-sm font-medium text-foreground">{{ e.title }}</p>
                <Badge variant="outline" :class="cn('text-[11px] font-medium', STATUS_BADGE[e.status])">
                  {{ STATUS_LABEL[e.status] }}
                </Badge>
                <Badge
                  v-if="recurrenceBadge(e)"
                  variant="outline"
                  class="border-violet-200 bg-violet-50 text-[11px] font-medium text-violet-700"
                >
                  {{ recurrenceBadge(e) }}
                </Badge>
                <Badge
                  v-if="(e.seriesCount ?? 1) > 1"
                  variant="outline"
                  class="text-[11px] font-medium"
                >
                  {{ e.seriesCount }} jadwal
                </Badge>
              </div>
              <p class="mt-0.5 text-xs text-muted-foreground">
                {{ seriesScheduleLabel(e) }}
                <span v-if="e.location"> · {{ e.location }}</span>
                <span v-if="e.rsvpEnabled"> · RSVP {{ e.rsvpCapacity ?? '∞' }}</span>
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="sm" @click="openEdit(e)"><Pencil class="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="sm" @click="askDelete(e)"><Trash2 class="h-3.5 w-3.5 text-destructive" /></Button>
            </div>
          </li>
        </ul>
      </CardContent>
    </Card>

    <Card v-else>
      <CardContent class="py-10 text-center text-sm text-muted-foreground">
        Belum ada event.
      </CardContent>
    </Card>

    <Modal
      v-model:open="modalOpen"
      :title="editing ? 'Edit Event' : 'Event Baru'"
      :description="
        editing
          ? 'Perbarui detail kegiatan. Pengulangan hanya bisa diatur saat membuat event baru.'
          : 'Atur jadwal, visibilitas, dan opsi pendaftaran untuk kegiatan masjid.'
      "
      size="xl"
    >
      <Alert v-if="modalError" variant="destructive" class="mb-4">
        <AlertDescription>{{ modalError }}</AlertDescription>
      </Alert>

      <form class="space-y-6" @submit.prevent="save">
        <div
          v-if="form.title || form.startsAt"
          class="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3"
        >
          <p class="text-[11px] font-medium uppercase tracking-wide text-primary">Pratinjau</p>
          <p class="mt-1 text-sm font-semibold text-foreground">
            {{ form.title || 'Judul kegiatan' }}
          </p>
          <p class="mt-0.5 text-xs text-muted-foreground">{{ schedulePreview }}</p>
        </div>

        <section class="space-y-4">
          <div class="flex items-center gap-2 text-sm font-medium text-foreground">
            <FileText class="size-4 text-primary" />
            Informasi dasar
          </div>
          <FormField label="Judul kegiatan" html-for="event-title" required>
            <Input
              id="event-title"
              v-model="form.title"
              required
              minlength="2"
              placeholder="Contoh: Pengajian Ahad Pekan Ini"
            />
          </FormField>
          <FormField label="Deskripsi" hint="Tampil di halaman detail event">
            <Textarea
              v-model="form.description"
              rows="4"
              placeholder="Ringkasan kegiatan, narasumber, atau catatan untuk jamaah…"
            />
          </FormField>
        </section>

        <Separator />

        <section class="space-y-4">
          <div class="flex items-center gap-2 text-sm font-medium text-foreground">
            <CalendarClock class="size-4 text-primary" />
            Jadwal
          </div>

          <div class="rounded-xl border border-border bg-muted/20 p-4">
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label="Mulai" required>
                <DateTimePicker v-model="form.startsAt" required />
              </FormField>
              <div class="space-y-2">
                <div class="flex items-center justify-between gap-3">
                  <Label class="text-sm font-medium">Selesai</Label>
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-muted-foreground">Tanpa waktu selesai</span>
                    <Switch v-model:checked="form.noEndsAt" aria-label="Tanpa waktu selesai" />
                  </div>
                </div>
                <DateTimePicker
                  v-model="form.endsAt"
                  :disabled="form.noEndsAt"
                  placeholder="Opsional"
                />
                <p class="text-xs text-muted-foreground">
                  Kosongkan jika kegiatan tidak punya waktu berakhir yang pasti.
                </p>
              </div>
            </div>
          </div>

          <div v-if="!editing" class="space-y-3">
            <div class="flex items-center gap-2 text-sm font-medium text-foreground">
              <Repeat class="size-4 text-primary" />
              Pengulangan
            </div>
            <p class="text-xs text-muted-foreground">
              Buat beberapa tanggal sekaligus hingga batas periode (maks. 52 jadwal).
            </p>
            <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <button
                v-for="preset in recurrencePresets"
                :key="preset.key"
                type="button"
                class="flex items-start gap-3 rounded-xl border p-3 text-left transition-all duration-200 hover:border-primary/40 hover:bg-muted/30"
                :class="
                  cn(
                    form.recurrencePreset === preset.key
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-border',
                  )
                "
                @click="form.recurrencePreset = preset.key"
              >
                <div
                  class="grid size-9 shrink-0 place-items-center rounded-lg"
                  :class="
                    form.recurrencePreset === preset.key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  "
                >
                  <component :is="preset.icon" class="size-4" />
                </div>
                <div class="min-w-0">
                  <p class="text-sm font-medium text-foreground">{{ preset.label }}</p>
                  <p class="text-xs text-muted-foreground">{{ preset.hint }}</p>
                </div>
              </button>
            </div>

            <div
              v-if="form.recurrencePreset !== 'once'"
              class="space-y-4 rounded-xl border border-border bg-muted/20 p-4"
            >
              <div class="flex items-center justify-between gap-3">
                <div>
                  <Label class="text-sm font-medium">Tanpa tanggal selesai</Label>
                  <p class="text-xs text-muted-foreground">
                    Jadwal berulang terus; sistem membuat ~52 kegiatan ke depan.
                  </p>
                </div>
                <Switch
                  v-model:checked="form.recurrenceOpenEnded"
                  aria-label="Pengulangan tanpa tanggal selesai"
                />
              </div>
              <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                <FormField
                  v-if="form.recurrencePreset === 'interval'"
                  label="Setiap (hari)"
                  required
                >
                  <Input v-model="form.intervalDays" type="number" min="1" max="365" required />
                </FormField>
                <FormField
                  v-if="!form.recurrenceOpenEnded"
                  label="Sampai tanggal"
                  hint="Jadwal dibuat otomatis hingga tanggal ini"
                  :class="form.recurrencePreset === 'interval' ? '' : 'md:col-span-2'"
                >
                  <Input v-model="form.recurrenceUntil" type="date" required />
                </FormField>
              </div>
            </div>
          </div>
        </section>

        <Separator />

        <section class="space-y-4">
          <div class="flex items-center gap-2 text-sm font-medium text-foreground">
            <MapPin class="size-4 text-primary" />
            Lokasi & media
          </div>
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="Lokasi">
              <div class="relative">
                <MapPin
                  class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  v-model="form.location"
                  class="pl-9"
                  placeholder="Masjid Al-Uula, ruang utama"
                />
              </div>
            </FormField>
            <FormField label="Cover (URL)" hint="Gambar thumbnail di daftar & portal">
              <div class="relative">
                <ImageIcon
                  class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  v-model="form.coverUrl"
                  class="pl-9"
                  placeholder="https://…"
                />
              </div>
            </FormField>
          </div>
          <div
            v-if="form.coverUrl"
            class="overflow-hidden rounded-xl border border-border bg-muted/30"
          >
            <img
              :src="form.coverUrl"
              alt="Pratinjau cover"
              class="aspect-[21/9] w-full object-cover"
              loading="lazy"
              @error="($event.target as HTMLImageElement).style.display = 'none'"
            />
          </div>
        </section>

        <Separator />

        <section class="space-y-4">
          <div class="flex items-center gap-2 text-sm font-medium text-foreground">
            <Globe class="size-4 text-primary" />
            Publikasi
          </div>
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label="Status">
              <AppSelect v-model="form.status" :options="statusFormOptions" />
            </FormField>
            <div
              class="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-4 py-3"
            >
              <div>
                <Label class="text-sm font-medium">Portal publik</Label>
                <p class="text-xs text-muted-foreground">Tampilkan di website jamaah</p>
              </div>
              <Switch v-model:checked="form.isPublic" aria-label="Tampilkan di portal publik" />
            </div>
          </div>
        </section>

        <Separator />

        <section class="space-y-3">
          <div class="flex items-center gap-2 text-sm font-medium text-foreground">
            <Users class="size-4 text-primary" />
            Pendaftaran (RSVP)
          </div>
          <div class="overflow-hidden rounded-xl border border-border">
            <div class="flex items-center justify-between gap-3 bg-muted/20 px-4 py-3">
              <div>
                <Label class="text-sm font-medium">Aktifkan RSVP</Label>
                <p class="text-xs text-muted-foreground">Jamaah bisa mendaftar online dari portal</p>
              </div>
              <Switch v-model:checked="form.rsvpEnabled" aria-label="Aktifkan RSVP" />
            </div>
            <div
              v-if="form.rsvpEnabled"
              class="border-t border-border px-4 py-3"
            >
              <FormField label="Kapasitas maksimal" hint="Kosongkan = tanpa batas peserta">
                <Input
                  v-model="form.rsvpCapacity"
                  type="number"
                  min="1"
                  placeholder="Contoh: 100"
                />
              </FormField>
            </div>
          </div>
        </section>
      </form>

      <template #footer>
        <Button variant="secondary" :disabled="saving" @click="modalOpen = false">
          Batal
        </Button>
        <Button :loading="saving" @click="save">
          {{ editing ? 'Simpan Perubahan' : 'Buat Event' }}
        </Button>
      </template>
    </Modal>

    <ConfirmDialog
      v-model:open="confirmOpen"
      title="Hapus event"
      :message="
        toDelete?.seriesId
          ? `Event “${toDelete?.title ?? ''}” bagian dari jadwal berulang.`
          : `Event “${toDelete?.title ?? ''}” akan dihapus.`
      "
      :loading="deleting"
      @confirm="doDelete"
    >
      <AppCheckbox
        v-if="toDelete?.seriesId"
        v-model="deleteEntireSeries"
        class="mt-3"
        label="Hapus seluruh seri jadwal berulang"
      />
    </ConfirmDialog>

    <BulkFieldModal
      v-model:open="bulkStatusOpen"
      v-model="bulkStatus"
      title="Ubah status massal"
      label="Status baru"
      :options="statusFormOptions"
      :count="selectedCount"
      :loading="bulkActing"
      @confirm="applyBulkStatus"
    />

    <ConfirmDialog
      v-model:open="bulkDeleteOpen"
      title="Hapus event terpilih"
      :message="`Hapus ${selectedCount} event/seri terpilih? Seri berulang dihapus utuh.`"
      :loading="bulkActing"
      @confirm="confirmBulkDelete"
    />
  </div>
</template>