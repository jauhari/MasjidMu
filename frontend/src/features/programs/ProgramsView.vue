<script setup lang="ts">
/**
 * Programs list + create/edit modal + delete.
 */
import { onMounted, reactive, ref } from 'vue';
import { Plus, Pencil, Trash2 } from 'lucide-vue-next';
import { api } from '@/shared/api/client';
import Button from '@/shared/ui/Button.vue';
import Modal from '@/shared/ui/Modal.vue';
import FormField from '@/shared/ui/FormField.vue';
import ConfirmDialog from '@/shared/ui/ConfirmDialog.vue';
import DatePicker from '@/shared/ui/DatePicker.vue';
import { INPUT_BASE, TEXTAREA_BASE } from '@/shared/ui/input-classes';

type Status = 'draft' | 'active' | 'completed' | 'cancelled';

interface Program {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  targetAmount: string | null;
  collectedAmount: string | null;
  startDate: string | null;
  endDate: string | null;
  status: Status;
  isPublic: boolean;
}

const items = ref<Program[]>([]);
const loading = ref(true);
const saving = ref(false);
const deleting = ref(false);
const error = ref<string | null>(null);

const filterStatus = ref<'' | Status>('');

const editing = ref<Program | null>(null);
const modalOpen = ref(false);
const confirmOpen = ref(false);
const toDelete = ref<Program | null>(null);

const form = reactive({
  title: '',
  description: '',
  coverUrl: '',
  targetAmount: '',
  startDate: '',
  endDate: '',
  status: 'draft' as Status,
  isPublic: true,
});

function resetForm(p?: Program | null): void {
  form.title = p?.title ?? '';
  form.description = p?.description ?? '';
  form.coverUrl = p?.coverUrl ?? '';
  form.targetAmount = p?.targetAmount ?? '';
  form.startDate = p?.startDate ? p.startDate.slice(0, 10) : '';
  form.endDate = p?.endDate ? p.endDate.slice(0, 10) : '';
  form.status = p?.status ?? 'draft';
  form.isPublic = p?.isPublic ?? true;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await api.get<{ data: Program[] }>('/api/v1/programs', {
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

function openEdit(p: Program): void {
  editing.value = p;
  resetForm(p);
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
      targetAmount: form.targetAmount || null,
      startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
      endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
      status: form.status,
      isPublic: form.isPublic,
    };
    if (editing.value) {
      await api.patch(`/api/v1/programs/${editing.value.id}`, payload);
    } else {
      await api.post('/api/v1/programs', payload);
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

function askDelete(p: Program): void {
  toDelete.value = p;
  confirmOpen.value = true;
}

async function doDelete(): Promise<void> {
  if (!toDelete.value) return;
  deleting.value = true;
  try {
    await api.delete(`/api/v1/programs/${toDelete.value.id}`);
    confirmOpen.value = false;
    toDelete.value = null;
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    deleting.value = false;
  }
}

function progress(p: Program): number {
  if (!p.targetAmount) return 0;
  const t = Number(p.targetAmount);
  const c = Number(p.collectedAmount ?? 0);
  if (t <= 0) return 0;
  return Math.min(100, Math.round((c / t) * 100));
}

function fmtIDR(s: string | null): string {
  if (!s) return '-';
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}

const STATUS_LABEL: Record<Status, string> = {
  draft: 'Draft',
  active: 'Aktif',
  completed: 'Selesai',
  cancelled: 'Batal',
};

const STATUS_BADGE: Record<Status, string> = {
  draft: 'bg-slate-100 text-slate-600',
  active: 'bg-emerald-50 text-emerald-700',
  completed: 'bg-blue-50 text-blue-700',
  cancelled: 'bg-rose-50 text-rose-700',
};

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-slate-900">Program</h1>
        <p class="text-sm text-slate-500">Kelola program masjid (penggalangan, kegiatan jangka panjang)</p>
      </div>
      <Button @click="openCreate"><Plus class="h-4 w-4" /> Tambah</Button>
    </header>

    <div class="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <select v-model="filterStatus" :class="INPUT_BASE" style="max-width:160px" @change="load()">
        <option value="">Semua status</option>
        <option value="draft">Draft</option>
        <option value="active">Aktif</option>
        <option value="completed">Selesai</option>
        <option value="cancelled">Batal</option>
      </select>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

    <div v-if="loading" class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      <div v-for="i in 3" :key="i" class="h-40 animate-pulse rounded-xl bg-white border border-slate-200" />
    </div>

    <div v-else-if="items.length > 0" class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      <article v-for="p in items" :key="p.id" class="flex flex-col rounded-xl border border-slate-200 bg-white p-4">
        <div class="mb-2 flex items-start justify-between gap-2">
          <h3 class="line-clamp-2 text-sm font-semibold text-slate-900">{{ p.title }}</h3>
          <span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium" :class="STATUS_BADGE[p.status]">
            {{ STATUS_LABEL[p.status] }}
          </span>
        </div>
        <p class="mb-3 line-clamp-2 text-xs text-slate-500">{{ p.description ?? '—' }}</p>
        <div v-if="p.targetAmount" class="mb-3">
          <div class="flex items-center justify-between text-[11px] text-slate-500">
            <span>{{ fmtIDR(p.collectedAmount) }}</span>
            <span>{{ progress(p) }}% / {{ fmtIDR(p.targetAmount) }}</span>
          </div>
          <div class="mt-1 h-1.5 w-full rounded-full bg-slate-200">
            <div class="h-1.5 rounded-full bg-brand-500" :style="{ width: `${progress(p)}%` }" />
          </div>
        </div>
        <div class="mt-auto flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" @click="openEdit(p)"><Pencil class="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="sm" @click="askDelete(p)"><Trash2 class="h-3.5 w-3.5 text-red-600" /></Button>
        </div>
      </article>
    </div>

    <p v-else class="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">
      Belum ada program.
    </p>

    <Modal v-model:open="modalOpen" :title="editing ? 'Edit Program' : 'Program Baru'" size="lg">
      <form class="space-y-3" @submit.prevent="save">
        <FormField label="Judul" required>
          <input v-model="form.title" :class="INPUT_BASE" required minlength="2" />
        </FormField>
        <FormField label="Deskripsi">
          <textarea v-model="form.description" :class="TEXTAREA_BASE" rows="3" />
        </FormField>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Cover (URL)">
            <input v-model="form.coverUrl" :class="INPUT_BASE" placeholder="https://…" />
          </FormField>
          <FormField label="Target dana (Rp)">
            <input v-model="form.targetAmount" :class="INPUT_BASE" placeholder="100000.00" />
          </FormField>
          <FormField label="Mulai">
            <DatePicker v-model="form.startDate" />
          </FormField>
          <FormField label="Selesai">
            <DatePicker v-model="form.endDate" />
          </FormField>
          <FormField label="Status">
            <select v-model="form.status" :class="INPUT_BASE">
              <option value="draft">Draft</option>
              <option value="active">Aktif</option>
              <option value="completed">Selesai</option>
              <option value="cancelled">Batal</option>
            </select>
          </FormField>
          <FormField label="Tampilkan publik">
            <label class="inline-flex items-center gap-2 text-sm">
              <input v-model="form.isPublic" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
              <span>Tampilkan di portal publik</span>
            </label>
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
      title="Hapus program"
      :message="`Program “${toDelete?.title ?? ''}” akan dihapus.`"
      :loading="deleting"
      @confirm="doDelete"
    />
  </div>
</template>
