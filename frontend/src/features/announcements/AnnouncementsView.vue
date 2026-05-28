<script setup lang="ts">
/**
 * Pengumuman list + create/edit modal + delete confirm.
 *
 * - List: filter by status (all/draft/published) + scope, paginated.
 * - Create: title + body + scope + optional publishedAt.
 * - Edit: same form pre-filled.
 * - Delete: ConfirmDialog → DELETE.
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { Plus, Pencil, Trash2 } from 'lucide-vue-next';
import { api } from '@/shared/api/client';
import Button from '@/shared/ui/Button.vue';
import Modal from '@/shared/ui/Modal.vue';
import FormField from '@/shared/ui/FormField.vue';
import ConfirmDialog from '@/shared/ui/ConfirmDialog.vue';
import Pagination from '@/shared/ui/Pagination.vue';
import DateTimePicker from '@/shared/ui/DateTimePicker.vue';
import { INPUT_BASE, TEXTAREA_BASE } from '@/shared/ui/input-classes';

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

const total = computed(() => items.value.length); // Simple — backend doesn't return total count yet.

const editing = ref<Announcement | null>(null);
const modalOpen = ref(false);
const confirmOpen = ref(false);
const toDelete = ref<Announcement | null>(null);

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
  <div class="space-y-4">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-slate-900">Pengumuman</h1>
        <p class="text-sm text-slate-500">Kelola pengumuman masjid</p>
      </div>
      <Button @click="openCreate"><Plus class="h-4 w-4" /> Tambah</Button>
    </header>

    <div class="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <select v-model="filterStatus" :class="INPUT_BASE" style="max-width:160px" @change="(offset = 0, load())">
        <option value="all">Semua status</option>
        <option value="draft">Draft</option>
        <option value="published">Terpublikasi</option>
      </select>
      <select v-model="filterScope" :class="INPUT_BASE" style="max-width:160px" @change="(offset = 0, load())">
        <option value="">Semua skup</option>
        <option value="public">Publik</option>
        <option value="internal">Internal</option>
        <option value="urgent">Darurat</option>
      </select>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

    <div v-if="loading" class="space-y-2">
      <div v-for="i in 3" :key="i" class="h-16 animate-pulse rounded-xl bg-white border border-slate-200" />
    </div>

    <div v-else class="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <ul v-if="items.length > 0" class="divide-y divide-slate-100">
        <li v-for="a in items" :key="a.id" class="flex items-start justify-between gap-4 px-5 py-4">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-slate-900">{{ a.title }}</p>
            <p class="mt-0.5 line-clamp-2 text-xs text-slate-500">{{ a.body }}</p>
            <div class="mt-1 flex items-center gap-2 text-[11px]">
              <span
                class="rounded-full px-2 py-0.5 font-medium"
                :class="a.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'"
              >{{ a.status }}</span>
              <span class="text-slate-500">{{ a.scope }}</span>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" @click="openEdit(a)"><Pencil class="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="sm" @click="askDelete(a)"><Trash2 class="h-3.5 w-3.5 text-red-600" /></Button>
          </div>
        </li>
      </ul>
      <p v-else class="px-5 py-10 text-center text-sm text-slate-500">Belum ada pengumuman.</p>
      <Pagination
        v-if="items.length > 0"
        :total="total"
        :offset="offset"
        :limit="limit"
        :loading="loading"
        @prev="(offset = Math.max(0, offset - limit), load())"
        @next="(offset = offset + limit, load())"
      />
    </div>

    <Modal v-model:open="modalOpen" :title="editing ? 'Edit Pengumuman' : 'Pengumuman Baru'" size="lg">
      <form class="space-y-3" @submit.prevent="save">
        <FormField label="Judul" required>
          <input v-model="form.title" :class="INPUT_BASE" required minlength="2" />
        </FormField>
        <FormField label="Isi" required>
          <textarea v-model="form.body" :class="TEXTAREA_BASE" rows="6" required />
        </FormField>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Skup">
            <select v-model="form.scope" :class="INPUT_BASE">
              <option value="public">Publik</option>
              <option value="internal">Internal</option>
              <option value="urgent">Darurat</option>
            </select>
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
  </div>
</template>
