<script setup lang="ts">
/**
 * Transaksi keuangan — list + create/edit (draft only) + state-machine actions.
 *
 * State flow: draft → submitted → approved → posted (terminal). rejected → draft.
 * UI exposes the action buttons that the current status allows; backend enforces.
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { Plus, Pencil, Trash2, Send, Check, X, FileCheck2, Undo2, RotateCcw, Shield, AlertTriangle } from 'lucide-vue-next';
import { api } from '@/shared/api/client';
import { useAuthStore } from '@/features/auth/store';
import Button from '@/shared/ui/Button.vue';
import Modal from '@/shared/ui/Modal.vue';
import FormField from '@/shared/ui/FormField.vue';
import ConfirmDialog from '@/shared/ui/ConfirmDialog.vue';
import DateTimePicker from '@/shared/ui/DateTimePicker.vue';
import { INPUT_BASE, TEXTAREA_BASE } from '@/shared/ui/input-classes';
import TransactionLineEditor, { type Line } from './TransactionLineEditor.vue';

type Status = 'draft' | 'submitted' | 'approved' | 'rejected' | 'posted';

interface Transaction {
  id: string;
  transactionNo: string;
  transactionDate: string;
  categoryId: string | null;
  amount: string;
  description: string | null;
  referenceNo: string | null;
  status: Status;
  journalId: string | null;
  postedAt: string | null;
}

interface TransactionDetail extends Transaction {
  lines: Array<{
    id: string;
    accountId: string;
    debit: string;
    credit: string;
    description: string | null;
    sortOrder: number;
  }>;
}

interface Category {
  id: string;
  code: string;
  name: string;
  direction: 'income' | 'expense';
  debitAccountId: string;
  creditAccountId: string;
  isActive: boolean;
}

interface Account {
  id: string;
  code: string;
  name: string;
  accountType: string;
  isActive: boolean;
}

const auth = useAuthStore();
const items = ref<Transaction[]>([]);
const categories = ref<Category[]>([]);
const accounts = ref<Account[]>([]);
const loading = ref(true);
const saving = ref(false);
const acting = ref<string | null>(null);
const error = ref<string | null>(null);

const filterStatus = ref<'' | Status>('');

const editing = ref<Transaction | null>(null);
const modalOpen = ref(false);
const confirmOpen = ref(false);
const toDelete = ref<Transaction | null>(null);

const detail = ref<TransactionDetail | null>(null);
const detailOpen = ref(false);
const detailLoading = ref(false);

async function openDetail(t: Transaction): Promise<void> {
  detailOpen.value = true;
  detailLoading.value = true;
  detail.value = null;
  try {
    const res = await api.get<{ data: TransactionDetail }>(`/api/v1/transactions/${t.id}`);
    detail.value = res.data;
  } catch (err) {
    error.value = (err as Error).message;
    detailOpen.value = false;
  } finally {
    detailLoading.value = false;
  }
}

function closeDetail(): void {
  detailOpen.value = false;
  detail.value = null;
}

async function refreshDetail(): Promise<void> {
  if (!detail.value) return;
  try {
    const res = await api.get<{ data: TransactionDetail }>(`/api/v1/transactions/${detail.value.id}`);
    detail.value = res.data;
  } catch {
    closeDetail();
  }
}

function nowLocalIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const form = reactive({
  transactionDate: nowLocalIso(),
  categoryId: '' as string,
  description: '',
  referenceNo: '',
  lines: [] as Line[],
});

function resetForm(t?: TransactionDetail | Transaction | null): void {
  form.transactionDate = t?.transactionDate
    ? (() => {
        const d = new Date(t.transactionDate);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      })()
    : nowLocalIso();
  form.categoryId = t?.categoryId ?? '';
  form.description = t?.description ?? '';
  form.referenceNo = t?.referenceNo ?? '';
  if (t && 'lines' in t && t.lines.length > 0) {
    form.lines = t.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      description: l.description,
    }));
  } else {
    form.lines = [
      { accountId: '', debit: '0', credit: '0', description: null },
      { accountId: '', debit: '0', credit: '0', description: null },
    ];
  }
}

async function loadCategories(): Promise<void> {
  try {
    const res = await api.get<{ data: Category[] }>('/api/v1/transaction-categories');
    categories.value = res.data.filter((c) => c.isActive);
  } catch (err) {
    error.value = (err as Error).message;
  }
}

async function loadAccounts(): Promise<void> {
  try {
    const res = await api.get<{ data: Account[] }>('/api/v1/accounts');
    accounts.value = res.data.filter((a) => a.isActive);
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

async function openEdit(t: Transaction): Promise<void> {
  if (t.status !== 'draft') return;
  try {
    const res = await api.get<{ data: TransactionDetail }>(`/api/v1/transactions/${t.id}`);
    editing.value = t;
    resetForm(res.data);
    modalOpen.value = true;
  } catch (err) {
    error.value = (err as Error).message;
  }
}

async function save(): Promise<void> {
  saving.value = true;
  error.value = null;
  try {
    const lines = form.lines.filter((l) => l.accountId);
    const payload = {
      transactionDate: new Date(form.transactionDate).toISOString(),
      categoryId: form.categoryId || null,
      description: form.description || undefined,
      referenceNo: form.referenceNo || undefined,
      lines: lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit || '0',
        credit: l.credit || '0',
        description: l.description,
      })),
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
    if (detail.value?.id === toDelete.value.id) closeDetail();
    toDelete.value = null;
    await load();
  } catch (err) {
    const e = err as { body?: { error?: string } };
    error.value = e.body?.error ?? (err as Error).message;
  } finally {
    acting.value = null;
  }
}

async function transition(t: Transaction | TransactionDetail, action: 'submit' | 'approve' | 'reject' | 'post' | 'recall' | 'reset'): Promise<void> {
  acting.value = t.id;
  error.value = null;
  try {
    await api.post(`/api/v1/transactions/${t.id}/${action}`);
    await load();
    if (detail.value?.id === t.id) await refreshDetail();
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

function categoryLabel(id: string | null): string {
  if (!id) return 'Manual';
  const c = categoryMap.value.get(id);
  return c ? `${c.code} — ${c.name}` : '—';
}

function categoryDirection(id: string | null): 'income' | 'expense' | null {
  if (!id) return null;
  return categoryMap.value.get(id)?.direction ?? null;
}

function accountLabel(id: string): string {
  const a = accounts.value.find((x) => x.id === id);
  return a ? `${a.code} — ${a.name}` : id;
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
  return new Date(s).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── GOD MODE (super_admin only) ────────────────────────────────────────────
const forceEditOpen = ref(false);
const forceDeleteOpen = ref(false);
const forcing = ref(false);
const forceForm = reactive({
  reason: '',
  transactionDate: nowLocalIso(),
  categoryId: '' as string,
  description: '',
  referenceNo: '',
  lines: [] as Line[],
});
const forceDeleteReason = ref('');

function openForceEdit(): void {
  if (!detail.value) return;
  const d = new Date(detail.value.transactionDate);
  const pad = (n: number) => String(n).padStart(2, '0');
  forceForm.reason = '';
  forceForm.transactionDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  forceForm.categoryId = detail.value.categoryId ?? '';
  forceForm.description = detail.value.description ?? '';
  forceForm.referenceNo = detail.value.referenceNo ?? '';
  forceForm.lines = detail.value.lines.map((l) => ({
    accountId: l.accountId,
    debit: l.debit,
    credit: l.credit,
    description: l.description,
  }));
  forceEditOpen.value = true;
}

async function submitForceEdit(): Promise<void> {
  if (!detail.value) return;
  if (forceForm.reason.trim().length < 10) {
    error.value = 'Alasan force-edit minimal 10 karakter';
    return;
  }
  forcing.value = true;
  error.value = null;
  try {
    const lines = forceForm.lines.filter((l) => l.accountId);
    await api.patch(`/api/v1/transactions/${detail.value.id}/force-edit`, {
      reason: forceForm.reason,
      transactionDate: new Date(forceForm.transactionDate).toISOString(),
      categoryId: forceForm.categoryId || null,
      description: forceForm.description || null,
      referenceNo: forceForm.referenceNo || null,
      lines: lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit || '0',
        credit: l.credit || '0',
        description: l.description,
      })),
    });
    forceEditOpen.value = false;
    await load();
    await refreshDetail();
  } catch (err) {
    const e = err as { body?: { error?: string; detail?: string } };
    error.value = e.body?.detail ?? e.body?.error ?? (err as Error).message;
  } finally {
    forcing.value = false;
  }
}

function openForceDelete(): void {
  if (!detail.value) return;
  forceDeleteReason.value = '';
  forceDeleteOpen.value = true;
}

async function submitForceDelete(): Promise<void> {
  if (!detail.value) return;
  if (forceDeleteReason.value.trim().length < 10) {
    error.value = 'Alasan force-delete minimal 10 karakter';
    return;
  }
  forcing.value = true;
  error.value = null;
  try {
    await api.deleteWithBody(`/api/v1/transactions/${detail.value.id}/force-delete`, {
      reason: forceDeleteReason.value,
    });
    forceDeleteOpen.value = false;
    closeDetail();
    await load();
  } catch (err) {
    const e = err as { body?: { error?: string; detail?: string } };
    error.value = e.body?.detail ?? e.body?.error ?? (err as Error).message;
  } finally {
    forcing.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadCategories(), loadAccounts(), load()]);
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
          <tr
            v-for="t in items"
            :key="t.id"
            class="cursor-pointer hover:bg-slate-50"
            @click="openDetail(t)"
          >
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
            <td class="px-4 py-3" @click.stop>
              <div class="flex items-center justify-end gap-1.5">
                <template v-if="t.status === 'draft'">
                  <Button variant="secondary" size="sm" @click="openEdit(t)">
                    <Pencil class="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button variant="ghost" size="sm" :loading="acting === t.id" @click="transition(t, 'submit')">
                    <Send class="h-3.5 w-3.5" /> Ajukan
                  </Button>
                  <Button variant="ghost" size="sm" @click="askDelete(t)">
                    <Trash2 class="h-3.5 w-3.5 text-red-600" />
                  </Button>
                </template>
                <template v-else-if="t.status === 'submitted'">
                  <Button variant="ghost" size="sm" :loading="acting === t.id" @click="transition(t, 'approve')">
                    <Check class="h-3.5 w-3.5 text-emerald-600" /> Setujui
                  </Button>
                  <Button variant="ghost" size="sm" :loading="acting === t.id" @click="transition(t, 'reject')">
                    <X class="h-3.5 w-3.5 text-red-600" /> Tolak
                  </Button>
                  <Button variant="ghost" size="sm" :loading="acting === t.id" @click="transition(t, 'recall')">
                    <Undo2 class="h-3.5 w-3.5" /> Tarik
                  </Button>
                </template>
                <template v-else-if="t.status === 'rejected'">
                  <Button variant="secondary" size="sm" :loading="acting === t.id" @click="transition(t, 'reset')">
                    <RotateCcw class="h-3.5 w-3.5" /> Revisi
                  </Button>
                </template>
                <template v-else-if="t.status === 'approved'">
                  <Button variant="ghost" size="sm" :loading="acting === t.id" @click="transition(t, 'post')">
                    <FileCheck2 class="h-3.5 w-3.5 text-emerald-600" /> Posting
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

    <Modal v-model:open="modalOpen" :title="editing ? 'Edit Transaksi' : 'Transaksi Baru'" size="xl">
      <form class="space-y-4" @submit.prevent="save">
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="Tanggal & waktu" required>
            <DateTimePicker v-model="form.transactionDate" required />
          </FormField>
          <FormField label="Nomor referensi" hint="Opsional (mis. nomor kuitansi)">
            <input v-model="form.referenceNo" :class="INPUT_BASE" />
          </FormField>
        </div>
        <FormField label="Keterangan">
          <textarea v-model="form.description" :class="TEXTAREA_BASE" rows="2" placeholder="Mis. Infaq Jumat 24 Mei 2026" />
        </FormField>

        <div>
          <label class="mb-1.5 block text-sm font-medium text-slate-700">Baris jurnal (debit/kredit)</label>
          <TransactionLineEditor
            :lines="form.lines"
            :accounts="accounts"
            :categories="categories"
            :category-id="form.categoryId || null"
            :amount-hint="null"
            @update:lines="(v) => (form.lines = v)"
            @update:category-id="(v) => (form.categoryId = v ?? '')"
          />
        </div>
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

    <Modal v-model:open="detailOpen" :title="detail ? `Transaksi ${detail.transactionNo}` : 'Detail Transaksi'" size="xl">
      <div v-if="detailLoading" class="space-y-3">
        <div class="h-6 w-1/3 animate-pulse rounded bg-slate-100" />
        <div class="h-32 animate-pulse rounded bg-slate-100" />
      </div>
      <div v-else-if="detail" class="space-y-4">
        <div class="flex items-center justify-between">
          <span class="rounded-full px-2.5 py-1 text-xs font-medium" :class="STATUS_BADGE[detail.status]">
            {{ STATUS_LABEL[detail.status] }}
          </span>
          <span
            class="font-mono text-lg font-semibold tabular-nums"
            :class="categoryDirection(detail.categoryId) === 'income' ? 'text-emerald-700' : 'text-slate-900'"
          >
            {{ categoryDirection(detail.categoryId) === 'income' ? '+' : categoryDirection(detail.categoryId) === 'expense' ? '−' : '' }} {{ fmtIDR(detail.amount) }}
          </span>
        </div>

        <dl class="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-500">Tanggal & waktu</dt>
            <dd class="mt-0.5 text-slate-900">{{ fmtDate(detail.transactionDate) }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-500">Kategori</dt>
            <dd class="mt-0.5 text-slate-900">{{ categoryLabel(detail.categoryId) }}</dd>
          </div>
          <div v-if="detail.referenceNo">
            <dt class="text-xs uppercase tracking-wide text-slate-500">No. referensi</dt>
            <dd class="mt-0.5 font-mono text-xs text-slate-700">{{ detail.referenceNo }}</dd>
          </div>
          <div v-if="detail.postedAt">
            <dt class="text-xs uppercase tracking-wide text-slate-500">Diposting</dt>
            <dd class="mt-0.5 text-slate-900">{{ fmtDate(detail.postedAt) }}</dd>
          </div>
          <div v-if="detail.description" class="md:col-span-2">
            <dt class="text-xs uppercase tracking-wide text-slate-500">Keterangan</dt>
            <dd class="mt-0.5 whitespace-pre-wrap text-slate-700">{{ detail.description }}</dd>
          </div>
          <div v-if="detail.journalId" class="md:col-span-2">
            <dt class="text-xs uppercase tracking-wide text-slate-500">Jurnal</dt>
            <dd class="mt-0.5 font-mono text-xs text-slate-700">{{ detail.journalId }}</dd>
          </div>
        </dl>

        <div class="overflow-hidden rounded-xl border border-slate-200">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th class="w-8 px-2 py-2 font-medium">#</th>
                <th class="px-3 py-2 font-medium">Akun</th>
                <th class="px-3 py-2 font-medium">Keterangan</th>
                <th class="w-32 px-3 py-2 text-right font-medium">Debit</th>
                <th class="w-32 px-3 py-2 text-right font-medium">Kredit</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr v-for="(l, i) in detail.lines" :key="l.id">
                <td class="px-2 py-2 text-center text-xs text-slate-400">{{ i + 1 }}</td>
                <td class="px-3 py-2">{{ accountLabel(l.accountId) }}</td>
                <td class="px-3 py-2 text-xs text-slate-600">{{ l.description ?? '—' }}</td>
                <td class="px-3 py-2 text-right font-mono tabular-nums">{{ Number(l.debit) > 0 ? fmtIDR(l.debit) : '—' }}</td>
                <td class="px-3 py-2 text-right font-mono tabular-nums">{{ Number(l.credit) > 0 ? fmtIDR(l.credit) : '—' }}</td>
              </tr>
            </tbody>
            <tfoot class="border-t border-slate-200 bg-slate-50">
              <tr>
                <td colspan="3" class="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Total</td>
                <td class="px-3 py-2 text-right font-mono text-sm font-semibold tabular-nums">{{ fmtIDR(detail.amount) }}</td>
                <td class="px-3 py-2 text-right font-mono text-sm font-semibold tabular-nums">{{ fmtIDR(detail.amount) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p v-if="detail.status === 'submitted'" class="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Sudah diajukan. Pembuat dapat menarik kembali (Tarik) untuk merevisi, atau menunggu approver menyetujui/menolak.
        </p>
        <p v-else-if="detail.status === 'rejected'" class="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
          Ditolak approver. Klik <strong>Revisi</strong> untuk kembalikan ke draft dan perbaiki datanya.
        </p>
        <p v-else-if="detail.status === 'approved'" class="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
          Sudah disetujui dan siap diposting. Setelah posting, transaksi tidak dapat dihapus — koreksi hanya via transaksi pembalik.
        </p>
        <p v-else-if="detail.status === 'posted'" class="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Sudah diposting ke jurnal. Untuk koreksi, buat transaksi pembalik dengan nominal yang sama dan kategori berlawanan.
        </p>

        <div v-if="auth.isSuperAdmin" class="rounded-lg border border-rose-200 bg-rose-50/50 px-3 py-2.5">
          <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-rose-700">
            <Shield class="h-3.5 w-3.5" /> GOD MODE — super admin only
          </div>
          <p class="mt-1 text-xs text-rose-700/80">
            Force-edit/delete melewati state machine. Setiap aksi tercatat di approval log dengan alasan.
          </p>
          <div class="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" @click="openForceEdit">
              <Pencil class="h-3.5 w-3.5" /> Force edit
            </Button>
            <Button variant="secondary" size="sm" @click="openForceDelete">
              <AlertTriangle class="h-3.5 w-3.5 text-rose-600" /> Force delete
            </Button>
          </div>
        </div>
      </div>
      <template #footer>
        <Button variant="secondary" @click="closeDetail">Tutup</Button>
        <template v-if="detail">
          <template v-if="detail.status === 'draft'">
            <Button variant="ghost" :loading="acting === detail.id" @click="transition(detail, 'submit')">
              <Send class="h-4 w-4" /> Ajukan
            </Button>
            <Button variant="ghost" @click="closeDetail(); openEdit(detail)">
              <Pencil class="h-4 w-4" /> Edit
            </Button>
            <Button variant="ghost" @click="askDelete(detail)">
              <Trash2 class="h-4 w-4 text-red-600" /> Hapus
            </Button>
          </template>
          <template v-else-if="detail.status === 'submitted'">
            <Button variant="ghost" :loading="acting === detail.id" @click="transition(detail, 'recall')">
              <Undo2 class="h-4 w-4" /> Tarik kembali
            </Button>
            <Button variant="ghost" :loading="acting === detail.id" @click="transition(detail, 'reject')">
              <X class="h-4 w-4 text-red-600" /> Tolak
            </Button>
            <Button :loading="acting === detail.id" @click="transition(detail, 'approve')">
              <Check class="h-4 w-4" /> Setujui
            </Button>
          </template>
          <template v-else-if="detail.status === 'rejected'">
            <Button :loading="acting === detail.id" @click="transition(detail, 'reset')">
              <RotateCcw class="h-4 w-4" /> Revisi
            </Button>
          </template>
          <template v-else-if="detail.status === 'approved'">
            <Button :loading="acting === detail.id" @click="transition(detail, 'post')">
              <FileCheck2 class="h-4 w-4" /> Posting jurnal
            </Button>
          </template>
        </template>
      </template>
    </Modal>

    <Modal v-model:open="forceEditOpen" title="GOD MODE — Force edit transaksi" size="xl">
      <form class="space-y-4" @submit.prevent="submitForceEdit">
        <div class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <strong>Peringatan.</strong> Aksi ini melewati state machine. Untuk transaksi <code>posted</code>,
          jurnal akan dihapus dan status dikembalikan ke <code>approved</code> (perlu posting ulang). Alasan wajib (≥10 karakter) dan tercatat di approval log.
        </div>
        <FormField label="Alasan force-edit" required>
          <textarea
            v-model="forceForm.reason"
            :class="TEXTAREA_BASE"
            rows="2"
            minlength="10"
            required
            placeholder="Mis. salah input nominal infaq Jumat"
          />
        </FormField>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="Tanggal & waktu" required>
            <DateTimePicker v-model="forceForm.transactionDate" required />
          </FormField>
          <FormField label="Nomor referensi">
            <input v-model="forceForm.referenceNo" :class="INPUT_BASE" />
          </FormField>
        </div>
        <FormField label="Keterangan">
          <textarea v-model="forceForm.description" :class="TEXTAREA_BASE" rows="2" />
        </FormField>
        <div>
          <label class="mb-1.5 block text-sm font-medium text-slate-700">Baris jurnal</label>
          <TransactionLineEditor
            :lines="forceForm.lines"
            :accounts="accounts"
            :categories="categories"
            :category-id="forceForm.categoryId || null"
            :amount-hint="null"
            @update:lines="(v) => (forceForm.lines = v)"
            @update:category-id="(v) => (forceForm.categoryId = v ?? '')"
          />
        </div>
      </form>
      <template #footer>
        <Button variant="secondary" @click="forceEditOpen = false">Batal</Button>
        <Button :loading="forcing" @click="submitForceEdit">Simpan paksa</Button>
      </template>
    </Modal>

    <Modal v-model:open="forceDeleteOpen" title="GOD MODE — Force delete transaksi" size="md">
      <div class="space-y-3">
        <div class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <strong>Peringatan.</strong> Transaksi akan di-soft-delete, jurnal terkait dihapus permanen.
          Aksi ini melewati state machine. Audit log mempertahankan jejak.
        </div>
        <p class="text-sm text-slate-700">
          Hapus transaksi <strong>{{ detail?.transactionNo }}</strong>?
        </p>
        <FormField label="Alasan force-delete" required>
          <textarea
            v-model="forceDeleteReason"
            :class="TEXTAREA_BASE"
            rows="3"
            minlength="10"
            required
            placeholder="Mis. duplikat dari TX-XXXX-202605-0042"
          />
        </FormField>
      </div>
      <template #footer>
        <Button variant="secondary" @click="forceDeleteOpen = false">Batal</Button>
        <Button :loading="forcing" @click="submitForceDelete">Hapus paksa</Button>
      </template>
    </Modal>
  </div>
</template>
