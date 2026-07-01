<script setup lang="ts">
/**
 * Galleries — list view + drilldown drawer for items.
 *
 * Two-pane layout: list on left, selected gallery's items on right.
 * Items have add/edit/delete + drag-free sortOrder edit.
 */
import { onMounted, reactive, ref } from 'vue';
import { Plus, Pencil, Trash2, ImagePlus } from 'lucide-vue-next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useContentBulkActions } from '@/shared/composables/useContentBulkActions';
import { api } from '@/shared/api/client';
import AppCheckbox from '@/shared/ui/AppCheckbox.vue';
import Button from '@/shared/ui/Button.vue';
import ConfirmDialog from '@/shared/ui/ConfirmDialog.vue';
import ContentBulkBar from '@/shared/ui/ContentBulkBar.vue';
import FormField from '@/shared/ui/FormField.vue';
import Modal from '@/shared/ui/Modal.vue';
import PageHeader from '@/shared/ui/PageHeader.vue';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Gallery {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  isPublic: boolean;
}

interface Item {
  id: string;
  galleryId: string;
  fileUrl: string;
  caption: string | null;
  sortOrder: number;
}

interface GalleryDetail extends Gallery {
  items: Item[];
}

const items = ref<Gallery[]>([]);
const selected = ref<GalleryDetail | null>(null);
const loading = ref(true);
const loadingDetail = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

const galleryModalOpen = ref(false);
const editingGallery = ref<Gallery | null>(null);
const galleryForm = reactive({
  title: '',
  description: '',
  coverUrl: '',
  isPublic: true,
});

const itemModalOpen = ref(false);
const editingItem = ref<Item | null>(null);
const itemForm = reactive({
  fileUrl: '',
  caption: '',
  sortOrder: 0,
});

const confirmOpen = ref(false);
const confirmKind = ref<'gallery' | 'item' | null>(null);
const toDeleteId = ref<string | null>(null);
const deleting = ref(false);
const bulkDeleteOpen = ref(false);

