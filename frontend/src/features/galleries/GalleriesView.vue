<script setup lang="ts">
/**
 * Galleries — list view + drilldown drawer for items.
 *
 * Two-pane layout: list on left, selected gallery's items on right.
 * Items have add/edit/delete + drag-free sortOrder edit.
 */
import { onMounted, reactive, ref } from 'vue';
import { Plus, Pencil, Trash2, ImagePlus } from 'lucide-vue-next';
import { api } from '@/shared/api/client';
import Button from '@/shared/ui/Button.vue';
import Modal from '@/shared/ui/Modal.vue';
import FormField from '@/shared/ui/FormField.vue';
import ConfirmDialog from '@/shared/ui/ConfirmDialog.vue';
import { INPUT_BASE, TEXTAREA_BASE } from '@/shared/ui/input-classes';

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

// Gallery modal
const galleryModalOpen = ref(false);
const editingGallery = ref<Gallery | null>(null);
const galleryForm = reactive({
  title: '',
  description: '',
  coverUrl: '',
  isPublic: true,
});

// Item modal
const itemModalOpen = ref(false);
const editingItem = ref<Item | null>(null);
const itemForm = reactive({
  fileUrl: '',
  caption: '',
  sortOrder: 0,
});

// Confirms
const confirmOpen = ref(false);
const confirmKind = ref<'gallery' | 'item' | null>(null);
const toDeleteId = ref<string | null>(null);
const deleting = ref(false);

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

onMounted(loadList);
</script>

<template>
  <div class="space-y-4">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-slate-900">Galeri</h1>
        <p class="text-sm text-slate-500">Album foto & video kegiatan masjid</p>
      </div>
      <Button @click="openCreateGallery"><Plus class="h-4 w-4" /> Album baru</Button>
    </header>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

    <div class="grid grid-cols-1 gap-4 md:grid-cols-[18rem_1fr]">
      <aside class="rounded-xl border border-slate-200 bg-white">
        <header class="border-b border-slate-100 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Album ({{ items.length }})
        </header>
        <div v-if="loading" class="space-y-2 p-3">
          <div v-for="i in 4" :key="i" class="h-12 animate-pulse rounded-lg bg-slate-100" />
        </div>
        <ul v-else-if="items.length > 0" class="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
          <li
            v-for="g in items"
            :key="g.id"
            class="flex cursor-pointer items-start justify-between gap-2 px-4 py-3 hover:bg-slate-50"
            :class="{ 'bg-brand-50/40': selected?.id === g.id }"
            @click="selectGallery(g.id)"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-slate-900">{{ g.title }}</p>
              <p class="text-[11px] text-slate-500">{{ g.isPublic ? 'Publik' : 'Internal' }}</p>
            </div>
            <button class="text-slate-400 hover:text-slate-700" @click.stop="openEditGallery(g)">
              <Pencil class="h-3.5 w-3.5" />
            </button>
            <button class="text-red-400 hover:text-red-600" @click.stop="askDeleteGallery(g)">
              <Trash2 class="h-3.5 w-3.5" />
            </button>
          </li>
        </ul>
        <p v-else class="px-4 py-6 text-center text-xs text-slate-500">Belum ada album.</p>
      </aside>

      <section class="rounded-xl border border-slate-200 bg-white p-4">
        <div v-if="!selected" class="grid h-64 place-items-center text-sm text-slate-500">
          Pilih album di samping untuk melihat isi.
        </div>
        <div v-else>
          <header class="mb-3 flex items-start justify-between gap-2">
            <div>
              <h2 class="text-base font-semibold text-slate-900">{{ selected.title }}</h2>
              <p class="text-xs text-slate-500">{{ selected.description ?? 'Tanpa deskripsi' }}</p>
            </div>
            <Button variant="secondary" size="sm" @click="openCreateItem"><ImagePlus class="h-3.5 w-3.5" /> Tambah</Button>
          </header>

          <div v-if="loadingDetail" class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <div v-for="i in 6" :key="i" class="aspect-video animate-pulse rounded-lg bg-slate-100" />
          </div>
          <div v-else-if="selected.items.length > 0" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <article v-for="it in selected.items" :key="it.id" class="overflow-hidden rounded-lg border border-slate-200">
              <div class="aspect-video bg-slate-100">
                <img v-if="it.fileUrl" :src="it.fileUrl" :alt="it.caption ?? ''" class="h-full w-full object-cover" loading="lazy" />
              </div>
              <div class="px-2 py-1.5">
                <p class="truncate text-[11px] text-slate-700">{{ it.caption ?? '—' }}</p>
                <div class="mt-0.5 flex items-center justify-between">
                  <span class="text-[11px] text-slate-400">#{{ it.sortOrder }}</span>
                  <div class="flex gap-1">
                    <button class="text-slate-400 hover:text-slate-700" @click="openEditItem(it)">
                      <Pencil class="h-3 w-3" />
                    </button>
                    <button class="text-red-400 hover:text-red-600" @click="askDeleteItem(it)">
                      <Trash2 class="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            </article>
          </div>
          <p v-else class="text-center text-sm text-slate-500">Album masih kosong.</p>
        </div>
      </section>
    </div>

    <Modal v-model:open="galleryModalOpen" :title="editingGallery ? 'Edit Album' : 'Album Baru'" size="md">
      <form class="space-y-3" @submit.prevent="saveGallery">
        <FormField label="Judul" required>
          <input v-model="galleryForm.title" :class="INPUT_BASE" required minlength="2" />
        </FormField>
        <FormField label="Deskripsi">
          <textarea v-model="galleryForm.description" :class="TEXTAREA_BASE" rows="3" />
        </FormField>
        <FormField label="Cover (URL)">
          <input v-model="galleryForm.coverUrl" :class="INPUT_BASE" />
        </FormField>
        <FormField label="Publik">
          <label class="inline-flex items-center gap-2 text-sm">
            <input v-model="galleryForm.isPublic" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
            Tampilkan di portal publik
          </label>
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
          <input v-model="itemForm.fileUrl" :class="INPUT_BASE" required />
        </FormField>
        <FormField label="Caption">
          <input v-model="itemForm.caption" :class="INPUT_BASE" />
        </FormField>
        <FormField label="Urutan" hint="Angka kecil tampil duluan">
          <input v-model.number="itemForm.sortOrder" type="number" min="0" :class="INPUT_BASE" />
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
  </div>
</template>
