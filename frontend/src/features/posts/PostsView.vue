<script setup lang="ts">
/**
 * Posts (Berita) — list + create/edit/delete.
 *
 * Body kept as plain textarea for MVP. Rich-text editor (TipTap) can be
 * dropped in later as a single component swap without changing this view.
 */
import { onMounted, reactive, ref } from 'vue';
import { Plus, Pencil, Trash2 } from 'lucide-vue-next';
import { api } from '@/shared/api/client';
import Button from '@/shared/ui/Button.vue';
import Modal from '@/shared/ui/Modal.vue';
import FormField from '@/shared/ui/FormField.vue';
import ConfirmDialog from '@/shared/ui/ConfirmDialog.vue';
import { INPUT_BASE, TEXTAREA_BASE } from '@/shared/ui/input-classes';

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

const editing = ref<Post | null>(null);
const modalOpen = ref(false);
const confirmOpen = ref(false);
const toDelete = ref<Post | null>(null);

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
  draft: 'bg-slate-100 text-slate-600',
  published: 'bg-emerald-50 text-emerald-700',
  archived: 'bg-amber-50 text-amber-700',
};

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-slate-900">Berita & Artikel</h1>
        <p class="text-sm text-slate-500">Kelola publikasi tertulis untuk portal masjid</p>
      </div>
      <Button @click="openCreate"><Plus class="h-4 w-4" /> Tambah</Button>
    </header>

    <div class="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <select v-model="filterStatus" :class="INPUT_BASE" style="max-width:160px" @change="load()">
        <option value="">Semua status</option>
        <option value="draft">Draft</option>
        <option value="published">Terbit</option>
        <option value="archived">Arsip</option>
      </select>
      <input
        v-model="search"
        :class="INPUT_BASE"
        style="max-width:280px"
        placeholder="Cari judul / kutipan…"
        @keydown.enter="load()"
      />
      <Button variant="secondary" size="sm" @click="load()">Cari</Button>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

    <div v-if="loading" class="space-y-2">
      <div v-for="i in 3" :key="i" class="h-20 animate-pulse rounded-xl bg-white border border-slate-200" />
    </div>

    <div v-else-if="items.length > 0" class="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <ul class="divide-y divide-slate-100">
        <li v-for="p in items" :key="p.id" class="flex items-start justify-between gap-4 px-5 py-4">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p class="truncate text-sm font-medium text-slate-900">{{ p.title }}</p>
              <span class="rounded-full px-2 py-0.5 text-[11px] font-medium" :class="STATUS_BADGE[p.status]">
                {{ STATUS_LABEL[p.status] }}
              </span>
            </div>
            <p class="mt-0.5 line-clamp-2 text-xs text-slate-500">{{ p.excerpt ?? p.body.slice(0, 160) }}</p>
            <p class="mt-1 text-[11px] text-slate-400">
              {{ p.publishedAt ? new Date(p.publishedAt).toLocaleString('id-ID') : 'belum dipublikasikan' }}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" @click="openEdit(p)"><Pencil class="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="sm" @click="askDelete(p)"><Trash2 class="h-3.5 w-3.5 text-red-600" /></Button>
          </div>
        </li>
      </ul>
    </div>

    <p v-else class="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">
      Belum ada berita.
    </p>

    <Modal v-model:open="modalOpen" :title="editing ? 'Edit Berita' : 'Berita Baru'" size="xl">
      <form class="space-y-3" @submit.prevent="save">
        <FormField label="Judul" required>
          <input v-model="form.title" :class="INPUT_BASE" required minlength="2" />
        </FormField>
        <FormField label="Kutipan (excerpt)" hint="Ringkasan singkat untuk daftar & SEO">
          <textarea v-model="form.excerpt" :class="TEXTAREA_BASE" rows="2" />
        </FormField>
        <FormField label="Isi" required>
          <textarea v-model="form.body" :class="TEXTAREA_BASE" rows="10" required />
        </FormField>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Cover (URL)">
            <input v-model="form.coverUrl" :class="INPUT_BASE" />
          </FormField>
          <FormField label="Status">
            <select v-model="form.status" :class="INPUT_BASE">
              <option value="draft">Draft</option>
              <option value="published">Terbit</option>
              <option value="archived">Arsip</option>
            </select>
          </FormField>
          <FormField label="SEO title">
            <input v-model="form.seoTitle" :class="INPUT_BASE" />
          </FormField>
          <FormField label="SEO description">
            <input v-model="form.seoDescription" :class="INPUT_BASE" />
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
  </div>
</template>
