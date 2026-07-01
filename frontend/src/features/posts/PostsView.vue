<script setup lang="ts">
/**
 * Posts (Berita) — list + create/edit/delete.
 *
 * Body kept as plain textarea for MVP. Rich-text editor (TipTap) can be
 * dropped in later as a single component swap without changing this view.
 */
import { onMounted, reactive, ref, watch } from 'vue';
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
import FormField from '@/shared/ui/FormField.vue';
import Modal from '@/shared/ui/Modal.vue';
import PageHeader from '@/shared/ui/PageHeader.vue';
import { cn } from '@/lib/utils';

type Status = 'draft' | 'published' | 'archived';

interface Post {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  coverUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  status: Status;
  publishedAt: string | null;
  updatedAt: string;
}

const items = ref<Post[]>([]);
const loading = ref(true);
const saving = ref(false);
const deleting = ref(false);
const error = ref<string | null>(null);

const filterStatus = ref<'' | Status>('');
const search = ref('');

const statusFilterOptions = [
  { value: '', label: 'Semua status' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Terbit' },
  { value: 'archived', label: 'Arsip' },
];

const statusFormOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Terbit' },
  { value: 'archived', label: 'Arsip' },
];

const editing = ref<Post | null>(null);
const modalOpen = ref(false);
const confirmOpen = ref(false);
const toDelete = ref<Post | null>(null);
const bulkStatusOpen = ref(false);
const bulkStatus = ref<Status>('published');
const bulkDeleteOpen = ref(false);

const form = reactive({
  title: '',
  excerpt: '',
  body: '',
  coverUrl: '',
  seoTitle: '',
  seoDescription: '',
  status: 'draft' as Status,
});

function resetForm(p?: Post | null): void {
  form.title = p?.title ?? '';
  form.excerpt = p?.excerpt ?? '';
  form.body = p?.body ?? '';
  form.coverUrl = p?.coverUrl ?? '';
  form.seoTitle = p?.seoTitle ?? '';
  form.seoDescription = p?.seoDescription ?? '';
  form.status = p?.status ?? 'draft';
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await api.get<{ data: Post[] }>('/api/v1/posts', {
      query: {
        status: filterStatus.value || undefined,
        search: search.value || undefined,
        limit: 50,
      },
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
} = useContentBulkActions(items, '/api/v1/posts', 'berita', load);

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

function openEdit(p: Post): void {
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
      excerpt: form.excerpt || null,
      body: form.body,
      coverUrl: form.coverUrl || null,
      seoTitle: form.seoTitle || null,
      seoDescription: form.seoDescription || null,
      status: form.status,
    };
    if (editing.value) {
      await api.patch(`/api/v1/posts/${editing.value.id}`, payload);
    } else {
      await api.post('/api/v1/posts', payload);
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

function askDelete(p: Post): void {
  toDelete.value = p;
  confirmOpen.value = true;
}

async function doDelete(): Promise<void> {
  if (!toDelete.value) return;
  deleting.value = true;
  try {
    await api.delete(`/api/v1/posts/${toDelete.value.id}`);
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
  archived: 'Arsip',
};

const STATUS_BADGE: Record<Status, string> = {
  draft: 'bg-muted text-muted-foreground',
  published: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  archived: 'bg-amber-50 text-amber-700 border-amber-200',
};

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader
      title="Berita & Artikel"
      description="Kelola publikasi tertulis untuk portal masjid"
      :crumbs="[{ label: 'Dashboard', to: '/' }, { label: 'Konten' }, { label: 'Berita' }]"
    >
      <template #actions>
        <Button @click="openCreate"><Plus class="h-4 w-4" /> Tambah</Button>
      </template>
    </PageHeader>

    <Card>
      <CardContent class="flex flex-wrap items-center gap-2 pt-6">
        <AppSelect v-model="filterStatus" :options="statusFilterOptions" class="max-w-[160px]" />
        <Input
          v-model="search"
          class="max-w-[280px]"
          placeholder="Cari judul / kutipan…"
          @keydown.enter="load()"
        />
        <Button variant="secondary" size="sm" @click="load()">Cari</Button>
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
            v-for="p in items"
            :key="p.id"
            class="flex items-start justify-between gap-4 px-5 py-4"
            :class="isSelected(p.id) ? 'bg-primary/5' : ''"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <AppCheckbox
                  class="shrink-0"
                  :model-value="isSelected(p.id)"
                  @update:model-value="toggleSelect(p.id)"
                />
                <p class="truncate text-sm font-medium text-foreground">{{ p.title }}</p>
                <Badge variant="outline" :class="cn('text-[11px] font-medium', STATUS_BADGE[p.status])">
                  {{ STATUS_LABEL[p.status] }}
                </Badge>
              </div>
              <p class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{{ p.excerpt ?? p.body.slice(0, 160) }}</p>
              <p class="mt-1 text-[11px] text-muted-foreground">
                {{ p.publishedAt ? new Date(p.publishedAt).toLocaleString('id-ID') : 'belum dipublikasikan' }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="sm" @click="openEdit(p)"><Pencil class="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="sm" @click="askDelete(p)"><Trash2 class="h-3.5 w-3.5 text-destructive" /></Button>
            </div>
          </li>
        </ul>
      </CardContent>
    </Card>

    <Card v-else>
      <CardContent class="py-10 text-center text-sm text-muted-foreground">
        Belum ada berita.
      </CardContent>
    </Card>

    <Modal v-model:open="modalOpen" :title="editing ? 'Edit Berita' : 'Berita Baru'" size="xl">
      <form class="space-y-3" @submit.prevent="save">
        <FormField label="Judul" required>
          <Input v-model="form.title" required minlength="2" />
        </FormField>
        <FormField label="Kutipan (excerpt)" hint="Ringkasan singkat untuk daftar & SEO">
          <Textarea v-model="form.excerpt" rows="2" />
        </FormField>
        <FormField label="Isi" required>
          <Textarea v-model="form.body" rows="10" required />
        </FormField>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Cover (URL)">
            <Input v-model="form.coverUrl" />
          </FormField>
          <FormField label="Status">
            <AppSelect v-model="form.status" :options="statusFormOptions" />
          </FormField>
          <FormField label="SEO title">
            <Input v-model="form.seoTitle" />
          </FormField>
          <FormField label="SEO description">
            <Input v-model="form.seoDescription" />
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
      title="Hapus berita"
      :message="`Berita “${toDelete?.title ?? ''}” akan dihapus.`"
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
      title="Hapus berita terpilih"
      :message="`Hapus ${selectedCount} berita terpilih?`"
      :loading="bulkActing"
      @confirm="confirmBulkDelete"
    />
  </div>
</template>