<script setup lang="ts">
/**
 * Transaksi keuangan — list + create/edit (draft only) + state-machine actions.
 *
 * State flow: draft → submitted → approved → posted (terminal). rejected → draft.
 * UI exposes the action buttons that the current status allows; backend enforces.
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { Plus, Pencil, Trash2, Send, Check, X, FileCheck2 } from 'lucide-vue-next';
import { api } from '@/shared/api/client';
import Button from '@/shared/ui/Button.vue';
import Modal from '@/shared/ui/Modal.vue';
import FormField from '@/shared/ui/FormField.vue';
import ConfirmDialog from '@/shared/ui/ConfirmDialog.vue';
import { INPUT_BASE, TEXTAREA_BASE } from '@/shared/ui/input-classes';

type Status = 'draft' | 'submitted' | 'approved' | 'rejected' | 'posted';

interface Transaction {
  id: string;
  transactionNo: string;
  transactionDate: string;
  categoryId: string;
  amount: string;
  description: string | null;
  referenceNo: string | null;
  status: Status;
  journalId: string | null;
  postedAt: string | null;
}

interface Category {
  id: string;
  code: string;
  name: string;
  direction: 'income' | 'expense';
  isActive: boolean;
}

const items = ref<Transaction[]>([]);
const categories = ref<Category[]>([]);
const loading = ref(true);
const saving = ref(false);
const acting = ref<string | null>(null);
const error = ref<string | null>(null);

const filterStatus = ref<'' | Status>('');

const editing = ref<Transaction | null>(null);
const modalOpen = ref(false);
const confirmOpen = ref(false);
const toDelete = ref<Transaction | null>(null);

const form = reactive({
  transactionDate: new Date().toISOString().slice(0, 10),
  categoryId: '',
  amount: '',
  description: '',
  referenceNo: '',
});

function resetForm(t?: Transaction | null): void {
  form.transactionDate = t?.transactionDate ? t.transactionDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
  form.categoryId = t?.categoryId ?? '';
  form.amount = t?.amount ?? '';
  form.description = t?.description ?? '';
  form.referenceNo = t?.referenceNo ?? '';
}

async function loadCategories(): Promise<void> {
  try {
    const res = await api.get<{ data: Category[] }>('/api/v1/transaction-categories');
    categories.value = res.data.filter((c) => c.isActive);
  } catch (err) {
    error.value = (err as Error).message;
  }
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await api.get<{ data: Transaction[] }>('/api/v1/transactions', {
      query: { status: filterStatus.value || undefined },
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

function openEdit(t: Transaction): void {
  if (t.status !== 'draft') return;
  editing.value = t;
  resetForm(t);
  modalOpen.value = true;
}

async function save(): Promise<void> {
  saving.value = true;
  error.value = null;
  try {
    const payload = {
      transactionDate: new Date(form.transactionDate).toISOString(),
      categoryId: form.categoryId,
      amount: form.amount,
      description: form.description || undefined,
      referenceNo: form.referenceNo || undefined,
    };
    if (editing.value) {
      await api.patch(`/api/v1/transactions/${editing.value.id}`, payload);
    } else {
      await api.post('/api/v1/transactions', payload);
    }
    modalOpen.value = false;
    await load();
  } catch (err) {
    const e = err as { body?: { error?: string; detail?: string } };
    error.value = e.body?.detail ?? e.body?.error ?? (err as Error).message;
  } finally {
    saving.value = false;
  }
}

function askDelete(t: Transaction): void {
  if (t.status !== 'draft') return;
  toDelete.value = t;
  confirmOpen.value = true;
}

async function doDelete(): Promise<void> {
  if (!toDelete.value) return;
  acting.value = toDelete.value.id;
  try {
    await api.delete(`/api/v1/transactions/${toDelete.value.id}`);
    confirmOpen.value = false;
    toDelete.value = null;
    await load();
  } catch (err) {
    const e = err as { body?: { error?: string } };
    error.value = e.body?.error ?? (err as Error).message;
  } finally {
    acting.value = null;
  }
}

async function transition(t: Transaction, action: 'submit' | 'approve' | 'reject' | 'post'): Promise<void> {
  acting.value = t.id;
  error.value = null;
  try {
    await api.post(`/api/v1/transactions/${t.id}/${action}`);
    await load();
  } catch (err) {
    const e = err as { body?: { error?: string; detail?: string } };
    error.value = e.body?.detail ?? e.body?.error ?? (err as Error).message;
  } finally {
    acting.value = null;
  }
}

const categoryMap = computed(() => {
  const m = new Map<string, Category>();
  for (const c of categories.value) m.set(c.id, c);
  return m;
});

function categoryLabel(id: string): string {
  const c = categoryMap.value.get(id);
  return c ? `${c.code} — ${c.name}` : '—';
}

function categoryDirection(id: string): 'income' | 'expense' | null {
  return categoryMap.value.get(id)?.direction ?? null;
}

const STATUS_LABEL: Record<Status, string> = {
  draft: 'Draft',
  submitted: 'Diajukan',
  approved: 'Disetujui',
  rejected: 'Ditolak',
  posted: 'Diposting',
};

const STATUS_BADGE: Record<Status, string> = {
  draft: 'bg-slate-100 text-slate-600',
  submitted: 'bg-amber-50 text-amber-700',
  approved: 'bg-blue-50 text-blue-700',
  rejected: 'bg-rose-50 text-rose-700',
  posted: 'bg-emerald-50 text-emerald-700',
};

function fmtIDR(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

onMounted(async () => {
  await Promise.all([loadCategories(), load()]);
});
</script>

<template>
  <div class="space-y-4">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-slate-900">Transaksi</h1>
        <p class="text-sm text-slate-500">Catat pemasukan & pengeluaran. Posting otomatis menghasilkan jurnal.</p>
      </div>
      <Button @click="openCreate"><Plus class="h-4 w-4" /> Tambah</Button>
    </header>

    <div class="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <select v-model="filterStatus" :class="INPUT_BASE" style="max-width:180px" @change="load()">
        <option value="">Semua status</option>
        <option value="draft">Draft</option>
        <option value="submitted">Diajukan</option>
        <option value="approved">Disetujui</option>
        <option value="rejected">Ditolak</option>
        <option value="posted">Diposting</option>
      </select>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

    <div v-if="loading" class="space-y-2">
      <div v-for="i in 4" :key="i" class="h-20 animate-pulse rounded-xl bg-white border border-slate-200" />
    </div>

    <div v-else-if="items.length > 0" class="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-2.5 font-medium">No / Tanggal</th>
            <th class="px-4 py-2.5 font-medium">Kategori</th>
            <th class="px-4 py-2.5 text-right font-medium">Nominal</th>
            <th class="px-4 py-2.5 font-medium">Status</th>
            <th class="px-4 py-2.5 text-right font-medium">Aksi</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="t in items" :key="t.id" class="hover:bg-slate-50">
            <td class="px-4 py-3">
              <p class="font-mono text-xs text-slate-700">{{ t.transactionNo }}</p>
              <p class="text-xs text-slate-500">{{ fmtDate(t.transactionDate) }}</p>
            </td>
            <td class="px-4 py-3">
              <p class="text-sm text-slate-900">{{ categoryLabel(t.categoryId) }}</p>
              <p v-if="t.description" class="line-clamp-1 text-xs text-slate-500">{{ t.description }}</p>
            </td>
            <td class="px-4 py-3 text-right font-mono text-sm tabular-nums" :class="categoryDirection(t.categoryId) === 'income' ? 'text-emerald-700' : 'text-slate-900'">
              {{ categoryDirection(t.categoryId) === 'income' ? '+' : '−' }} {{ fmtIDR(t.amount) }}
            </td>
            <td class="px-4 py-3">
              <span class="rounded-full px-2 py-0.5 text-[11px] font-medium" :class="STATUS_BADGE[t.status]">
                {{ STATUS_LABEL[t.status] }}
              </span>
            </td>
            <td class="px-4 py-3">
              <div class="flex items-center justify-end gap-1">
                <template v-if="t.status === 'draft'">
                  <Button variant="ghost" size="sm" :loading="acting === t.id" title="Ajukan" @click="transition(t, 'submit')">
                    <Send class="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" title="Edit" @click="openEdit(t)">
                    <Pencil class="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" title="Hapus" @click="askDelete(t)">
                    <Trash2 class="h-3.5 w-3.5 text-red-600" />
                  </Button>
                </template>
                <template v-else-if="t.status === 'submitted'">
                  <Button variant="ghost" size="sm" :loading="acting === t.id" title="Setujui" @click="transition(t, 'approve')">
                    <Check class="h-3.5 w-3.5 text-emerald-600" />
                  </Button>
                  <Button variant="ghost" size="sm" :loading="acting === t.id" title="Tolak" @click="transition(t, 'reject')">
                    <X class="h-3.5 w-3.5 text-red-600" />
                  </Button>
                </template>
                <template v-else-if="t.status === 'approved'">
                  <Button variant="ghost" size="sm" :loading="acting === t.id" title="Posting (jurnal)" @click="transition(t, 'post')">
                    <FileCheck2 class="h-3.5 w-3.5 text-emerald-600" />
                  </Button>
                </template>
                <span v-else class="text-xs text-slate-400">—</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else class="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">
      Belum ada transaksi.
    </p>

    <Modal v-model:open="modalOpen" :title="editing ? 'Edit Transaksi' : 'Transaksi Baru'" size="lg">
      <form class="space-y-3" @submit.prevent="save">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Tanggal" required>
            <input v-model="form.transactionDate" type="date" :class="INPUT_BASE" required />
          </FormField>
          <FormField label="Kategori" required>
            <select v-model="form.categoryId" :class="INPUT_BASE" required>
              <option value="" disabled>Pilih kategori…</option>
              <option v-for="c in categories" :key="c.id" :value="c.id">
                {{ c.code }} — {{ c.name }} ({{ c.direction === 'income' ? 'pemasukan' : 'pengeluaran' }})
              </option>
            </select>
          </FormField>
          <FormField label="Nominal (Rp)" required>
            <input v-model="form.amount" :class="INPUT_BASE" placeholder="100000.00" required pattern="^\d+(\.\d{1,2})?$" />
          </FormField>
          <FormField label="Nomor referensi" hint="Opsional (mis. nomor kuitansi)">
            <input v-model="form.referenceNo" :class="INPUT_BASE" />
          </FormField>
        </div>
        <FormField label="Keterangan">
          <textarea v-model="form.description" :class="TEXTAREA_BASE" rows="3" />
        </FormField>
      </form>
      <template #footer>
        <Button variant="secondary" @click="modalOpen = false">Batal</Button>
        <Button :loading="saving" @click="save">{{ editing ? 'Simpan' : 'Buat' }}</Button>
      </template>
    </Modal>

    <ConfirmDialog
      v-model:open="confirmOpen"
      title="Hapus transaksi"
      :message="`Transaksi ${toDelete?.transactionNo ?? ''} akan dihapus.`"
      :loading="acting !== null"
      @confirm="doDelete"
    />
  </div>
</template>
