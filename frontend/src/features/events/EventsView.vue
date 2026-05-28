<script setup lang="ts">
/**
 * Events list + create/edit modal + delete.
 *
 * MVP: edit basic fields only. Speakers + RSVPs viewable from detail row
 * but managed inline elsewhere (deferred).
 */
import { onMounted, reactive, ref } from 'vue';
import { Plus, Pencil, Trash2 } from 'lucide-vue-next';
import { api } from '@/shared/api/client';
import Button from '@/shared/ui/Button.vue';
import Modal from '@/shared/ui/Modal.vue';
import FormField from '@/shared/ui/FormField.vue';
import ConfirmDialog from '@/shared/ui/ConfirmDialog.vue';
import { INPUT_BASE, TEXTAREA_BASE } from '@/shared/ui/input-classes';

type Status = 'draft' | 'published' | 'cancelled' | 'completed';

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
}

const items = ref<Event[]>([]);
const loading = ref(true);
const saving = ref(false);
const deleting = ref(false);
const error = ref<string | null>(null);

const filterStatus = ref<'' | Status>('');

const editing = ref<Event | null>(null);
const modalOpen = ref(false);
const confirmOpen = ref(false);
const toDelete = ref<Event | null>(null);

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
});

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
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await api.get<{ data: Event[] }>('/api/v1/events', {
      query: { status: filterStatus.value || undefined, limit: 50 },
    });
    items.value = res.data;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  editing.value = null;
  resetForm(null);
  modalOpen.value = true;
}

function openEdit(e: Event): void {
  editing.value = e;
  resetForm(e);
  modalOpen.value = true;
}

async function save(): Promise<void> {
  saving.value = true;
  error.value = null;
  try {
    const payload = {
      title: form.title,
      description: form.description || null,
      coverUrl: form.coverUrl || null,
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      location: form.location || null,
      rsvpEnabled: form.rsvpEnabled,
      rsvpCapacity: form.rsvpCapacity ? Number(form.rsvpCapacity) : null,
      status: form.status,
      isPublic: form.isPublic,
    };
    if (editing.value) {
      await api.patch(`/api/v1/events/${editing.value.id}`, payload);
    } else {
      await api.post('/api/v1/events', payload);
    }
    modalOpen.value = false;
    await load();
  } catch (err) {
    const e = err as { body?: { error?: string } };
    error.value = e.body?.error ?? (err as Error).message;
  } finally {
    saving.value = false;
  }
}

function askDelete(e: Event): void {
  toDelete.value = e;
  confirmOpen.value = true;
}

async function doDelete(): Promise<void> {
  if (!toDelete.value) return;
  deleting.value = true;
  try {
    await api.delete(`/api/v1/events/${toDelete.value.id}`);
    confirmOpen.value = false;
    toDelete.value = null;
    await load();
  } catch (err) {
    error.value = (err as Error).message;
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
  draft: 'bg-slate-100 text-slate-600',
  published: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-rose-50 text-rose-700',
  completed: 'bg-blue-50 text-blue-700',
};

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-slate-900">Event & Kegiatan</h1>
        <p class="text-sm text-slate-500">Kelola jadwal kegiatan masjid</p>
      </div>
      <Button @click="openCreate"><Plus class="h-4 w-4" /> Tambah</Button>
    </header>

    <div class="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <select v-model="filterStatus" :class="INPUT_BASE" style="max-width:160px" @change="load()">
        <option value="">Semua status</option>
        <option value="draft">Draft</option>
        <option value="published">Terbit</option>
        <option value="completed">Selesai</option>
        <option value="cancelled">Batal</option>
      </select>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

    <div v-if="loading" class="space-y-2">
      <div v-for="i in 3" :key="i" class="h-20 animate-pulse rounded-xl bg-white border border-slate-200" />
    </div>

    <div v-else-if="items.length > 0" class="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <ul class="divide-y divide-slate-100">
        <li v-for="e in items" :key="e.id" class="flex items-start justify-between gap-4 px-5 py-4">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p class="truncate text-sm font-medium text-slate-900">{{ e.title }}</p>
              <span class="rounded-full px-2 py-0.5 text-[11px] font-medium" :class="STATUS_BADGE[e.status]">
                {{ STATUS_LABEL[e.status] }}
              </span>
            </div>
            <p class="mt-0.5 text-xs text-slate-500">
              {{ fmtDate(e.startsAt) }}{{ e.endsAt ? ` — ${fmtDate(e.endsAt)}` : '' }}
              <span v-if="e.location"> · {{ e.location }}</span>
              <span v-if="e.rsvpEnabled"> · RSVP {{ e.rsvpCapacity ?? '∞' }}</span>
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" @click="openEdit(e)"><Pencil class="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="sm" @click="askDelete(e)"><Trash2 class="h-3.5 w-3.5 text-red-600" /></Button>
          </div>
        </li>
      </ul>
    </div>

    <p v-else class="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">
      Belum ada event.
    </p>

    <Modal v-model:open="modalOpen" :title="editing ? 'Edit Event' : 'Event Baru'" size="lg">
      <form class="space-y-3" @submit.prevent="save">
        <FormField label="Judul" required>
          <input v-model="form.title" :class="INPUT_BASE" required minlength="2" />
        </FormField>
        <FormField label="Deskripsi">
          <textarea v-model="form.description" :class="TEXTAREA_BASE" rows="3" />
        </FormField>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Mulai" required>
            <input v-model="form.startsAt" type="datetime-local" :class="INPUT_BASE" required />
          </FormField>
          <FormField label="Selesai">
            <input v-model="form.endsAt" type="datetime-local" :class="INPUT_BASE" />
          </FormField>
          <FormField label="Lokasi">
            <input v-model="form.location" :class="INPUT_BASE" />
          </FormField>
          <FormField label="Cover (URL)">
            <input v-model="form.coverUrl" :class="INPUT_BASE" placeholder="https://…" />
          </FormField>
          <FormField label="Status">
            <select v-model="form.status" :class="INPUT_BASE">
              <option value="draft">Draft</option>
              <option value="published">Terbit</option>
              <option value="completed">Selesai</option>
              <option value="cancelled">Batal</option>
            </select>
          </FormField>
          <FormField label="Publik">
            <label class="inline-flex items-center gap-2 text-sm">
              <input v-model="form.isPublic" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
              <span>Tampilkan di portal publik</span>
            </label>
          </FormField>
          <FormField label="Aktifkan RSVP">
            <label class="inline-flex items-center gap-2 text-sm">
              <input v-model="form.rsvpEnabled" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
              <span>Pendaftaran online</span>
            </label>
          </FormField>
          <FormField label="Kapasitas RSVP" hint="Kosongkan = tanpa batas">
            <input v-model="form.rsvpCapacity" type="number" min="1" :class="INPUT_BASE" :disabled="!form.rsvpEnabled" />
          </FormField>
        </div>
      </form>
      <template #footer>
        <Button variant="secondary" @click="modalOpen = false">Batal</Button>
        <Button :loading="saving" @click="save">{{ editing ? 'Simpan' : 'Buat' }}</Button>
      </template>
    </Modal>

    <ConfirmDialog
      v-model:open="confirmOpen"
      title="Hapus event"
      :message="`Event “${toDelete?.title ?? ''}” akan dihapus.`"
      :loading="deleting"
      @confirm="doDelete"
    />
  </div>
</template>
