<script setup lang="ts">
/**
 * Transaksi keuangan — list + create/edit (draft only) + state-machine actions.
 *
 * State flow: draft → submitted → approved → posted (terminal). rejected → draft.
 * UI exposes the action buttons that the current status allows; backend enforces.
 */
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { Plus, Pencil, Trash2, Send, Check, X, FileCheck2, Undo2, RotateCcw, Shield, AlertTriangle, Upload, Filter, Search, Scale, Inbox, ArrowUpRight, ArrowDownRight, Calendar, BookOpen, Tag, Wallet, Hash, Info } from 'lucide-vue-next';
import { api } from '@/shared/api/client';
import { useDelayedLoading } from '@/shared/composables/useDelayedLoading';
import { useReferenceDataStore } from '@/shared/stores/reference-data';
import { useAuthStore } from '@/features/auth/store';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Button from '@/shared/ui/Button.vue';
import Modal from '@/shared/ui/Modal.vue';
import FormField from '@/shared/ui/FormField.vue';
import ConfirmDialog from '@/shared/ui/ConfirmDialog.vue';
import DatePicker from '@/shared/ui/DatePicker.vue';
import DateTimePicker from '@/shared/ui/DateTimePicker.vue';
import SortableHeader from '@/shared/ui/SortableHeader.vue';
import AccountSelect from '@/shared/ui/AccountSelect.vue';
import Pagination from '@/shared/ui/Pagination.vue';
import PageHeader from '@/shared/ui/PageHeader.vue';
import AppSelect from '@/shared/ui/AppSelect.vue';
import AppCheckbox from '@/shared/ui/AppCheckbox.vue';
import MoneyText from '@/shared/ui/MoneyText.vue';
import MoneyInput from '@/shared/ui/MoneyInput.vue';
import StatusBadge from '@/shared/ui/StatusBadge.vue';
import { generateCategoryCode } from '@/shared/lib/category-code';
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
  /** Dari API: kategori atau inferensi baris jurnal */
  direction?: 'income' | 'expense' | null;
}

interface TransactionDetail extends Transaction {
  lines: Array<{
    id: string;
    accountId: string;
    fundId: string | null;
    debit: string;
    credit: string;
    description: string | null;
    sortOrder: number;
  }>;
}

interface Fund {
  id: string;
  code: string;
  name: string;
  isRestricted: boolean;
  isActive: boolean;
}

interface Category {
  id: string;
  code: string;
  name: string;
  direction: 'income' | 'expense';
  debitAccountId: string | null;
  creditAccountId: string | null;
  defaultFundId?: string | null;
  isActive: boolean;
}

interface Account {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  accountType: string;
  isActive: boolean;
}

const auth = useAuthStore();
const refData = useReferenceDataStore();
const router = useRouter();
const route = useRoute();
const pageLoading = useDelayedLoading(120);
const accountFilterId = ref<string | null>(null);
const accountFilterLabel = ref('');
const accountFilterName = ref('');
const items = ref<Transaction[]>([]);
const categories = ref<Category[]>([]);
const accounts = ref<Account[]>([]);
const funds = ref<Fund[]>([]);
const listLoading = ref(false);
const saving = ref(false);
const acting = ref<string | null>(null);
const error = ref<string | null>(null);
const transactionError = ref<string | null>(null);
const detailError = ref<string | null>(null);
const forceEditError = ref<string | null>(null);
const forceDeleteError = ref<string | null>(null);

// ─── Mass Edit (bulk action) ─────────────────────────────────────────────────
const selectedIds = ref(new Set<string>());
const bulkActing = ref(false);
const bulkError = ref<string | null>(null);

const selectedCount = computed(() => selectedIds.value.size);

const selectedItems = computed(() =>
  items.value.filter((t) => selectedIds.value.has(t.id)),
);

/** Status unik dari item yg dipilih — buat tentuin bulk action valid apa. */
const selectedStates = computed(() => {
  const s = new Set(selectedItems.value.map((t) => t.status));
  return [...s] as Status[];
});

const isAllSelected = computed(() =>
  sortedItems.value.length > 0 && sortedItems.value.every((t) => selectedIds.value.has(t.id)),
);

function toggleSelectAll(): void {
  if (isAllSelected.value) {
    selectedIds.value = new Set();
  } else {
    selectedIds.value = new Set(sortedItems.value.map((t) => t.id));
  }
}

function toggleSelect(id: string): void {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
}

function clearSelection(): void {
  selectedIds.value = new Set();
  bulkError.value = null;
}

/**
 * Bulk action yang valid berdasarkan status terpilih.
 * Bisnis rule: harus semua status sama. Kalau campur, gak bisa bulk.
 */
const availableBulkActions = computed(() => {
  if (selectedCount.value === 0) return [];
  const states = selectedStates.value;
  if (states.length !== 1) return []; // campur = gak bisa bulk
  const s = states[0];
  switch (s) {
    case 'draft':
      return [
        { action: 'submit' as const, label: `Ajukan (${selectedCount.value})`, icon: Send },
        { action: 'delete' as const, label: `Hapus (${selectedCount.value})`, icon: Trash2 },
      ];
    case 'submitted':
      return [
        { action: 'approve' as const, label: `Setujui (${selectedCount.value})`, icon: Check },
        { action: 'reject' as const, label: `Tolak (${selectedCount.value})`, icon: X },
        { action: 'recall' as const, label: `Tarik (${selectedCount.value})`, icon: Undo2 },
      ];
    case 'rejected':
      return [
        { action: 'reset' as const, label: `Revisi (${selectedCount.value})`, icon: RotateCcw },
      ];
    case 'approved':
      return [
        { action: 'post' as const, label: `Posting (${selectedCount.value})`, icon: FileCheck2 },
      ];
    default:
      return [];
  }
});

async function executeBulkAction(action: 'submit' | 'approve' | 'reject' | 'post' | 'recall' | 'reset' | 'delete'): Promise<void> {
  if (selectedIds.value.size === 0) return;
  bulkActing.value = true;
  bulkError.value = null;
  let failed = 0;
  let firstError = '';
  const ids = [...selectedIds.value];
  for (const id of ids) {
    try {
      if (action === 'delete') {
        await api.delete(`/api/v1/transactions/${id}`);
      } else {
        await api.post(`/api/v1/transactions/${id}/${action}`);
      }
    } catch (err) {
      failed++;
      if (!firstError) {
        const e = err as { body?: { error?: string; detail?: string } };
        firstError = e.body?.detail ?? e.body?.error ?? (err as Error).message;
      }
    }
  }
  clearSelection();
  await load();
  if (failed > 0) {
    bulkError.value = `${failed} dari ${ids.length} transaksi gagal diproses${firstError ? ` — ${firstError}` : ''}`;
  }
  bulkActing.value = false;
}

const filterStatus = ref<'' | Status>('');
/** Filter arah server-side (kategori + inferensi jurnal). */
const filterDirection = ref<'' | 'income' | 'expense'>('');

// ─── Pagination & Search ─────────────────────────────────────────────────────
const search = ref('');
const offset = ref(0);
const limit = ref(50);
const total = ref(0);

/** Agregat posted dari API (seluruh filter, bukan cuma 1 halaman). */
const summaryIncome = ref(0);
const summaryExpense = ref(0);

// ─── Period filter ────────────────────────────────────────────────────────────
type Period = '' | 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';
/** Default bulan ini — KPI & list selaras dengan label operasional. */
const period = ref<Period>('month');
const dateFrom = ref('');
const dateTo = ref('');

const periodPresets: { label: string; value: Period }[] = [
  { label: 'Semua waktu', value: '' },
  { label: 'Hari ini', value: 'today' },
  { label: 'Minggu ini', value: 'week' },
  { label: 'Bulan ini', value: 'month' },
  { label: '3 Bulan', value: 'quarter' },
  { label: 'Tahun ini', value: 'year' },
  { label: 'Custom', value: 'custom' },
];

/** Local calendar date (hindari geser hari karena toISOString = UTC). */
function toDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function applyPeriod(p: Period): void {
  period.value = p;
  const now = new Date();
  switch (p) {
    case 'today':
      dateFrom.value = toDateStr(now);
      dateTo.value = toDateStr(now);
      break;
    case 'week': {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay()); // Senin
      // Jika Minggu, mundur seminggu
      if (now.getDay() === 0) start.setDate(start.getDate() - 7);
      dateFrom.value = toDateStr(start);
      dateTo.value = toDateStr(now);
      break;
    }
    case 'month': {
      dateFrom.value = toDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
      dateTo.value = toDateStr(now);
      break;
    }
    case 'quarter': {
      const q = new Date(now);
      q.setMonth(q.getMonth() - 3);
      dateFrom.value = toDateStr(q);
      dateTo.value = toDateStr(now);
      break;
    }
    case 'year': {
      dateFrom.value = toDateStr(new Date(now.getFullYear(), 0, 1));
      dateTo.value = toDateStr(now);
      break;
    }
    case 'custom':
      // Biarkan dateFrom/dateTo kosong — user isi sendiri
      break;
    default:
      dateFrom.value = '';
      dateTo.value = '';
      break;
  }
  if (p !== 'custom') {
    onSearchInput();
  }
}

