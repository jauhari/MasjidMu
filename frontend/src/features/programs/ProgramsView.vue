<script setup lang="ts">
/**
 * Programs list + create/edit modal + delete.
 */
import { onMounted, reactive, ref, watch } from 'vue';
import { Plus, Pencil, Trash2 } from 'lucide-vue-next';
import { useContentBulkActions } from '@/shared/composables/useContentBulkActions';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/shared/api/client';
import AppCheckbox from '@/shared/ui/AppCheckbox.vue';
import AppSelect from '@/shared/ui/AppSelect.vue';
import Button from '@/shared/ui/Button.vue';
import BulkFieldModal from '@/shared/ui/BulkFieldModal.vue';
import ConfirmDialog from '@/shared/ui/ConfirmDialog.vue';
import ContentBulkBar from '@/shared/ui/ContentBulkBar.vue';
import DatePicker from '@/shared/ui/DatePicker.vue';
import FormField from '@/shared/ui/FormField.vue';
import Modal from '@/shared/ui/Modal.vue';
import PageHeader from '@/shared/ui/PageHeader.vue';
import { cn } from '@/lib/utils';

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

const statusFilterOptions = [
  { value: '', label: 'Semua status' },
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Aktif' },
  { value: 'completed', label: 'Selesai' },
  { value: 'cancelled', label: 'Batal' },
];

const statusFormOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Aktif' },
  { value: 'completed', label: 'Selesai' },
  { value: 'cancelled', label: 'Batal' },
];

const editing = ref<Program | null>(null);
const modalOpen = ref(false);
const confirmOpen = ref(false);
const toDelete = ref<Program | null>(null);

const bulkStatusOpen = ref(false);
const bulkStatus = ref<Status>('active');
const bulkDeleteOpen = ref(false);

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

watch(filterStatus, load);

const {
  selectedCount,
  isAllSelected,
  isSelected,
  toggleSelectAll,
  toggleSelect,
  clearSelection,
  bulkActing,
  bulkError,
  bulkPatch,
  bulkDelete,
} = useContentBulkActions(items, '/api/v1/programs', 'program', load);

async function applyBulkStatus(): Promise<void> {
  await bulkPatch({ status: bulkStatus.value });
  bulkStatusOpen.value = false;
}

async function confirmBulkDelete(): Promise<void> {
  await bulkDelete();
  bulkDeleteOpen.value = false;
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
  draft: 'bg-muted text-muted-foreground',
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  completed: 'bg-blue-50 text-blue-700 border-blue-200',
  cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
};

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader
      title="Program"
      description="Kelola program masjid (penggalangan, kegiatan jangka panjang)"
      :crumbs="[{ label: 'Dashboard', to: '/' }, { label: 'Konten' }, { label: 'Program' }]"
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
      <Button
        variant="secondary"
        size="sm"
        :disabled="bulkActing"
        @click="bulkPatch({ isPublic: true })"
      >
        Publikkan
      </Button>
      <Button
        variant="secondary"
        size="sm"
        :disabled="bulkActing"
        @click="bulkPatch({ isPublic: false })"
      >
        Sembunyikan
      </Button>
      <Button variant="danger" size="sm" :disabled="bulkActing" @click="bulkDeleteOpen = true">
        Hapus
      </Button>
    </ContentBulkBar>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div v-if="loading" class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      <Card v-for="i in 3" :key="i">
        <CardContent class="pt-6">
          <Skeleton class="h-40 w-full" />
        </CardContent>
      </Card>
    </div>

    <div v-else-if="items.length > 0" class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      <Card
        v-for="p in items"
        :key="p.id"
        :class="isSelected(p.id) ? 'ring-2 ring-primary/30' : ''"
      >
        <CardContent class="flex flex-col pt-6">
          <div class="mb-2 flex items-start justify-between gap-2">
            <div class="flex min-w-0 items-start gap-2">
              <AppCheckbox
                class="mt-0.5 shrink-0"
                :model-value="isSelected(p.id)"
                @update:model-value="toggleSelect(p.id)"
              />
              <h3 class="line-clamp-2 text-sm font-semibold text-foreground">{{ p.title }}</h3>
            </div>
            <Badge variant="outline" :class="cn('shrink-0 text-[11px] font-medium', STATUS_BADGE[p.status])">
              {{ STATUS_LABEL[p.status] }}
            </Badge>
          </div>
          <p class="mb-3 line-clamp-2 text-xs text-muted-foreground">{{ p.description ?? '—' }}</p>
          <div v-if="p.targetAmount" class="mb-3">
            <div class="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{{ fmtIDR(p.collectedAmount) }}</span>
              <span>{{ progress(p) }}% / {{ fmtIDR(p.targetAmount) }}</span>
            </div>
            <div class="mt-1 h-1.5 w-full rounded-full bg-muted">
              <div class="h-1.5 rounded-full bg-primary" :style="{ width: `${progress(p)}%` }" />
            </div>
          </div>
          <div class="mt-auto flex items-center justify-end gap-1">
            <Button variant="ghost" size="sm" @click="openEdit(p)"><Pencil class="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="sm" @click="askDelete(p)"><Trash2 class="h-3.5 w-3.5 text-destructive" /></Button>
          </div>
        </CardContent>
      </Card>
    </div>

    <Card v-else>
      <CardContent class="py-10 text-center text-sm text-muted-foreground">
        Belum ada program.
      </CardContent>
    </Card>

    <Modal v-model:open="modalOpen" :title="editing ? 'Edit Program' : 'Program Baru'" size="lg">
      <form class="space-y-3" @submit.prevent="save">
        <FormField label="Judul" required>
          <Input v-model="form.title" required minlength="2" />
        </FormField>
        <FormField label="Deskripsi">
          <Textarea v-model="form.description" rows="3" />
        </FormField>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Cover (URL)">
            <Input v-model="form.coverUrl" placeholder="https://…" />
          </FormField>
          <FormField label="Target dana (Rp)">
            <Input v-model="form.targetAmount" placeholder="100000.00" />
          </FormField>
          <FormField label="Mulai">
            <DatePicker v-model="form.startDate" />
          </FormField>
          <FormField label="Selesai">
            <DatePicker v-model="form.endDate" />
          </FormField>
          <FormField label="Status">
            <AppSelect v-model="form.status" :options="statusFormOptions" />
          </FormField>
          <FormField label="Tampilkan publik">
            <AppCheckbox v-model="form.isPublic" label="Tampilkan di portal publik" />
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
      title="Hapus program terpilih"
      :message="`Hapus ${selectedCount} program terpilih?`"
      :loading="bulkActing"
      @confirm="confirmBulkDelete"
    />
  </div>
</template>