async function loadList(): Promise<void> {
  loading.value = true;
  try {
    const res = await api.get<{ data: Gallery[] }>('/api/v1/galleries');
    items.value = res.data;
    if (selected.value && !items.value.find((g) => g.id === selected.value!.id)) {
      selected.value = null;
    }
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

async function selectGallery(id: string): Promise<void> {
  loadingDetail.value = true;
  try {
    const res = await api.get<{ data: GalleryDetail }>(`/api/v1/galleries/${id}`);
    selected.value = res.data;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loadingDetail.value = false;
  }
}

function resetGalleryForm(g?: Gallery | null): void {
  galleryForm.title = g?.title ?? '';
  galleryForm.description = g?.description ?? '';
  galleryForm.coverUrl = g?.coverUrl ?? '';
  galleryForm.isPublic = g?.isPublic ?? true;
}

function openCreateGallery(): void {
  editingGallery.value = null;
  resetGalleryForm(null);
  galleryModalOpen.value = true;
}

function openEditGallery(g: Gallery): void {
  editingGallery.value = g;
  resetGalleryForm(g);
  galleryModalOpen.value = true;
}

async function saveGallery(): Promise<void> {
  saving.value = true;
  error.value = null;
  try {
    const payload = {
      title: galleryForm.title,
      description: galleryForm.description || null,
      coverUrl: galleryForm.coverUrl || null,
      isPublic: galleryForm.isPublic,
    };
    if (editingGallery.value) {
      await api.patch(`/api/v1/galleries/${editingGallery.value.id}`, payload);
    } else {
      await api.post('/api/v1/galleries', payload);
    }
    galleryModalOpen.value = false;
    await loadList();
    if (selected.value && editingGallery.value?.id === selected.value.id) {
      await selectGallery(selected.value.id);
    }
  } catch (err) {
    const e = err as { body?: { error?: string } };
    error.value = e.body?.error ?? (err as Error).message;
  } finally {
    saving.value = false;
  }
}

function resetItemForm(i?: Item | null): void {
  itemForm.fileUrl = i?.fileUrl ?? '';
  itemForm.caption = i?.caption ?? '';
  itemForm.sortOrder = i?.sortOrder ?? 0;
}

function openCreateItem(): void {
  editingItem.value = null;
  resetItemForm(null);
  itemModalOpen.value = true;
}

function openEditItem(i: Item): void {
  editingItem.value = i;
  resetItemForm(i);
  itemModalOpen.value = true;
}

async function saveItem(): Promise<void> {
  if (!selected.value) return;
  saving.value = true;
  error.value = null;
  try {
    const payload = {
      fileUrl: itemForm.fileUrl,
      caption: itemForm.caption || null,
      sortOrder: itemForm.sortOrder,
    };
    if (editingItem.value) {
      await api.patch(`/api/v1/galleries/${selected.value.id}/items/${editingItem.value.id}`, payload);
    } else {
      await api.post(`/api/v1/galleries/${selected.value.id}/items`, payload);
    }
    itemModalOpen.value = false;
    await selectGallery(selected.value.id);
  } catch (err) {
    const e = err as { body?: { error?: string } };
    error.value = e.body?.error ?? (err as Error).message;
  } finally {
    saving.value = false;
  }
}

function askDeleteGallery(g: Gallery): void {
  confirmKind.value = 'gallery';
  toDeleteId.value = g.id;
  confirmOpen.value = true;
}

function askDeleteItem(i: Item): void {
  confirmKind.value = 'item';
  toDeleteId.value = i.id;
  confirmOpen.value = true;
}

async function doDelete(): Promise<void> {
  if (!toDeleteId.value) return;
  deleting.value = true;
  try {
    if (confirmKind.value === 'gallery') {
      await api.delete(`/api/v1/galleries/${toDeleteId.value}`);
      if (selected.value?.id === toDeleteId.value) selected.value = null;
      await loadList();
    } else if (confirmKind.value === 'item' && selected.value) {
      await api.delete(`/api/v1/galleries/${selected.value.id}/items/${toDeleteId.value}`);
      await selectGallery(selected.value.id);
    }
    confirmOpen.value = false;
    toDeleteId.value = null;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    deleting.value = false;
  }
}

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
} = useContentBulkActions(items, '/api/v1/galleries', 'album', loadList);

async function confirmBulkDelete(): Promise<void> {
  await bulkDelete();
  bulkDeleteOpen.value = false;
}

onMounted(loadList);
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader
      title="Galeri"
      description="Album foto & video kegiatan masjid"
      :crumbs="[{ label: 'Dashboard', to: '/' }, { label: 'Konten' }, { label: 'Galeri' }]"
    >
      <template #actions>
        <Button @click="openCreateGallery"><Plus class="h-4 w-4" /> Album baru</Button>
      </template>
    </PageHeader>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <ContentBulkBar
      :selected-count="selectedCount"
      :all-selected="isAllSelected"
      :acting="bulkActing"
      :error="bulkError"
      @toggle-all="toggleSelectAll"
      @clear="clearSelection"
    >
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

    <div class="grid grid-cols-1 gap-4 md:grid-cols-[18rem_1fr]">
      <Card class="overflow-hidden">
        <CardHeader class="border-b py-3">
          <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Album ({{ items.length }})
          </CardTitle>
        </CardHeader>
        <CardContent class="p-0">
          <div v-if="loading" class="flex flex-col gap-2 p-3">
            <Skeleton v-for="i in 4" :key="i" class="h-12 w-full" />
          </div>
          <ScrollArea v-else-if="items.length > 0" class="max-h-[70vh]">
          <ul class="divide-y divide-border">
            <li
              v-for="g in items"
              :key="g.id"
              class="flex cursor-pointer items-start justify-between gap-2 px-4 py-3 hover:bg-muted/50"
              :class="{
                'bg-accent': selected?.id === g.id,
                'bg-primary/5': isSelected(g.id),
              }"
              @click="selectGallery(g.id)"
            >
              <AppCheckbox
                class="mt-0.5 shrink-0"
                :model-value="isSelected(g.id)"
                @click.stop
                @update:model-value="toggleSelect(g.id)"
              />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-foreground">{{ g.title }}</p>
                <p class="text-[11px] text-muted-foreground">{{ g.isPublic ? 'Publik' : 'Internal' }}</p>
              </div>
              <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click.stop="openEditGallery(g)">
                <Pencil class="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" class="h-7 w-7 p-0 text-destructive" @click.stop="askDeleteGallery(g)">
                <Trash2 class="h-3.5 w-3.5" />
              </Button>
            </li>
          </ul>
          </ScrollArea>
          <p v-else class="px-4 py-6 text-center text-xs text-muted-foreground">Belum ada album.</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent class="pt-6">
          <div v-if="!selected" class="grid h-64 place-items-center text-sm text-muted-foreground">
            Pilih album di samping untuk melihat isi.
          </div>
          <div v-else>
            <header class="mb-3 flex items-start justify-between gap-2">
              <div>
                <h2 class="text-base font-semibold text-foreground">{{ selected.title }}</h2>
                <p class="text-xs text-muted-foreground">{{ selected.description ?? 'Tanpa deskripsi' }}</p>
              </div>
              <Button variant="secondary" size="sm" @click="openCreateItem"><ImagePlus class="h-3.5 w-3.5" /> Tambah</Button>
            </header>

            <div v-if="loadingDetail" class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              <Skeleton v-for="i in 6" :key="i" class="aspect-video w-full" />
            </div>
            <div v-else-if="selected.items.length > 0" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <article v-for="it in selected.items" :key="it.id" class="overflow-hidden rounded-lg border border-border">
                <div class="aspect-video bg-muted">
                  <img v-if="it.fileUrl" :src="it.fileUrl" :alt="it.caption ?? ''" class="h-full w-full object-cover" loading="lazy" />
                </div>
                <div class="px-2 py-1.5">
                  <p class="truncate text-[11px] text-foreground">{{ it.caption ?? '—' }}</p>
                  <div class="mt-0.5 flex items-center justify-between">
                    <span class="text-[11px] text-muted-foreground">#{{ it.sortOrder }}</span>
                    <div class="flex gap-1">
                      <Button variant="ghost" size="sm" class="h-6 w-6 p-0" @click="openEditItem(it)">
                        <Pencil class="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" class="h-6 w-6 p-0 text-destructive" @click="askDeleteItem(it)">
                        <Trash2 class="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              </article>
            </div>
            <p v-else class="text-center text-sm text-muted-foreground">Album masih kosong.</p>
          </div>
        </CardContent>
      </Card>
    </div>

    <Modal v-model:open="galleryModalOpen" :title="editingGallery ? 'Edit Album' : 'Album Baru'" size="md">
      <form class="space-y-3" @submit.prevent="saveGallery">
        <FormField label="Judul" required>
          <Input v-model="galleryForm.title" required minlength="2" />
        </FormField>
        <FormField label="Deskripsi">
          <Textarea v-model="galleryForm.description" rows="3" />
        </FormField>
        <FormField label="Cover (URL)">
          <Input v-model="galleryForm.coverUrl" />
        </FormField>
        <FormField label="Publik">
          <AppCheckbox v-model="galleryForm.isPublic" label="Tampilkan di portal publik" />
        </FormField>
      </form>
      <template #footer>
        <Button variant="secondary" @click="galleryModalOpen = false">Batal</Button>
        <Button :loading="saving" @click="saveGallery">{{ editingGallery ? 'Simpan' : 'Buat' }}</Button>
      </template>
    </Modal>

    <Modal v-model:open="itemModalOpen" :title="editingItem ? 'Edit Item' : 'Tambah Item'" size="md">
      <form class="space-y-3" @submit.prevent="saveItem">
        <FormField label="URL berkas" required>
          <Input v-model="itemForm.fileUrl" required />
        </FormField>
        <FormField label="Caption">
          <Input v-model="itemForm.caption" />
        </FormField>
        <FormField label="Urutan" hint="Angka kecil tampil duluan">
          <Input v-model.number="itemForm.sortOrder" type="number" min="0" />
        </FormField>
      </form>
      <template #footer>
        <Button variant="secondary" @click="itemModalOpen = false">Batal</Button>
        <Button :loading="saving" @click="saveItem">{{ editingItem ? 'Simpan' : 'Tambah' }}</Button>
      </template>
    </Modal>

    <ConfirmDialog
      v-model:open="confirmOpen"
      :title="confirmKind === 'gallery' ? 'Hapus album' : 'Hapus item'"
      :message="confirmKind === 'gallery' ? 'Album dan seluruh item di dalamnya akan dihapus.' : 'Item akan dihapus.'"
      :loading="deleting"
      @confirm="doDelete"
    />

    <ConfirmDialog
      v-model:open="bulkDeleteOpen"
      title="Hapus album terpilih"
      :message="`Hapus ${selectedCount} album terpilih beserta seluruh isinya?`"
      :loading="bulkActing"
      @confirm="confirmBulkDelete"
    />
  </div>
</template>