<script setup lang="ts">
/**
 * Pengumuman list + create/edit modal + delete confirm.
 *
 * - List: filter by status (all/draft/published) + scope, paginated.
 * - Create: title + body + scope + optional publishedAt.
 * - Edit: same form pre-filled.
 * - Delete: ConfirmDialog → DELETE.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { Plus, Pencil, Trash2 } from 'lucide-vue-next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useContentBulkActions } from '@/shared/composables/useContentBulkActions';
import { api } from '@/shared/api/client';
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
import Pagination from '@/shared/ui/Pagination.vue';
import StatusBadge from '@/shared/ui/StatusBadge.vue';

interface Announcement {
  id: string;
  title: string;
  body: string;
  slug: string;
  scope: 'public' | 'internal' | 'urgent';
  publishedAt: string | null;
  expiresAt: string | null;
  status: 'draft' | 'published';
  updatedAt: string;
}

const items = ref<Announcement[]>([]);
const loading = ref(true);
const saving = ref(false);
const deleting = ref(false);
const error = ref<string | null>(null);

const limit = 20;
const offset = ref(0);
const filterStatus = ref<'all' | 'draft' | 'published'>('all');
const filterScope = ref<'' | 'public' | 'internal' | 'urgent'>('');

const statusFilterOptions = [
  { value: 'all', label: 'Semua status' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Terpublikasi' },
];

const scopeFilterOptions = [
  { value: '', label: 'Semua skup' },
  { value: 'public', label: 'Publik' },
  { value: 'internal', label: 'Internal' },
  { value: 'urgent', label: 'Darurat' },
];

const scopeFormOptions = [
  { value: 'public', label: 'Publik' },
  { value: 'internal', label: 'Internal' },
  { value: 'urgent', label: 'Darurat' },
];

const SCOPE_LABEL: Record<Announcement['scope'], string> = {
  public: 'Publik',
  internal: 'Internal',
  urgent: 'Darurat',
};

const total = computed(() => items.value.length);

const editing = ref<Announcement | null>(null);
const modalOpen = ref(false);
const confirmOpen = ref(false);
const toDelete = ref<Announcement | null>(null);
const bulkStatusOpen = ref(false);
const bulkStatus = ref<'draft' | 'published'>('published');
const bulkScopeOpen = ref(false);
const bulkScope = ref<Announcement['scope']>('public');
const bulkDeleteOpen = ref(false);

const statusBulkOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Terpublikasi' },
];

const form = reactive({
  title: '',
  body: '',
  scope: 'public' as 'public' | 'internal' | 'urgent',
  publishedAt: '' as string,
});

function resetForm(a?: Announcement | null): void {
  form.title = a?.title ?? '';
  form.body = a?.body ?? '';
  form.scope = a?.scope ?? 'public';
  form.publishedAt = a?.publishedAt ? a.publishedAt.slice(0, 16) : '';
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await api.get<{ data: Announcement[] }>('/api/v1/announcements', {
      query: {
        status: filterStatus.value,
        scope: filterScope.value || undefined,
        limit,
        offset: offset.value,
      },
    });
    items.value = res.data;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

watch([filterStatus, filterScope], () => {
  offset.value = 0;
  load();
});

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
} = useContentBulkActions(items, '/api/v1/announcements', 'pengumuman', load);

async function applyBulkStatus(): Promise<void> {
  const patch =
    bulkStatus.value === 'published'
      ? { publishedAt: new Date().toISOString() }
      : { publishedAt: null };
  await bulkPatch(patch);
  bulkStatusOpen.value = false;
}

async function applyBulkScope(): Promise<void> {
  await bulkPatch({ scope: bulkScope.value });
  bulkScopeOpen.value = false;
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

function openEdit(a: Announcement): void {
  editing.value = a;
  resetForm(a);
  modalOpen.value = true;
}

async function save(): Promise<void> {
  saving.value = true;
  error.value = null;
  try {
    const payload = {
      title: form.title,
      body: form.body,
      scope: form.scope,
      publishedAt: form.publishedAt ? new Date(form.publishedAt).toISOString() : null,
    };
    if (editing.value) {
      await api.patch(`/api/v1/announcements/${editing.value.id}`, payload);
    } else {
      await api.post('/api/v1/announcements', payload);
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

function askDelete(a: Announcement): void {
  toDelete.value = a;
  confirmOpen.value = true;
}

async function doDelete(): Promise<void> {
  if (!toDelete.value) return;
  deleting.value = true;
  try {
    await api.delete(`/api/v1/announcements/${toDelete.value.id}`);
    confirmOpen.value = false;
    toDelete.value = null;
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    deleting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader
      title="Pengumuman"
      description="Kelola pengumuman masjid"
      :crumbs="[{ label: 'Dashboard', to: '/' }, { label: 'Konten' }, { label: 'Pengumuman' }]"
    >
      <template #actions>
        <Button @click="openCreate"><Plus class="h-4 w-4" /> Tambah</Button>
      </template>
    </PageHeader>

    <Card>
      <CardContent class="flex flex-wrap items-center gap-2 pt-6">
        <AppSelect v-model="filterStatus" :options="statusFilterOptions" class="max-w-[160px]" />
        <AppSelect v-model="filterScope" :options="scopeFilterOptions" class="max-w-[160px]" />
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
      <Button variant="secondary" size="sm" :disabled="bulkActing" @click="bulkScopeOpen = true">
        Ubah skup
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
        <Skeleton v-for="i in 3" :key="i" class="h-16 w-full" />
      </CardContent>
    </Card>

    <Card v-else>
      <CardContent class="p-0">
        <ul v-if="items.length > 0" class="divide-y divide-border">
          <li
            v-for="a in items"
            :key="a.id"
            class="flex items-start justify-between gap-4 px-5 py-4"
            :class="isSelected(a.id) ? 'bg-primary/5' : ''"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <AppCheckbox
                  class="shrink-0"
                  :model-value="isSelected(a.id)"
                  @update:model-value="toggleSelect(a.id)"
                />
                <p class="truncate text-sm font-medium text-foreground">{{ a.title }}</p>
              </div>
              <p class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{{ a.body }}</p>
              <div class="mt-1 flex items-center gap-2">
                <StatusBadge :status="a.status" />
                <Badge variant="outline" class="text-[11px]">{{ SCOPE_LABEL[a.scope] }}</Badge>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="sm" @click="openEdit(a)"><Pencil class="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="sm" @click="askDelete(a)"><Trash2 class="h-3.5 w-3.5 text-destructive" /></Button>
            </div>
          </li>
        </ul>
        <p v-else class="px-5 py-10 text-center text-sm text-muted-foreground">Belum ada pengumuman.</p>
        <Pagination
          v-if="items.length > 0"
          :total="total"
          :offset="offset"
          :limit="limit"
          :loading="loading"
          @prev="(offset = Math.max(0, offset - limit), load())"
          @next="(offset = offset + limit, load())"
        />
      </CardContent>
    </Card>

    <Modal v-model:open="modalOpen" :title="editing ? 'Edit Pengumuman' : 'Pengumuman Baru'" size="lg">
      <form class="space-y-3" @submit.prevent="save">
        <FormField label="Judul" required>
          <Input v-model="form.title" required minlength="2" />
        </FormField>
        <FormField label="Isi" required>
          <Textarea v-model="form.body" rows="6" required />
        </FormField>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Skup">
            <AppSelect v-model="form.scope" :options="scopeFormOptions" />
          </FormField>
          <FormField label="Publikasikan pada" hint="Kosongkan = draft">
            <DateTimePicker v-model="form.publishedAt" />
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
      title="Hapus pengumuman"
      :message="`Pengumuman “${toDelete?.title ?? ''}” akan dihapus.`"
      :loading="deleting"
      @confirm="doDelete"
    />

    <BulkFieldModal
      v-model:open="bulkStatusOpen"
      v-model="bulkStatus"
      title="Ubah status massal"
      label="Status baru"
      :options="statusBulkOptions"
      :count="selectedCount"
      :loading="bulkActing"
      @confirm="applyBulkStatus"
    />

    <BulkFieldModal
      v-model:open="bulkScopeOpen"
      v-model="bulkScope"
      title="Ubah skup massal"
      label="Skup baru"
      :options="scopeFormOptions"
      :count="selectedCount"
      :loading="bulkActing"
      @confirm="applyBulkScope"
    />

    <ConfirmDialog
      v-model:open="bulkDeleteOpen"
      title="Hapus pengumuman terpilih"
      :message="`Hapus ${selectedCount} pengumuman terpilih?`"
      :loading="bulkActing"
      @confirm="confirmBulkDelete"
    />
  </div>
</template>