function applyCustomRange(): void {
  if (period.value === 'custom') {
    onSearchInput();
  }
}

// Client-side sort within the loaded page
type SortField = 'transactionNo' | 'transactionDate' | 'category' | 'amount' | 'status';
const sort = ref<{ field: SortField; dir: 'asc' | 'desc' } | null>({
  field: 'transactionDate',
  dir: 'desc',
});
function setSort(field: SortField, dir: 'asc' | 'desc' | null): void {
  sort.value = dir ? { field, dir } : null;
}

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
  detailError.value = null;
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
  amountHint: '',
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
  form.amountHint = '';
  form.description = t?.description ?? '';
  form.referenceNo = t?.referenceNo ?? '';
  if (t && 'lines' in t && t.lines.length > 0) {
    form.lines = t.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      description: l.description,
      fundId: l.fundId ?? null,
    }));
  } else {
    form.lines = [
      { accountId: '', debit: '0', credit: '0', description: null, fundId: null },
      { accountId: '', debit: '0', credit: '0', description: null, fundId: null },
    ];
  }
}

/** Pastikan nominal di header langsung mengisi debit baris 1 & kredit baris 2. */
function syncAmountToLines(fromInput?: string): void {
  const raw = String(fromInput ?? form.amountHint ?? '').trim();
  if (!raw || raw === '0') return;
  // parse: dukung "1.793.000" maupun "1793000"
  let cleaned = raw.replace(/^Rp\.?\s*/i, '').replace(/\s/g, '');
  if (cleaned.includes(',')) cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  else cleaned = cleaned.replace(/\./g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return;
  const amount = String(n);
  while (form.lines.length < 2) {
    form.lines.push({ accountId: '', debit: '0', credit: '0', description: null, fundId: null });
  }
  const a = form.lines[0]!;
  const b = form.lines[1]!;
  form.lines = [
    { ...a, debit: amount, credit: '0' },
    { ...b, debit: '0', credit: amount },
    ...form.lines.slice(2),
  ];
}

async function loadReferenceData(): Promise<void> {
  try {
    const [cats, accs, fundsRes] = await Promise.all([
      refData.ensureCategories(),
      refData.ensureAccounts(),
      api.get<{ data: Fund[] }>('/api/v1/funds'),
    ]);
    categories.value = cats;
    accounts.value = accs;
    funds.value = fundsRes.data;
  } catch (err) {
    error.value = (err as Error).message;
  }
}

async function load(): Promise<void> {
  const showFullSkeleton = items.value.length === 0;
  if (showFullSkeleton) pageLoading.start();
  else listLoading.value = true;
  error.value = null;
  try {
    const res = await api.get<{
      data: Transaction[];
      total: number;
      offset: number;
      limit: number;
      summary?: { incomeTotal: string; expenseTotal: string; scope: string };
    }>('/api/v1/transactions', {
      query: {
        status: filterStatus.value || undefined,
        q: search.value || undefined,
        offset: offset.value,
        limit: limit.value,
        dateFrom: dateFrom.value || undefined,
        dateTo: dateTo.value || undefined,
        accountId: accountFilterId.value || undefined,
        direction: filterDirection.value || undefined,
      },
    });
    items.value = res.data;
    total.value = res.total;
    summaryIncome.value = Number(res.summary?.incomeTotal ?? 0);
    summaryExpense.value = Number(res.summary?.expenseTotal ?? 0);
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    pageLoading.stop();
    listLoading.value = false;
  }
}

function setPage(o: number): void {
  clearSelection();
  offset.value = o;
  load();
}

function onSearchInput(): void {
  clearSelection();
  offset.value = 0;
  load();
}

// Debounced search: panggil API 300ms setelah user berhenti mengetik
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(onSearchInput, 300);
});
onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer);
});

function openCreate(): void {
  editing.value = null;
  resetForm(null);
  modalOpen.value = true;
}

async function openEdit(t: Transaction): Promise<void> {
  if (t.status !== 'draft') return;
  transactionError.value = null;
  try {
    const res = await api.get<{ data: TransactionDetail }>(`/api/v1/transactions/${t.id}`);
    editing.value = t;
    resetForm(res.data);
    modalOpen.value = true;
  } catch (err) {
    error.value = (err as Error).message;
  }
}

const journalTotal = computed(() => {
  const debit = form.lines.reduce((a, l) => a + Number(l.debit || 0), 0);
  const credit = form.lines.reduce((a, l) => a + Number(l.credit || 0), 0);
  return debit === credit && debit > 0 ? debit : null;
});

function validateTransactionForm(): string | null {
  const withAmount = form.lines.filter(
    (l) => Number(l.debit || 0) > 0 || Number(l.credit || 0) > 0,
  );
  const firstMissingIdx = form.lines.findIndex(
    (l) => (Number(l.debit || 0) > 0 || Number(l.credit || 0) > 0) && !l.accountId,
  );
  if (firstMissingIdx >= 0) {
    const cat = categories.value.find((c) => c.id === form.categoryId);
    const row = firstMissingIdx + 1;
    if (cat?.direction === 'expense' && !cat.creditAccountId) {
      return `Baris ${row}: pilih akun sumber dana (mis. Kas atau Bank). Kategori "${cat.name}" hanya memetakan akun beban — akun kredit perlu dipilih manual.`;
    }
    if (cat?.direction === 'income' && !cat.debitAccountId) {
      return `Baris ${row}: pilih akun penerimaan (mis. Kas atau Bank). Kategori "${cat.name}" hanya memetakan akun pendapatan — akun debit perlu dipilih manual.`;
    }
    return `Baris ${row}: pilih akun COA untuk setiap baris yang berisi nominal.`;
  }

  const validLines = form.lines.filter((l) => l.accountId);
  if (validLines.length < 2) {
    return 'Double-entry butuh minimal 2 baris jurnal dengan akun terpilih.';
  }

  const totalDebit = validLines.reduce((a, l) => a + Number(l.debit || 0), 0);
  const totalCredit = validLines.reduce((a, l) => a + Number(l.credit || 0), 0);
  if (totalDebit !== totalCredit || totalDebit <= 0) {
    return 'Jurnal belum seimbang — total debit harus sama dengan total kredit dan lebih dari nol.';
  }

  if (withAmount.length < 2) {
    return 'Isi minimal 2 baris jurnal (debit dan kredit).';
  }

  // Multi-dana (LAZ/PSAK 109): tanpa fund_id, transaksi tetap posted tapi
  // tidak masuk kartu dana / SPD / Buku Dana — sering terasa "hanya 1 yang masuk".
  if (funds.value.length > 0) {
    const missingFund = withAmount.filter((l) => l.accountId && !l.fundId);
    if (missingFund.length > 0) {
      return 'Pilih Dana (mis. PAP 2026 / Infak) di header jurnal. Tanpa tag dana, nominal tidak masuk laporan per-dana.';
    }
  }

  return null;
}

/** Bendahara (post) atau GOD mode / super_admin — boleh skip alur ajukan→setujui. */
const canExpressPost = computed(
  () =>
    auth.isSuperAdmin ||
    auth.hasPermission('transactions.post') ||
    auth.hasPermission('transactions.god_mode'),
);
const canImportPap = computed(
  () =>
    auth.isSuperAdmin ||
    (auth.hasPermission('transactions.create') && auth.hasPermission('transactions.post')),
);

async function save(opts?: { expressPost?: boolean }): Promise<void> {
  saving.value = true;
  transactionError.value = null;
  const validationErr = validateTransactionForm();
  if (validationErr) {
    transactionError.value = validationErr;
    saving.value = false;
    return;
  }
  const expressPost = !!opts?.expressPost && canExpressPost.value;
  try {
    const lines = form.lines.filter((l) => l.accountId);
    const payload = {
      transactionDate: new Date(form.transactionDate).toISOString(),
      categoryId: form.categoryId || null,
      description: form.description || undefined,
      referenceNo: form.referenceNo || undefined,
      lines: lines.map((l) => ({
        accountId: l.accountId,
        fundId: l.fundId ?? null,
        debit: l.debit || '0',
        credit: l.credit || '0',
        description: l.description,
      })),
      ...(expressPost && !editing.value ? { expressPost: true } : {}),
    };
    if (editing.value) {
      await api.patch(`/api/v1/transactions/${editing.value.id}`, payload);
      if (expressPost) {
        await api.post(`/api/v1/transactions/${editing.value.id}/express-post`);
      }
    } else {
      await api.post('/api/v1/transactions', payload);
    }
    modalOpen.value = false;
    await load();
  } catch (err) {
    const e = err as { body?: { error?: string; detail?: string; draftId?: string } };
    transactionError.value = e.body?.detail ?? e.body?.error ?? (err as Error).message;
  } finally {
    saving.value = false;
  }
}

async function expressPostRow(t: Transaction | TransactionDetail): Promise<void> {
  if (!canExpressPost.value) return;
  if (t.status === 'posted' || t.status === 'rejected') return;
  acting.value = t.id;
  detailError.value = null;
  try {
    await api.post(`/api/v1/transactions/${t.id}/express-post`);
    await load();
    if (detail.value?.id === t.id) await refreshDetail();
  } catch (err) {
    const e = err as { body?: { error?: string; detail?: string } };
    const msg = e.body?.detail ?? e.body?.error ?? (err as Error).message;
    if (detail.value?.id === t.id) detailError.value = msg;
    else error.value = msg;
  } finally {
    acting.value = null;
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
  detailError.value = null;
  try {
    await api.post(`/api/v1/transactions/${t.id}/${action}`);
    await load();
    if (detail.value?.id === t.id) await refreshDetail();
  } catch (err) {
    const e = err as { body?: { error?: string; detail?: string } };
    detailError.value = e.body?.detail ?? e.body?.error ?? (err as Error).message;
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

function accountParts(id: string): { code: string; name: string } {
  const a = accounts.value.find((x) => x.id === id);
  if (!a) return { code: id.slice(0, 8), name: id };
  return { code: a.code, name: a.name };
}

function fundLabel(id: string | null | undefined): string {
  if (!id) return '—';
  const f = funds.value.find((x) => x.id === id);
  return f ? f.name : '—';
}

function fundCode(id: string | null | undefined): string | null {
  if (!id) return null;
  return funds.value.find((x) => x.id === id)?.code ?? null;
}

/** Arah dari kategori; fallback dari tipe akun baris jurnal (Manual). */
function detailDirectionOf(t: TransactionDetail | null): 'income' | 'expense' | null {
  if (!t) return null;
  const fromCat = categoryDirection(t.categoryId);
  if (fromCat) return fromCat;
  for (const l of t.lines) {
    const a = accounts.value.find((x) => x.id === l.accountId);
    if (!a) continue;
    if (a.accountType === 'income' && Number(l.credit) > 0) return 'income';
    if (a.accountType === 'expense' && Number(l.debit) > 0) return 'expense';
  }
  return null;
}

const detailDirection = computed(() => detailDirectionOf(detail.value));

const detailFundSummary = computed(() => {
  if (!detail.value) return [] as string[];
  const names = new Set<string>();
  for (const l of detail.value.lines) {
    const n = fundLabel(l.fundId);
    if (n !== '—') names.add(n);
  }
  return [...names];
});

/** Arah list: field API, fallback kategori. */
function txDirection(t: Transaction): 'income' | 'expense' | null {
  if (t.direction === 'income' || t.direction === 'expense') return t.direction;
  return categoryDirection(t.categoryId);
}

const sortedItems = computed<Transaction[]>(() => {
  // direction filter sudah di server; di sini hanya sort client
  let arr = [...items.value];
  const s = sort.value;
  if (!s) return arr;
  const mul = s.dir === 'asc' ? 1 : -1;
  arr.sort((a, b) => {
    switch (s.field) {
      case 'transactionNo':
        return mul * a.transactionNo.localeCompare(b.transactionNo, undefined, { numeric: true });
      case 'transactionDate': {
        const da = new Date(a.transactionDate).getTime();
        const db = new Date(b.transactionDate).getTime();
        if (da !== db) return mul * (da - db);
        // Tiebreak: transaction number ascending
        return a.transactionNo.localeCompare(b.transactionNo, undefined, { numeric: true });
      }
      case 'category':
        return mul * categoryLabel(a.categoryId).localeCompare(categoryLabel(b.categoryId));
      case 'amount':
        return mul * (Number(a.amount) - Number(b.amount));
      case 'status':
        return mul * a.status.localeCompare(b.status);
    }
  });
  return arr;
});

/** Pill warna kategori — border jelas + diamond seperti mock. */
const CAT_PILL: Record<string, { pill: string; dot: string }> = {
  income: {
    pill: 'border border-emerald-200/90 bg-emerald-50 text-emerald-900',
    dot: 'bg-emerald-600',
  },
  expense: {
    pill: 'border border-sky-200/90 bg-sky-50 text-sky-900',
    dot: 'bg-sky-500',
  },
};
function categoryPill(id: string | null) {
  const dir = categoryDirection(id);
  if (dir === 'income') return CAT_PILL.income;
  if (dir === 'expense') return CAT_PILL.expense;
  return {
    pill: 'border border-[#D0CCC0] bg-[#FAF9F5] text-muted-foreground',
    dot: 'bg-muted-foreground',
  };
}

function fmtDateShort(s: string): string {
  return new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

function categoryNameOnly(id: string | null): string {
  if (!id) return '—';
  return categoryMap.value.get(id)?.name ?? '—';
}

const filterStatusOptions = [
  { value: '', label: 'Semua status' },
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Diajukan' },
  { value: 'approved', label: 'Disetujui' },
  { value: 'rejected', label: 'Ditolak' },
  { value: 'posted', label: 'Diposting' },
];

const directionOptions = [
  { value: 'income', label: 'Pemasukan' },
  { value: 'expense', label: 'Pengeluaran' },
];

function fmtDate(s: string): string {
  return new Date(s).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtTime(s: string): string {
  return new Date(s).toLocaleString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDateHeader(s: string): string {
  return new Date(s).toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function cardTitle(t: Transaction): string {
  if (t.description?.trim()) return t.description.trim();
  const label = categoryLabel(t.categoryId);
  const dash = label.indexOf(' — ');
  return dash >= 0 ? label.slice(dash + 3) : label;
}

const groupedTransactions = computed(() => {
  const groups = new Map<string, Transaction[]>();
  for (const t of sortedItems.value) {
    const key = fmtDateHeader(t.transactionDate);
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([date, txs]) => ({ date, txs }));
});

// ─── KPI: agregat posted dari API (seluruh rentang filter, bukan 1 halaman) ──
const pageIncomeTotal = computed(() => summaryIncome.value);
const pageExpenseTotal = computed(() => summaryExpense.value);
const pageNetTotal = computed(() => pageIncomeTotal.value - pageExpenseTotal.value);

/** Label rentang mengikuti filter periode (bukan hardcode "bulan ini"). */
const statsRangeLabel = computed(() => {
  switch (period.value) {
    case 'today':
      return 'hari ini';
    case 'week':
      return 'minggu ini';
    case 'month':
      return 'bulan ini';
    case 'quarter':
      return '3 bulan terakhir';
    case 'year':
      return 'tahun ini';
    case 'custom':
      if (dateFrom.value && dateTo.value) return `${dateFrom.value} – ${dateTo.value}`;
      if (dateFrom.value) return `dari ${dateFrom.value}`;
      if (dateTo.value) return `sampai ${dateTo.value}`;
      return 'rentang custom';
    default:
      return 'semua waktu';
  }
});

function relativeDayLabel(s: string): string | null {
  const d = new Date(s);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return 'Hari ini';
  if (diffDays === 1) return 'Kemarin';
  return null;
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
  amountHint: '' as string,
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
  // Canonical amount untuk template kategori — jangan null (nanti applyCategory jadi 0)
  forceForm.amountHint = String(detail.value.amount ?? '').replace(/[^\d.]/g, '') || '';
  forceForm.lines = detail.value.lines.map((l) => ({
    accountId: l.accountId,
    debit: l.debit,
    credit: l.credit,
    description: l.description,
    fundId: l.fundId ?? null,
  }));
  forceEditError.value = null;
  forceEditOpen.value = true;
}

async function submitForceEdit(): Promise<void> {
  if (!detail.value) return;
  if (forceForm.reason.trim().length < 10) {
    forceEditError.value = 'Alasan force-edit minimal 10 karakter';
    return;
  }
  forcing.value = true;
  forceEditError.value = null;
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
        fundId: l.fundId ?? null,
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
    forceEditError.value = e.body?.detail ?? e.body?.error ?? (err as Error).message;
  } finally {
    forcing.value = false;
  }
}

async function submitForceDelete(): Promise<void> {
  if (!detail.value) return;
  if (forceDeleteReason.value.trim().length < 10) {
    forceDeleteError.value = 'Alasan force-delete minimal 10 karakter';
    return;
  }
  forcing.value = true;
  forceDeleteError.value = null;
  try {
    await api.deleteWithBody(`/api/v1/transactions/${detail.value.id}/force-delete`, {
      reason: forceDeleteReason.value,
    });
    forceDeleteOpen.value = false;
    closeDetail();
    await load();
  } catch (err) {
    const e = err as { body?: { error?: string; detail?: string } };
    forceDeleteError.value = e.body?.detail ?? e.body?.error ?? (err as Error).message;
  } finally {
    forcing.value = false;
  }
}

function openForceDelete(): void {
  if (!detail.value) return;
  forceDeleteReason.value = '';
  forceDeleteError.value = null;
  forceDeleteOpen.value = true;
}

// ─── Inline create kategori (dipanggil dari editor) ─────────────────────────
const newCatOpen = ref(false);
const newCatSaving = ref(false);
const newCatTarget = ref<'form' | 'force'>('form');
const newCatError = ref<string | null>(null);
const newCatCodeManual = ref(false);
const newCat = reactive({
  code: '',
  name: '',
  direction: 'income' as 'income' | 'expense',
  debitAccountId: '',
  creditAccountId: '',
  defaultFundId: '',
});

const newCatFundOptions = computed(() => [
  { value: '', label: '— Tanpa default dana —' },
  ...funds.value.map((f) => ({
    value: f.id,
    label: f.isRestricted ? `${f.name} *` : f.name,
  })),
]);

watch(
  () => [newCat.name, newCat.direction] as const,
  ([n, d]) => {
    if (newCatCodeManual.value) return;
    newCat.code = generateCategoryCode(n, d);
  },
);

function onNewCatCodeInput(): void {
  newCatCodeManual.value = true;
}

function openNewCategory(target: 'form' | 'force'): void {
  newCatTarget.value = target;
  newCat.code = '';
  newCat.name = '';
  newCat.direction = 'income';
  newCat.debitAccountId = '';
  newCat.creditAccountId = '';
  newCat.defaultFundId = '';
  newCatCodeManual.value = false;
  newCatError.value = null;
  newCatOpen.value = true;
}

function friendlyNewCatError(code: string | undefined, missing?: string[]): string {
  switch (code) {
    case 'credit_required_for_income':
      return 'Akun kredit wajib untuk kategori pemasukan';
    case 'debit_required_for_expense':
      return 'Akun debit wajib untuk kategori pengeluaran';
    case 'invalid_accounts':
      return `Akun tidak valid${missing?.length ? ` (${missing.join(', ')})` : ''}`;
    case 'invalid_fund':
      return 'Dana default tidak valid';
    case 'code_taken':
      return 'Kode kategori sudah dipakai';
    default:
      return code ?? 'Gagal menyimpan kategori';
  }
}

async function saveNewCategory(): Promise<void> {
  if (!newCat.code || !newCat.name) {
    newCatError.value = 'Lengkapi kode dan nama';
    return;
  }
  if (newCat.direction === 'income' && !newCat.creditAccountId) {
    newCatError.value = 'Akun kredit wajib untuk kategori pemasukan';
    return;
  }
  if (newCat.direction === 'expense' && !newCat.debitAccountId) {
    newCatError.value = 'Akun debit wajib untuk kategori pengeluaran';
    return;
  }
  newCatSaving.value = true;
  newCatError.value = null;
  try {
    const res = await api.post<{ data: Category }>('/api/v1/transaction-categories', {
      code: newCat.code,
      name: newCat.name,
      direction: newCat.direction,
      debitAccountId: newCat.debitAccountId || null,
      creditAccountId: newCat.creditAccountId || null,
      defaultFundId: newCat.defaultFundId || null,
      isActive: true,
    });
    categories.value = [...categories.value, res.data];
    refData.invalidate();
    void refData.ensureCategories(true);
    if (newCatTarget.value === 'form') form.categoryId = res.data.id;
    else forceForm.categoryId = res.data.id;
    // Terapkan akun + dana default; jaga nominal existing (force-edit / form)
    const fundId = res.data.defaultFundId || null;
    const sourceLines =
      newCatTarget.value === 'form' ? form.lines : forceForm.lines;
    let amount =
      newCatTarget.value === 'form'
        ? form.amountHint || forceForm.amountHint || '0'
        : forceForm.amountHint || '0';
    if (!amount || amount === '0') {
      const d = sourceLines.reduce((a, l) => a + Number(l.debit || 0), 0);
      const c = sourceLines.reduce((a, l) => a + Number(l.credit || 0), 0);
      const max = Math.max(d, c);
      if (max > 0) amount = String(max);
    }
    const lines: Line[] = [
      {
        accountId: res.data.debitAccountId ?? sourceLines[0]?.accountId ?? '',
        debit: amount,
        credit: '0',
        description: sourceLines[0]?.description ?? null,
        fundId: fundId || sourceLines[0]?.fundId || null,
      },
      {
        accountId: res.data.creditAccountId ?? sourceLines[1]?.accountId ?? '',
        debit: '0',
        credit: amount,
        description: sourceLines[1]?.description ?? null,
        fundId: fundId || sourceLines[1]?.fundId || null,
      },
    ];
    if (newCatTarget.value === 'form') form.lines = lines;
    else {
      forceForm.lines = lines;
      if (amount && amount !== '0') forceForm.amountHint = amount;
    }
    newCatOpen.value = false;
  } catch (err) {
    const e = err as { body?: { error?: string; missing?: string[] } };
    newCatError.value = e.body?.error
      ? friendlyNewCatError(e.body.error, e.body.missing)
      : (err as Error).message;
  } finally {
    newCatSaving.value = false;
  }
}

function clearAccountFilter(): void {
  accountFilterId.value = null;
  accountFilterLabel.value = '';
  accountFilterName.value = '';
  router.replace({ query: {} });
  onSearchInput();
}

const hasActiveFilters = computed(
  () =>
    !!filterStatus.value ||
    !!filterDirection.value ||
    !!search.value ||
    !!period.value ||
    !!accountFilterId.value,
);

function resetAllFilters(): void {
  filterStatus.value = '';
  filterDirection.value = '';
  search.value = '';
  if (accountFilterId.value) clearAccountFilter();
  applyPeriod('');
}

function wantsCreateAction(action: unknown): boolean {
  return action === 'create' || (Array.isArray(action) && action.includes('create'));
}

function queryStr(q: unknown): string | undefined {
  if (Array.isArray(q)) return typeof q[0] === 'string' ? q[0] : undefined;
  return typeof q === 'string' && q.length ? q : undefined;
}

function handleCreateAction(): void {
  if (!wantsCreateAction(route.query.action)) return;
  openCreate();
  const q = { ...route.query };
  delete q.action;
  router.replace({ query: q });
}

/** Deep-link dari Buku Dana: /transactions?open=<transactionId> */
async function handleOpenQuery(): Promise<void> {
  const id = queryStr(route.query.open);
  if (!id) return;
  const q = { ...route.query };
  delete q.open;
  await router.replace({ query: q });
  // Buka detail meskipun belum ada di list (fetch by id)
  detailError.value = null;
  detailLoading.value = true;
  detailOpen.value = true;
  detail.value = null;
  try {
    const res = await api.get<{ data: TransactionDetail }>(`/api/v1/transactions/${id}`);
    detail.value = res.data;
  } catch (err) {
    detailError.value = (err as Error).message;
  } finally {
    detailLoading.value = false;
  }
}

watch(
  () => route.fullPath,
  () => {
    void nextTick(() => {
      handleCreateAction();
      void handleOpenQuery();
    });
  },
  { immediate: true },
);

onBeforeRouteUpdate((to) => {
  if (wantsCreateAction(to.query.action)) {
    void nextTick(() => {
      openCreate();
      const q = { ...to.query };
      delete q.action;
      router.replace({ query: q });
    });
  }
  const openId = queryStr(to.query.open);
  if (openId) {
    void nextTick(() => handleOpenQuery());
  }
});

function applyAccountFilterLabel(aid: string): void {
  const a = accounts.value.find((x) => x.id === aid);
  if (!a) return;
  accountFilterName.value = a.name;
  accountFilterLabel.value = `${a.code} — ${a.name}`;
}

onMounted(async () => {
  const aid = route.query.accountId as string | undefined;
  if (aid) accountFilterId.value = aid;

  if (refData.categoriesReady) categories.value = refData.categories;
  if (refData.accountsReady) accounts.value = refData.accounts;
  // Set rentang "bulan ini" sebelum load pertama
  if (period.value === 'month' && !dateFrom.value) {
    const now = new Date();
    dateFrom.value = toDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
    dateTo.value = toDateStr(now);
  }
  await Promise.all([loadReferenceData(), load()]);

  if (aid) {
    applyAccountFilterLabel(aid);
    if (!accountFilterName.value) {
      try {
        const res = await api.get<{ data: { code: string; name: string } }>(`/api/v1/accounts/${aid}`);
        accountFilterName.value = res.data.name;
        accountFilterLabel.value = `${res.data.code} — ${res.data.name}`;
      } catch { /* ignore */ }
    }
  }
});
</script>

<template>
  <div class="space-y-4">
    <PageHeader
      title="Transaksi"
      description="Catat pemasukan & pengeluaran. Posting otomatis menghasilkan jurnal."
      :crumbs="[{ label: 'Dashboard', to: '/' }, { label: 'Keuangan' }, { label: 'Transaksi' }]"
    >
      <template #actions>
        <Button
          v-if="canImportPap"
          variant="secondary"
          size="sm"
          @click="router.push('/transactions/import/pap')"
        >
          <Upload class="h-4 w-4" /> <span class="hidden lg:inline">Impor Rekapan PAP</span>
        </Button>
        <Button
          v-if="auth.isSuperAdmin"
          variant="secondary"
          size="sm"
          class="hidden sm:inline-flex"
          @click="router.push('/transactions/import')"
        >
          <Upload class="h-4 w-4" /> <span class="hidden md:inline">Impor jurnal</span>
        </Button>
        <Button size="sm" class="md:size-default" @click="openCreate">
          <Plus class="h-4 w-4" /> <span class="hidden xs:inline sm:inline">Tambah</span>
        </Button>
      </template>
    </PageHeader>

    <div
      v-if="accountFilterId"
      class="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm"
    >
      <Filter class="h-4 w-4 text-primary" />
      <span class="text-foreground">
        Menampilkan transaksi akun <strong>{{ accountFilterLabel }}</strong>
      </span>
      <button
        class="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Hapus filter"
        @click="clearAccountFilter"
      >
        <X class="h-4 w-4" />
      </button>
    </div>

    <!-- Smart glance — 3 kartu terpisah seperti mock -->
    <div v-if="pageLoading.visible" class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Skeleton v-for="i in 3" :key="i" class="h-[84px] w-full rounded-2xl" />
    </div>
    <div
      v-else
      class="grid grid-cols-1 gap-3 sm:grid-cols-3"
    >
      <div class="rounded-2xl border border-[#D9D5C8] bg-card px-5 py-4 shadow-xs">
        <p class="text-[13px] text-muted-foreground">
          Pemasukan · {{ statsRangeLabel }}
        </p>
        <MoneyText
          :value="pageIncomeTotal"
          tone="income"
          class="mt-1 block text-xl font-extrabold tracking-tight sm:text-[22px]"
        />
        <p class="mt-1 text-[10px] text-muted-foreground/80">Hanya status Posted</p>
      </div>
      <div class="rounded-2xl border border-[#D9D5C8] bg-card px-5 py-4 shadow-xs">
        <p class="text-[13px] text-muted-foreground">
          Pengeluaran · {{ statsRangeLabel }}
        </p>
        <MoneyText
          :value="pageExpenseTotal"
          tone="expense"
          class="mt-1 block text-xl font-extrabold tracking-tight sm:text-[22px]"
        />
        <p class="mt-1 text-[10px] text-muted-foreground/80">Hanya status Posted</p>
      </div>
      <div class="rounded-2xl border border-[#D9D5C8] bg-card px-5 py-4 shadow-xs">
        <p class="text-[13px] text-muted-foreground">
          Selisih ({{ pageNetTotal >= 0 ? 'surplus' : 'defisit' }}) · {{ statsRangeLabel }}
        </p>
        <MoneyText
          :value="pageNetTotal"
          :tone="pageNetTotal >= 0 ? 'none' : 'expense'"
          class="mt-1 block text-xl font-extrabold tracking-tight sm:text-[22px]"
          :class="pageNetTotal >= 0 ? 'text-[#0E1F18]' : ''"
        />
      </div>
    </div>

    <div class="sticky top-0 z-10 -mx-4 space-y-2 bg-background/95 px-4 py-2 backdrop-blur-md md:static md:mx-0 md:space-y-3 md:bg-transparent md:p-0 md:backdrop-blur-none">
    <!-- Arah + search + status -->
    <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-for="d in ([
            { value: '', label: 'Semua' },
            { value: 'income', label: 'Pemasukan' },
            { value: 'expense', label: 'Pengeluaran' },
          ] as const)"
          :key="d.value || 'all'"
          type="button"
          class="rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors"
          :class="filterDirection === d.value
            ? 'border border-[#146C4F] bg-[#146C4F] text-white shadow-sm'
            : 'border border-[#D0CCC0] bg-white text-[#5A6B62] hover:border-[#B8B4A6] hover:bg-[#FAF9F5] hover:text-foreground'"
          @click="filterDirection = d.value; onSearchInput()"
        >
          {{ d.label }}
        </button>
      </div>
      <div class="flex flex-1 flex-col gap-2 sm:max-w-xl sm:flex-row sm:items-center sm:justify-end">
        <div class="w-full sm:max-w-[160px]">
          <AppSelect
            v-model="filterStatus"
            :options="filterStatusOptions"
            @update:model-value="onSearchInput()"
          />
        </div>
        <div class="relative w-full sm:max-w-[280px]">
          <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            v-model="search"
            class="rounded-full border border-[#D0CCC0] bg-white pl-9 shadow-none"
            placeholder="Cari transaksi, dana, atau kategori…"
          />
        </div>
      </div>
    </div>

    <div class="flex flex-nowrap items-center gap-2 overflow-x-auto rounded-xl border border-[#D9D5C8] bg-card px-4 py-2.5 md:flex-wrap md:overflow-visible">
      <span class="mr-1 text-xs font-medium text-muted-foreground">Periode:</span>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="p in periodPresets"
          :key="p.value"
          type="button"
          class="rounded-full px-3 py-1.5 text-xs font-semibold transition-colors"
          :class="period === p.value
            ? 'border border-[#146C4F] bg-[#146C4F] text-white shadow-sm'
            : 'border border-[#D0CCC0] bg-white text-[#5A6B62] hover:border-[#B8B4A6] hover:bg-[#FAF9F5]'"
          @click="applyPeriod(p.value)"
        >
          {{ p.label }}
        </button>
      </div>
      <template v-if="period === 'custom'">
        <span class="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <DatePicker v-model="dateFrom" placeholder="Dari tgl" />
        <span class="text-xs text-muted-foreground">s/d</span>
        <DatePicker v-model="dateTo" placeholder="Sampai tgl" />
        <Button size="sm" variant="secondary" @click="applyCustomRange">Terapkan</Button>
      </template>
    </div>
    </div>

    <!-- Mass Edit bar -->
    <div
      v-if="selectedCount > 0"
      class="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3"
    >
      <span class="text-sm font-semibold text-foreground tabular-nums">
        {{ selectedCount }} transaksi dipilih
      </span>
      <span class="h-5 w-px bg-border" aria-hidden="true" />
      <template v-for="ba in availableBulkActions" :key="ba.action">
        <Button
          size="sm"
          variant="secondary"
          :loading="bulkActing"
          class="gap-1.5"
          @click="executeBulkAction(ba.action)"
        >
          <component :is="ba.icon" class="h-3.5 w-3.5" />
          {{ ba.label }}
        </Button>
      </template>
      <span
        v-if="availableBulkActions.length === 0"
        class="text-xs text-muted-foreground"
      >
        Status campur — pilih transaksi dengan status yang sama untuk aksi massal
      </span>
      <button
        class="ml-auto text-xs text-muted-foreground hover:text-foreground"
        @click="clearSelection"
      >
        ✕ Batal pilih
      </button>
      <Alert v-if="bulkError" variant="destructive" class="w-full">
        <AlertDescription class="text-xs">{{ bulkError }}</AlertDescription>
      </Alert>
    </div>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div v-if="pageLoading.visible" class="space-y-2">
      <Skeleton v-for="i in 4" :key="i" class="h-20 w-full md:h-12" />
    </div>

    <template v-else-if="items.length > 0">
    <div class="relative" :class="listLoading ? 'pointer-events-none opacity-60' : ''">
    <!-- Mobile: card list grouped by date -->
    <div class="space-y-4 md:hidden">
      <section v-for="group in groupedTransactions" :key="group.date" class="space-y-2">
        <h3 class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {{ group.date }}
          <span
            v-if="relativeDayLabel(group.txs[0]!.transactionDate)"
            class="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-primary"
          >
            {{ relativeDayLabel(group.txs[0]!.transactionDate) }}
          </span>
        </h3>
        <button
          v-for="t in group.txs"
          :key="t.id"
          type="button"
          class="flex w-full items-start gap-3 rounded-xl border bg-card p-3.5 text-left shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md active:translate-y-0"
          :class="selectedIds.has(t.id) ? 'border-primary/40 bg-accent ring-1 ring-primary/20' : ''"
          @click="openDetail(t)"
        >
          <span
            class="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl"
            :class="txDirection(t) === 'income'
              ? 'bg-emerald-100 text-emerald-700'
              : txDirection(t) === 'expense'
                ? 'bg-rose-100 text-rose-700'
                : 'bg-muted text-muted-foreground'"
          >
            <ArrowUpRight v-if="txDirection(t) === 'income'" class="size-[18px]" />
            <ArrowDownRight v-else-if="txDirection(t) === 'expense'" class="size-[18px]" />
            <Scale v-else class="size-[18px]" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold text-foreground">{{ cardTitle(t) }}</p>
            <p class="mt-0.5 truncate text-xs text-muted-foreground">
              {{ fmtTime(t.transactionDate) }} · {{ categoryLabel(t.categoryId) }}
            </p>
            <p class="mt-1 font-mono text-[10px] text-muted-foreground/70">{{ t.transactionNo }}</p>
          </div>
          <div class="shrink-0 text-right">
            <p class="text-sm font-extrabold tabular-nums">
              <span
                v-if="txDirection(t) === 'income'"
                class="text-[#15803d]"
              >+</span>
              <span
                v-else-if="txDirection(t) === 'expense'"
                class="text-[#b45309]"
              >−</span>
              <MoneyText
                :value="t.amount"
                :tone="
                  txDirection(t) === 'income'
                    ? 'income'
                    : txDirection(t) === 'expense'
                      ? 'expense'
                      : 'none'
                "
                class="inline font-extrabold"
              />
            </p>
            <StatusBadge :status="t.status" class="mt-1" />
          </div>
        </button>
      </section>
      <Pagination
        v-if="total > limit"
        :total="total"
        :offset="offset"
        :limit="limit"
        :loading="listLoading"
        @prev="setPage(Math.max(0, offset - limit))"
        @next="setPage(offset + limit)"
      />
    </div>

    <!-- Desktop: table — border tegas seperti mock, nominal hijau/merah -->
    <div class="hidden overflow-hidden rounded-2xl border border-[#D0CCC0] bg-white md:block">
      <Table>
        <TableHeader class="bg-[#F7F5EF]">
          <TableRow class="border-b border-[#D9D5C8] hover:bg-transparent">
            <TableHead class="h-11 w-10 border-b border-[#D9D5C8] px-3" @click.stop>
              <AppCheckbox :model-value="isAllSelected" @update:model-value="toggleSelectAll" />
            </TableHead>
            <TableHead class="h-11 w-[100px] border-b border-[#D9D5C8] px-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7A72]">
              <SortableHeader field="transactionDate" :active="sort" @sort="setSort">
                Tanggal
              </SortableHeader>
            </TableHead>
            <TableHead class="h-11 border-b border-[#D9D5C8] px-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7A72]">
              Deskripsi
            </TableHead>
            <TableHead class="h-11 border-b border-[#D9D5C8] px-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7A72]">
              <SortableHeader field="category" :active="sort" @sort="setSort">Kategori</SortableHeader>
            </TableHead>
            <TableHead class="h-11 w-[140px] border-b border-[#D9D5C8] px-4 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7A72]">
              <SortableHeader field="amount" :active="sort" align="end" @sort="setSort">
                Jumlah
              </SortableHeader>
            </TableHead>
            <TableHead class="h-11 w-[110px] border-b border-[#D9D5C8] px-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7A72]">
              <SortableHeader field="status" :active="sort" @sort="setSort">Status</SortableHeader>
            </TableHead>
            <TableHead class="h-11 w-[160px] border-b border-[#D9D5C8] px-4 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7A72]">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="t in sortedItems"
            :key="t.id"
            class="cursor-pointer border-b border-[#E8E5DA] bg-white last:border-b-0 hover:bg-[#FAF9F5]"
            :class="selectedIds.has(t.id) ? '!bg-emerald-50/70 ring-1 ring-inset ring-[#146C4F]/20' : ''"
            @click="openDetail(t)"
          >
            <TableCell class="px-3 py-3.5" @click.stop>
              <AppCheckbox
                :model-value="selectedIds.has(t.id)"
                @update:model-value="toggleSelect(t.id)"
              />
            </TableCell>
            <TableCell class="px-4 py-3.5">
              <p class="text-[13px] font-medium tabular-nums text-[#6B7A72]">
                {{ fmtDateShort(t.transactionDate) }}
              </p>
            </TableCell>
            <TableCell class="px-4 py-3.5">
              <p class="truncate text-[14px] font-semibold text-[#0E1F18]">{{ cardTitle(t) }}</p>
              <p class="mt-0.5 font-mono text-[10px] text-[#6B7A72]/80">{{ t.transactionNo }}</p>
            </TableCell>
            <TableCell class="px-4 py-3.5">
              <span
                class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium"
                :class="categoryPill(t.categoryId).pill"
              >
                <span
                  class="size-1.5 shrink-0 rotate-45 rounded-[1px]"
                  :class="categoryPill(t.categoryId).dot"
                  aria-hidden="true"
                ></span>
                {{ categoryNameOnly(t.categoryId) }}
              </span>
            </TableCell>
            <TableCell class="px-4 py-3.5 text-right text-sm">
              <span class="inline-flex items-baseline justify-end gap-0.5 font-bold tabular-nums">
                <span
                  v-if="txDirection(t) === 'income'"
                  class="text-[#15803d]"
                >+</span>
                <span
                  v-else-if="txDirection(t) === 'expense'"
                  class="text-[#b45309]"
                >−</span>
                <MoneyText
                  :value="t.amount"
                  :tone="
                    txDirection(t) === 'income'
                      ? 'income'
                      : txDirection(t) === 'expense'
                        ? 'expense'
                        : 'none'
                  "
                  class="font-bold"
                />
              </span>
            </TableCell>
            <TableCell class="px-4 py-3.5">
              <StatusBadge :status="t.status" />
            </TableCell>
            <TableCell class="px-4 py-3.5" @click.stop>
              <div class="flex flex-wrap items-center justify-end gap-1.5">
                <Button
                  v-if="canExpressPost && t.status !== 'posted' && t.status !== 'rejected'"
                  size="sm"
                  class="gap-1"
                  :loading="acting === t.id"
                  title="Posting cepat (Bendahara / GOD) — langsung ke jurnal & dashboard"
                  @click="expressPostRow(t)"
                >
                  <FileCheck2 class="h-3.5 w-3.5" /> Posting cepat
                </Button>
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
                <span v-else class="text-xs text-muted-foreground">—</span>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <Pagination
        v-if="total > limit"
        :total="total"
        :offset="offset"
        :limit="limit"
        :loading="listLoading"
        @prev="setPage(Math.max(0, offset - limit))"
        @next="setPage(offset + limit)"
      />
    </div>
    </div>
    </template>

    <Card v-else-if="!pageLoading.visible && items.length === 0">
      <CardContent class="flex flex-col items-center gap-2 py-14 text-center">
        <span class="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <Inbox class="size-5" />
        </span>
        <p class="text-sm font-semibold text-foreground">
          {{ hasActiveFilters ? 'Tidak ada transaksi yang cocok' : 'Belum ada transaksi' }}
        </p>
        <p class="max-w-[18rem] text-xs text-muted-foreground">
          {{ hasActiveFilters
            ? 'Coba ubah kata kunci, status, atau rentang periode pencarian.'
            : 'Catat pemasukan atau pengeluaran pertama untuk mulai membangun laporan keuangan.' }}
        </p>
        <Button v-if="hasActiveFilters" variant="secondary" size="sm" class="mt-1" @click="resetAllFilters">
          Reset filter
        </Button>
        <Button v-else size="sm" class="mt-1" @click="openCreate">
          <Plus class="h-3.5 w-3.5" /> Tambah transaksi
        </Button>
      </CardContent>
    </Card>

    <Modal v-model:open="modalOpen" :title="editing ? 'Edit Transaksi' : 'Transaksi Baru'" size="xl">
      <Alert v-if="transactionError" variant="destructive" class="mb-3">
        <AlertDescription>{{ transactionError }}</AlertDescription>
      </Alert>
      <form class="space-y-3" @submit.prevent="save()">
        <!-- Baris 1: tanggal + nominal (wajib praktis) -->
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr]">
          <FormField label="Tanggal" required class="gap-1">
            <DateTimePicker v-model="form.transactionDate" required />
          </FormField>
          <FormField label="Nominal" required class="gap-1">
            <MoneyInput
              v-model="form.amountHint"
              placeholder="0"
              @update:model-value="syncAmountToLines"
              @blur="syncAmountToLines"
            />
          </FormField>
        </div>

        <!-- Baris 2: keterangan penuh -->
        <FormField label="Keterangan" class="gap-1">
          <Input
            v-model="form.description"
            placeholder="Mis. Infak di Masjid Nurul Iman"
          />
        </FormField>

        <!-- Baris 3: ref opsional (kompak) -->
        <details class="group">
          <summary class="cursor-pointer text-[11px] font-medium text-muted-foreground hover:text-foreground">
            + No. referensi (opsional)
          </summary>
          <div class="mt-1.5">
            <Input v-model="form.referenceNo" placeholder="KWT-2026-0042" class="h-9" />
          </div>
        </details>

        <!-- Jurnal: kategori/dana + 2 baris akun -->
        <div class="space-y-1.5 border-t border-border/60 pt-3">
          <p class="text-[11px] font-semibold text-muted-foreground">
            Jurnal
            <span class="font-normal">· pilih kategori (isi akun otomatis) atau pilih akun manual</span>
          </p>
          <TransactionLineEditor
            :lines="form.lines"
            :accounts="accounts"
            :categories="categories"
            :funds="funds"
            :category-id="form.categoryId || null"
            :amount-hint="form.amountHint"
            @update:lines="(v) => (form.lines = v)"
            @update:category-id="(v) => (form.categoryId = v ?? '')"
            @request-create-category="openNewCategory('form')"
          />
        </div>
      </form>
      <template #footer>
        <div class="flex w-full flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" @click="modalOpen = false">Batal</Button>
          <Button variant="outline" :loading="saving && !canExpressPost" @click="save()">
            {{ editing ? 'Simpan draft' : 'Simpan draft' }}
          </Button>
          <Button
            v-if="canExpressPost"
            :loading="saving"
            class="gap-1.5"
            title="Langsung posting ke jurnal & dashboard (Bendahara / GOD)"
            @click="save({ expressPost: true })"
          >
            Simpan &amp; Posting
          </Button>
        </div>
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
      <Alert v-if="detailError" variant="destructive" class="mb-3">
        <AlertDescription>{{ detailError }}</AlertDescription>
      </Alert>
      <div v-if="detailLoading" class="space-y-3">
        <Skeleton class="h-20 w-full rounded-2xl" />
        <Skeleton class="h-16 w-full rounded-xl" />
        <Skeleton class="h-40 w-full rounded-xl" />
      </div>
      <div v-else-if="detail" class="space-y-4">
        <!-- Hero: status + arah + nominal -->
        <div
          class="relative overflow-hidden rounded-2xl border px-4 py-4 sm:px-5"
          :class="
            detailDirection === 'income'
              ? 'border-emerald-200/80 bg-gradient-to-br from-emerald-50/90 via-card to-card'
              : detailDirection === 'expense'
                ? 'border-amber-200/80 bg-gradient-to-br from-amber-50/90 via-card to-card'
                : 'border-border/80 bg-gradient-to-br from-muted/40 via-card to-card'
          "
        >
          <div
            class="pointer-events-none absolute -right-8 -top-10 size-36 rounded-full opacity-40 blur-2xl"
            :class="
              detailDirection === 'income'
                ? 'bg-emerald-300/50'
                : detailDirection === 'expense'
                  ? 'bg-amber-300/50'
                  : 'bg-muted-foreground/10'
            "
          />
          <div class="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div class="flex min-w-0 flex-col gap-2.5">
              <div class="flex flex-wrap items-center gap-2">
                <StatusBadge :status="detail.status" />
                <span
                  v-if="detailDirection === 'income'"
                  class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-emerald-700"
                >
                  <ArrowUpRight class="size-3" /> Pemasukan
                </span>
                <span
                  v-else-if="detailDirection === 'expense'"
                  class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-amber-800"
                >
                  <ArrowDownRight class="size-3" /> Pengeluaran
                </span>
                <span
                  v-else
                  class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground"
                >
                  Jurnal
                </span>
              </div>
              <p
                class="text-[15px] font-semibold leading-snug tracking-tight text-foreground sm:text-base"
              >
                {{ detail.description?.trim() || categoryLabel(detail.categoryId) }}
              </p>
              <p
                v-if="detail.description?.trim() && detail.categoryId"
                class="text-xs text-muted-foreground"
              >
                {{ categoryLabel(detail.categoryId) }}
              </p>
            </div>
            <div class="shrink-0 text-left sm:text-right">
              <p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Nominal
              </p>
              <p
                class="mt-0.5 font-mono text-2xl font-bold tabular-nums tracking-tight sm:text-[1.7rem]"
                :class="
                  detailDirection === 'income'
                    ? 'text-emerald-700'
                    : detailDirection === 'expense'
                      ? 'text-amber-800'
                      : 'text-foreground'
                "
              >
                <span v-if="detailDirection === 'income'" class="mr-0.5 font-semibold">+</span>
                <span v-else-if="detailDirection === 'expense'" class="mr-0.5 font-semibold">−</span>
                <MoneyText :value="detail.amount" tone="none" class="inline font-mono font-bold" />
              </p>
            </div>
          </div>
        </div>

        <!-- Meta grid -->
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div class="rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5">
            <div class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              <Calendar class="size-3 opacity-70" /> Tanggal
            </div>
            <p class="mt-1 text-[13px] font-medium leading-snug text-foreground">
              {{ fmtDate(detail.transactionDate) }}
            </p>
          </div>
          <div class="rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5">
            <div class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              <Tag class="size-3 opacity-70" /> Kategori
            </div>
            <p class="mt-1 truncate text-[13px] font-medium leading-snug text-foreground" :title="categoryLabel(detail.categoryId)">
              {{ categoryLabel(detail.categoryId) }}
            </p>
          </div>
          <div class="rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5">
            <div class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              <Wallet class="size-3 opacity-70" /> Dana
            </div>
            <p
              class="mt-1 truncate text-[13px] font-medium leading-snug"
              :class="detailFundSummary.length ? 'text-foreground' : 'text-amber-700'"
              :title="detailFundSummary.join(', ') || 'Belum ditag dana'"
            >
              {{ detailFundSummary.length ? detailFundSummary.join(', ') : 'Belum ditag' }}
            </p>
          </div>
          <div class="rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5">
            <div class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              <BookOpen class="size-3 opacity-70" />
              {{ detail.postedAt ? 'Diposting' : 'Referensi' }}
            </div>
            <p class="mt-1 truncate text-[13px] font-medium leading-snug text-foreground">
              <template v-if="detail.postedAt">{{ fmtDate(detail.postedAt) }}</template>
              <template v-else-if="detail.referenceNo">
                <span class="font-mono text-xs">{{ detail.referenceNo }}</span>
              </template>
              <template v-else>—</template>
            </p>
          </div>
        </div>

        <div
          v-if="detail.referenceNo && detail.postedAt"
          class="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-xs text-muted-foreground"
        >
          <Hash class="size-3.5 shrink-0 opacity-60" />
          <span class="font-medium text-foreground/80">No. referensi</span>
          <span class="font-mono text-[11px] text-foreground">{{ detail.referenceNo }}</span>
        </div>

        <!-- Journal -->
        <div class="overflow-hidden rounded-2xl border border-border/80 shadow-xs">
          <div class="flex items-center justify-between gap-2 border-b border-border/70 bg-muted/30 px-3 py-2.5 sm:px-4">
            <div class="flex items-center gap-2">
              <Scale class="size-3.5 text-muted-foreground" />
              <span class="text-xs font-bold uppercase tracking-[0.1em] text-foreground/80">Jurnal</span>
              <span class="text-[11px] text-muted-foreground">{{ detail.lines.length }} baris</span>
            </div>
            <span
              class="inline-flex items-center gap-1 rounded-full border border-emerald-200/80 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"
            >
              Seimbang
            </span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr class="border-b border-border/60 bg-muted/15 text-left">
                  <th class="w-9 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">#</th>
                  <th class="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Akun</th>
                  <th class="hidden px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:table-cell">Dana</th>
                  <th class="w-[7.5rem] px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Debit</th>
                  <th class="w-[7.5rem] px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Kredit</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(l, i) in detail.lines"
                  :key="l.id"
                  class="border-b border-border/40 last:border-0"
                  :class="i % 2 === 1 ? 'bg-muted/10' : 'bg-card'"
                >
                  <td class="px-2 py-2.5 text-center text-[11px] tabular-nums text-muted-foreground">{{ i + 1 }}</td>
                  <td class="px-3 py-2.5">
                    <div class="flex min-w-0 flex-col gap-0.5">
                      <div class="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                        <span class="font-mono text-[11px] font-semibold text-muted-foreground">{{ accountParts(l.accountId).code }}</span>
                        <span class="text-[13px] font-medium text-foreground">{{ accountParts(l.accountId).name }}</span>
                      </div>
                      <p v-if="l.description" class="text-[11px] text-muted-foreground">{{ l.description }}</p>
                      <p v-if="!l.fundId" class="text-[10px] font-medium text-amber-700 sm:hidden">Dana: belum ditag</p>
                      <p v-else class="text-[10px] text-muted-foreground sm:hidden">{{ fundLabel(l.fundId) }}</p>
                    </div>
                  </td>
                  <td class="hidden px-3 py-2.5 sm:table-cell">
                    <span
                      v-if="l.fundId"
                      class="inline-flex max-w-[10rem] items-center truncate rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-foreground"
                      :title="fundLabel(l.fundId)"
                    >
                      {{ fundCode(l.fundId) || fundLabel(l.fundId) }}
                    </span>
                    <span
                      v-else
                      class="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                    >
                      —
                    </span>
                  </td>
                  <td class="px-3 py-2.5 text-right font-mono text-[13px] tabular-nums">
                    <MoneyText
                      v-if="Number(l.debit) > 0"
                      :value="l.debit"
                      tone="income"
                      class="font-mono font-semibold text-emerald-700"
                    />
                    <span v-else class="text-muted-foreground/35">—</span>
                  </td>
                  <td class="px-3 py-2.5 text-right font-mono text-[13px] tabular-nums">
                    <MoneyText
                      v-if="Number(l.credit) > 0"
                      :value="l.credit"
                      class="font-mono font-semibold text-foreground"
                    />
                    <span v-else class="text-muted-foreground/35">—</span>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="border-t border-border/70 bg-muted/25">
                  <td colspan="2" class="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground sm:hidden">
                    Total
                  </td>
                  <td colspan="3" class="hidden px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground sm:table-cell">
                    Total
                  </td>
                  <td class="px-3 py-2.5 text-right font-mono text-[13px] font-bold tabular-nums text-foreground">
                    <MoneyText :value="detail.amount" tone="none" class="font-mono font-bold" />
                  </td>
                  <td class="px-3 py-2.5 text-right font-mono text-[13px] font-bold tabular-nums text-foreground">
                    <MoneyText :value="detail.amount" tone="none" class="font-mono font-bold" />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <!-- Status callout -->
        <div
          v-if="detail.status === 'submitted'"
          class="flex gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/80 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900"
        >
          <Info class="mt-0.5 size-3.5 shrink-0 opacity-70" />
          <p>Sudah diajukan. Pembuat dapat menarik kembali untuk merevisi, atau menunggu approver menyetujui/menolak.</p>
        </div>
        <div
          v-else-if="detail.status === 'rejected'"
          class="flex gap-2.5 rounded-xl border border-rose-200/80 bg-rose-50/80 px-3.5 py-2.5 text-xs leading-relaxed text-rose-900"
        >
          <Info class="mt-0.5 size-3.5 shrink-0 opacity-70" />
          <p>Ditolak approver. Klik <strong>Revisi</strong> untuk kembalikan ke draft dan perbaiki datanya.</p>
        </div>
        <div
          v-else-if="detail.status === 'approved'"
          class="flex gap-2.5 rounded-xl border border-sky-200/80 bg-sky-50/80 px-3.5 py-2.5 text-xs leading-relaxed text-sky-900"
        >
          <Info class="mt-0.5 size-3.5 shrink-0 opacity-70" />
          <p>Sudah disetujui dan siap diposting. Setelah posting, koreksi hanya via transaksi pembalik.</p>
        </div>
        <div
          v-else-if="detail.status === 'posted'"
          class="flex gap-2.5 rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-3.5 py-2.5 text-xs leading-relaxed text-emerald-900"
        >
          <Info class="mt-0.5 size-3.5 shrink-0 opacity-70" />
          <p>Sudah diposting ke jurnal. Koreksi: buat transaksi pembalik dengan nominal sama dan kategori berlawanan.</p>
        </div>

        <!-- GOD mode compact -->
        <div
          v-if="auth.isSuperAdmin"
          class="flex flex-col gap-2.5 rounded-xl border border-rose-200/70 bg-rose-50/40 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-rose-700">
              <Shield class="size-3" /> Super admin
            </div>
            <p class="mt-0.5 text-[11px] leading-snug text-rose-800/75">
              Force-edit/delete melewati alur normal · tercatat di log
            </p>
          </div>
          <div class="flex shrink-0 flex-wrap gap-1.5">
            <Button variant="outline" size="sm" class="h-8 border-rose-200 bg-card text-xs" @click="openForceEdit">
              <Pencil class="size-3.5" /> Force edit
            </Button>
            <Button variant="outline" size="sm" class="h-8 border-rose-200 bg-card text-xs text-rose-700" @click="openForceDelete">
              <AlertTriangle class="size-3.5" /> Force delete
            </Button>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="flex w-full flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" @click="closeDetail">Tutup</Button>
          <template v-if="detail">
            <Button
              v-if="canExpressPost && detail.status !== 'posted' && detail.status !== 'rejected'"
              :loading="acting === detail.id"
              class="gap-1.5"
              title="Langsung posting ke jurnal (skip ajukan/setujui)"
              @click="expressPostRow(detail)"
            >
              <FileCheck2 class="h-4 w-4" /> Posting cepat
            </Button>
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
        </div>
      </template>
    </Modal>

    <Modal v-model:open="forceEditOpen" title="GOD MODE — Force edit transaksi" size="xl">
      <Alert v-if="forceEditError" variant="destructive" class="mb-3">
        <AlertDescription>{{ forceEditError }}</AlertDescription>
      </Alert>
      <form class="space-y-4" @submit.prevent="submitForceEdit">
        <div class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <strong>Peringatan.</strong> Aksi ini melewati state machine. Untuk transaksi <code>posted</code>,
          jurnal akan dihapus dan status dikembalikan ke <code>approved</code> (perlu posting ulang). Alasan wajib (≥10 karakter) dan tercatat di approval log.
        </div>
        <FormField label="Alasan force-edit" required>
          <Textarea
            v-model="forceForm.reason"
            rows="2"
            minlength="10"
            required
            placeholder="Mis. salah input nominal infaq Jumat"
          />
          <span
            class="mt-1 block text-right text-xs tabular-nums"
            :class="forceForm.reason.length >= 10 ? 'text-emerald-600' : 'text-amber-600'"
          >
            {{ forceForm.reason.length }} / 10 minimum
          </span>
        </FormField>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="Tanggal & waktu" required>
            <DateTimePicker v-model="forceForm.transactionDate" required />
          </FormField>
          <FormField label="Nomor referensi">
            <Input v-model="forceForm.referenceNo" />
          </FormField>
        </div>
        <FormField label="Keterangan">
          <Textarea v-model="forceForm.description" rows="2" />
        </FormField>
        <div>
          <label class="mb-1.5 block text-sm font-medium text-foreground">Baris jurnal</label>
          <TransactionLineEditor
            :lines="forceForm.lines"
            :accounts="accounts"
            :categories="categories"
            :funds="funds"
            :category-id="forceForm.categoryId || null"
            :amount-hint="forceForm.amountHint || null"
            @update:lines="(v) => (forceForm.lines = v)"
            @update:category-id="(v) => (forceForm.categoryId = v ?? '')"
            @request-create-category="openNewCategory('force')"
          />
        </div>
      </form>
      <template #footer>
        <Button variant="secondary" @click="forceEditOpen = false">Batal</Button>
        <Button :loading="forcing" @click="submitForceEdit">Simpan paksa</Button>
      </template>
    </Modal>

    <Modal v-model:open="forceDeleteOpen" title="GOD MODE — Force delete transaksi" size="md">
      <Alert v-if="forceDeleteError" variant="destructive" class="mb-3">
        <AlertDescription>{{ forceDeleteError }}</AlertDescription>
      </Alert>
      <div class="space-y-3">
        <div class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <strong>Peringatan.</strong> Transaksi akan di-soft-delete, jurnal terkait dihapus permanen.
          Aksi ini melewati state machine. Audit log mempertahankan jejak.
        </div>
        <p class="text-sm text-foreground">
          Hapus transaksi <strong>{{ detail?.transactionNo }}</strong>?
        </p>
        <FormField label="Alasan force-delete" required>
          <Textarea
            v-model="forceDeleteReason"
            rows="3"
            minlength="10"
            required
            placeholder="Mis. duplikat dari TX-XXXX-202605-0042"
          />
          <span
            class="mt-1 block text-right text-xs tabular-nums"
            :class="forceDeleteReason.length >= 10 ? 'text-emerald-600' : 'text-amber-600'"
          >
            {{ forceDeleteReason.length }} / 10 minimum
          </span>
        </FormField>
      </div>
      <template #footer>
        <Button variant="secondary" @click="forceDeleteOpen = false">Batal</Button>
        <Button :loading="forcing" @click="submitForceDelete">Hapus paksa</Button>
      </template>
    </Modal>
    <Modal v-model:open="newCatOpen" title="Kategori Baru" size="lg">
      <Alert v-if="newCatError" variant="destructive" class="mb-3">
        <AlertDescription>{{ newCatError }}</AlertDescription>
      </Alert>
      <form class="space-y-3" @submit.prevent="saveNewCategory">
        <FormField label="Nama" required>
          <Input v-model="newCat.name" required minlength="2" placeholder="Mis. Infaq Jumat, ATK, Listrik" />
        </FormField>
        <FormField label="Arah" required>
          <AppSelect v-model="newCat.direction" :options="directionOptions" />
        </FormField>
        <FormField
          label="Kode"
          required
          :hint="!newCatCodeManual ? 'Otomatis dari nama + arah \u2014 ubah manual jika perlu' : null"
        >
          <Input
            v-model="newCat.code"
            required
            maxlength="50"
            placeholder="INC_INFAQ_JUMAT"
            @input="onNewCatCodeInput"
          />
        </FormField>
        <FormField
          label="Akun debit"
          :required="newCat.direction === 'expense'"
          :hint="newCat.direction === 'income' ? 'Opsional \u2014 biasanya kas/bank, bisa dipilih saat input transaksi' : null"
        >
          <AccountSelect
            v-model="newCat.debitAccountId"
            :accounts="accounts"
            :required="newCat.direction === 'expense'"
          />
        </FormField>
        <FormField
          label="Akun kredit"
          :required="newCat.direction === 'income'"
          :hint="newCat.direction === 'expense' ? 'Opsional \u2014 biasanya kas/bank, bisa dipilih saat input transaksi' : null"
        >
          <AccountSelect
            v-model="newCat.creditAccountId"
            :accounts="accounts"
            :required="newCat.direction === 'income'"
          />
        </FormField>
        <FormField
          v-if="funds.length > 0"
          label="Dana default"
          hint="Untuk program (mis. PAP): pilih sekali, nanti saat pilih kategori ini dana ikut terisi"
        >
          <AppSelect v-model="newCat.defaultFundId" :options="newCatFundOptions" />
        </FormField>
        <p class="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          <strong>Template cepat</strong>: pilih kategori di form transaksi → akun (+ dana default) terisi otomatis.<br />
          Contoh Infaq PAP: debit Kas PAP, kredit Infaq &amp; Sedekah, dana PAP 2026.
        </p>
      </form>
      <template #footer>
        <Button variant="secondary" @click="newCatOpen = false">Batal</Button>
        <Button :loading="newCatSaving" @click="saveNewCategory">Buat &amp; pilih</Button>
      </template>
    </Modal>
  </div>
</template>
