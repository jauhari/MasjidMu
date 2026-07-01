<script setup lang="ts">
import { onMounted, reactive, ref, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  Plus,
  Pencil,
  Trash2,
  Sprout,
  ChevronDown,
  ChevronRight,
  Search,
  GitMerge,
  Wallet,
  Landmark,
  Scale,
  TrendingUp,
  X,
  ArrowRightLeft,
} from 'lucide-vue-next';
import { api } from '@/shared/api/client';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Button from '@/shared/ui/Button.vue';
import Modal from '@/shared/ui/Modal.vue';
import FormField from '@/shared/ui/FormField.vue';
import ConfirmDialog from '@/shared/ui/ConfirmDialog.vue';
import SortableHeader from '@/shared/ui/SortableHeader.vue';
import PageHeader from '@/shared/ui/PageHeader.vue';
import AppSelect from '@/shared/ui/AppSelect.vue';
import AppCheckbox from '@/shared/ui/AppCheckbox.vue';
import MoneyText from '@/shared/ui/MoneyText.vue';
import SmartAccountSelect from '@/shared/ui/SmartAccountSelect.vue';

type AccountType =
  | 'asset'
  | 'liability'
  | 'equity'
  | 'income'
  | 'expense'
  | 'contra_asset'
  | 'contra_liability';
type NormalBalance = 'debit' | 'credit';

interface Account {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  description: string | null;
  isActive: boolean;
  isSystem: boolean;
  openingBalance: string;
  /** Self-balance dari journal_lines + opening_balance, signed by normal_balance. String numeric. */
  balance: string;
}

interface TreeNode extends Account {
  children: TreeNode[];
  depth: number;
  /** Self balance + sum descendants. */
  totalBalance: string;
}

const items = ref<Account[]>([]);
const loading = ref(true);
const saving = ref(false);
const deleting = ref(false);
const seeding = ref(false);
const error = ref<string | null>(null);
const modalError = ref<string | null>(null);
const router = useRouter();

const filterType = ref<'' | AccountType>('');
const showZero = ref(false);
const searchQuery = ref('');

const editing = ref<Account | null>(null);
const modalOpen = ref(false);
const confirmOpen = ref(false);
const toDelete = ref<Account | null>(null);

const mergeSource = ref<Account | null>(null);
const mergeTargetId = ref('');
const mergeOpen = ref(false);
const merging = ref(false);
const mergeError = ref<string | null>(null);

const EXPANDED_KEY = 'masjidmu.accounts.expanded';

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}

function saveExpanded(set: Set<string>): void {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...set]));
  } catch { /* ignore */ }
}

const expanded = ref<Set<string>>(loadExpanded());

// Sorting: applied within each tree level so hierarchy is preserved.
type SortField = 'code' | 'name' | 'accountType' | 'balance';
const sort = ref<{ field: SortField; dir: 'asc' | 'desc' } | null>({
  field: 'code',
  dir: 'asc',
});

function setSort(field: SortField, dir: 'asc' | 'desc' | null): void {
  sort.value = dir ? { field, dir } : null;
}

const form = reactive({
  parentId: '' as string,
  code: '',
  name: '',
  accountType: 'asset' as AccountType,
  normalBalance: 'debit' as NormalBalance,
  description: '',
  isActive: true,
  openingBalance: '',
});

const TYPE_LABEL: Record<AccountType, string> = {
  asset: 'Aset',
  liability: 'Kewajiban',
  equity: 'Aset Neto',
  income: 'Pendapatan',
  expense: 'Beban',
  contra_asset: 'Kontra Aset',
  contra_liability: 'Kontra Kewajiban',
};

const TYPE_BADGE: Record<AccountType, string> = {
  asset: 'bg-blue-50 text-blue-700',
  liability: 'bg-amber-50 text-amber-700',
  equity: 'bg-purple-50 text-purple-700',
  income: 'bg-emerald-50 text-emerald-700',
  expense: 'bg-rose-50 text-rose-700',
  contra_asset: 'bg-slate-100 text-slate-700',
  contra_liability: 'bg-slate-100 text-slate-700',
};

const TYPE_ACCENT: Record<AccountType, string> = {
  asset: 'border-l-blue-400',
  liability: 'border-l-amber-400',
  equity: 'border-l-purple-400',
  income: 'border-l-emerald-400',
  expense: 'border-l-rose-400',
  contra_asset: 'border-l-slate-400',
  contra_liability: 'border-l-slate-400',
};

const PRIMARY_TYPES: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense'];

const TYPE_DEFAULT_BALANCE: Record<AccountType, NormalBalance> = {
  asset: 'debit',
  expense: 'debit',
  contra_liability: 'debit',
  liability: 'credit',
  equity: 'credit',
  income: 'credit',
  contra_asset: 'credit',
};

// ─── Tree building ─────────────────────────────────────────────────────────
function compareNodes(a: TreeNode, b: TreeNode, s: { field: SortField; dir: 'asc' | 'desc' } | null): number {
  if (!s) return a.code.localeCompare(b.code);
  const mul = s.dir === 'asc' ? 1 : -1;
  switch (s.field) {
    case 'code':
      return mul * a.code.localeCompare(b.code, undefined, { numeric: true });
    case 'name':
      return mul * a.name.localeCompare(b.name);
    case 'accountType':
      return mul * a.accountType.localeCompare(b.accountType) || a.code.localeCompare(b.code);
    case 'balance': {
      const diff = Number(a.totalBalance) - Number(b.totalBalance);
      if (diff !== 0) return mul * diff;
      return a.code.localeCompare(b.code);
    }
  }
}

function buildTree(rows: Account[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const a of rows) {
    byId.set(a.id, { ...a, children: [], depth: 0, totalBalance: '0' });
  }
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Two-pass: compute totalBalance bottom-up first (depth assignment), then
  // sort siblings using the active sort. Balance sorting needs totals first.
  function computeTotals(node: TreeNode, depth: number): number {
    node.depth = depth;
    let sum = (Number(node.balance) || 0) + (Number(node.openingBalance) || 0);
    for (const c of node.children) sum += computeTotals(c, depth + 1);
    node.totalBalance = sum.toFixed(2);
    return sum;
  }
  for (const r of roots) computeTotals(r, 0);

  // Now sort all sibling lists with the active sort (code asc by default).
  function sortRecursive(nodes: TreeNode[]): void {
    nodes.sort((a, b) => compareNodes(a, b, sort.value));
    for (const n of nodes) sortRecursive(n.children);
  }
  sortRecursive(roots);
  return roots;
}

function includeAncestors(seed: Account[]): Account[] {
  const ids = new Set(seed.map((a) => a.id));
  const all = new Map(items.value.map((a) => [a.id, a]));
  for (const a of seed) {
    let pid = a.parentId;
    while (pid) {
      if (ids.has(pid)) break;
      const p = all.get(pid);
      if (!p) break;
      ids.add(pid);
      pid = p.parentId;
    }
  }
  return items.value.filter((a) => ids.has(a.id));
}

const tree = computed<TreeNode[]>(() => {
  let base = items.value;
  if (filterType.value) {
    base = includeAncestors(items.value.filter((a) => a.accountType === filterType.value));
  }
  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    const matching = items.value.filter(
      (a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
    );
    base = includeAncestors(matching);
  }
  return buildTree(base);
});

function allNodeIds(nodes: TreeNode[]): Set<string> {
  const ids = new Set<string>();
  function collect(list: TreeNode[]): void {
    for (const n of list) {
      ids.add(n.id);
      collect(n.children);
    }
  }
  collect(nodes);
  return ids;
}

/** Saat mencari atau tampilkan saldo nol, buka semua cabang agar hasil terlihat. */
const effectiveExpanded = computed(() => {
  if (searchQuery.value.trim() || showZero.value) {
    return allNodeIds(tree.value);
  }
  return expanded.value;
});

/** Flatten the tree honoring expand/collapse and zero-balance filter. */
const visibleNodes = computed<TreeNode[]>(() => {
  const out: TreeNode[] = [];
  function walk(nodes: TreeNode[]) {
    for (const n of nodes) {
      if (!showZero.value && Number(n.totalBalance) === 0) continue;
      out.push(n);
      if (effectiveExpanded.value.has(n.id)) walk(n.children);
    }
  }
  walk(tree.value);
  return out;
});

const totalCount = computed(() => items.value.length);
const visibleCount = computed(() => visibleNodes.value.length);

const summaryStats = computed(() => {
  const t = grandTotalsByType.value;
  const assets = t.asset ?? 0;
  const liabilities = t.liability ?? 0;
  const equity = t.equity ?? 0;
  const income = t.income ?? 0;
  const expense = t.expense ?? 0;
  const netAssets = equity !== 0 ? equity : assets - liabilities;
  const surplus = income - expense;
  return { assets, liabilities, netAssets, income, expense, surplus };
});

function setTypeFilter(type: '' | AccountType): void {
  filterType.value = filterType.value === type ? '' : type;
}

function clearSearch(): void {
  searchQuery.value = '';
}

function matchesSearch(node: TreeNode): boolean {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return false;
  return node.code.toLowerCase().includes(q) || node.name.toLowerCase().includes(q);
}

function toggleRow(node: TreeNode): void {
  if (node.children.length > 0) toggle(node);
}

const parentOptions = computed(() =>
  items.value
    .filter((a) => a.id !== editing.value?.id)
    .map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` })),
);

const accountTypeOptions = computed(() =>
  Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })),
);

const normalBalanceOptions = [
  { value: 'debit', label: 'Debit' },
  { value: 'credit', label: 'Kredit' },
];

const parentSelectOptions = computed(() => [
  { value: '', label: '— Tidak ada —' },
  ...parentOptions.value.map((p) => ({ value: p.id, label: p.label })),
]);

function toggle(node: TreeNode): void {
  const next = new Set(expanded.value);
  if (next.has(node.id)) next.delete(node.id);
  else next.add(node.id);
  expanded.value = next;
  saveExpanded(next);
}

function viewTransactions(accountId: string): void {
  router.push({ path: '/transactions', query: { accountId } });
}

function expandAll(): void {
  const s = new Set(items.value.filter((a) => a).map((a) => a.id));
  expanded.value = s;
  saveExpanded(s);
}
function collapseAll(): void {
  expanded.value = new Set();
  saveExpanded(new Set());
}
function expandRootsOnly(): void {
  const s = new Set(items.value.filter((a) => a.parentId === null).map((a) => a.id));
  expanded.value = s;
  saveExpanded(s);
}

// ─── CRUD ──────────────────────────────────────────────────────────────────
function resetForm(a?: Account | null): void {
  form.parentId = a?.parentId ?? '';
  form.code = a?.code ?? '';
  form.name = a?.name ?? '';
  form.accountType = a?.accountType ?? 'asset';
  form.normalBalance = a?.normalBalance ?? 'debit';
  form.description = a?.description ?? '';
  form.isActive = a?.isActive ?? true;
  form.openingBalance = a?.openingBalance && a.openingBalance !== '0' ? a.openingBalance : '';
}

function onTypeChange(): void {
  form.normalBalance = TYPE_DEFAULT_BALANCE[form.accountType];
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await api.get<{ data: Account[] }>('/api/v1/accounts');
    items.value = res.data;
    // Only auto-expand roots on first visit (no saved state).
    if (expanded.value.size === 0) expandRootsOnly();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  editing.value = null;
  resetForm(null);
  modalError.value = null;
  modalOpen.value = true;
}

function openEdit(a: Account): void {
  editing.value = a;
  resetForm(a);
  modalError.value = null;
  modalOpen.value = true;
}

async function save(): Promise<void> {
  saving.value = true;
  modalError.value = null;
  try {
    const payload = {
      parentId: form.parentId || null,
      code: form.code,
      name: form.name,
      accountType: form.accountType,
      normalBalance: form.normalBalance,
      description: form.description || null,
      isActive: form.isActive,
      openingBalance: form.openingBalance || '0',
    };
    if (editing.value) {
      const { code: _omit, ...patch } = payload;
      void _omit;
      await api.patch(`/api/v1/accounts/${editing.value.id}`, patch);
    } else {
      await api.post('/api/v1/accounts', payload);
    }
    modalOpen.value = false;
    await load();
  } catch (err) {
    const e = err as { body?: { error?: string } };
    modalError.value = e.body?.error ?? (err as Error).message;
  } finally {
    saving.value = false;
  }
}

function askDelete(a: Account): void {
  toDelete.value = a;
  confirmOpen.value = true;
}

async function doDelete(): Promise<void> {
  if (!toDelete.value) return;
  deleting.value = true;
  try {
    await api.delete(`/api/v1/accounts/${toDelete.value.id}`);
    confirmOpen.value = false;
    toDelete.value = null;
    await load();
  } catch (err) {
    const e = err as { body?: { error?: string } };
    error.value = e.body?.error ?? (err as Error).message;
  } finally {
    deleting.value = false;
  }
}

async function seed(): Promise<void> {
  seeding.value = true;
  error.value = null;
  try {
    await api.post('/api/v1/accounts/_seed', {});
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    seeding.value = false;
  }
}

function openMerge(a: Account): void {
  mergeSource.value = a;
  mergeTargetId.value = '';
  mergeError.value = null;
  mergeOpen.value = true;
}

async function doMerge(): Promise<void> {
  if (!mergeSource.value || !mergeTargetId.value) return;
  merging.value = true;
  mergeError.value = null;
  try {
    const res = await api.post<{
      journalLinesReassigned: number;
      transactionLinesReassigned: number;
    }>(`/api/v1/accounts/${mergeSource.value.id}/merge`, { targetId: mergeTargetId.value });
    mergeOpen.value = false;
    await load();
    // Brief success info in page error (reuse for positive feedback)
    error.value = null;
    // Show inline info via a non-destructive approach: just reload silently
    void res;
  } catch (err) {
    const e = err as { body?: { error?: string } };
    const reason = e.body?.error ?? (err as Error).message;
    const reasonMap: Record<string, string> = {
      same_account: 'Pilih akun tujuan yang berbeda.',
      source_not_found: 'Akun sumber tidak ditemukan.',
      target_not_found: 'Akun tujuan tidak ditemukan.',
      source_is_system: 'Akun sistem tidak bisa di-merge.',
    };
    mergeError.value = reasonMap[reason] ?? reason;
  } finally {
    merging.value = false;
  }
}

const grandTotalsByType = computed(() => {
  const totals: Partial<Record<AccountType, number>> = {};
  const fullTree = buildTree(items.value);
  for (const root of fullTree) {
    totals[root.accountType] = (totals[root.accountType] ?? 0) + Number(root.totalBalance);
  }
  return totals;
});

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <PageHeader
      title="Bagan Akun"
      description="Hirarki COA dengan saldo (PSAK 45)"
      :crumbs="[{ label: 'Dashboard', to: '/' }, { label: 'Keuangan' }, { label: 'Bagan Akun' }]"
    >
      <template #actions>
        <Button variant="secondary" :loading="seeding" @click="seed">
          <Sprout class="h-4 w-4" /> Seed default
        </Button>
        <Button @click="openCreate"><Plus class="h-4 w-4" /> Tambah</Button>
      </template>
    </PageHeader>

    <!-- Ringkasan utama — klik untuk filter cepat -->
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <button
        type="button"
        class="rounded-xl border bg-card p-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/40"
        :class="filterType === 'asset' ? 'border-blue-400 bg-blue-50/60 ring-1 ring-blue-200' : ''"
        @click="setTypeFilter('asset')"
      >
        <div class="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-blue-700">
          <Wallet class="h-3.5 w-3.5" /> Total Aset
        </div>
        <p class="font-mono text-base font-semibold tabular-nums">
          <MoneyText :value="summaryStats.assets || null" />
        </p>
      </button>
      <button
        type="button"
        class="rounded-xl border bg-card p-3 text-left transition-colors hover:border-amber-300 hover:bg-amber-50/40"
        :class="filterType === 'liability' ? 'border-amber-400 bg-amber-50/60 ring-1 ring-amber-200' : ''"
        @click="setTypeFilter('liability')"
      >
        <div class="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-amber-700">
          <Landmark class="h-3.5 w-3.5" /> Kewajiban
        </div>
        <p class="font-mono text-base font-semibold tabular-nums">
          <MoneyText :value="summaryStats.liabilities || null" />
        </p>
      </button>
      <button
        type="button"
        class="rounded-xl border bg-card p-3 text-left transition-colors hover:border-purple-300 hover:bg-purple-50/40"
        :class="filterType === 'equity' ? 'border-purple-400 bg-purple-50/60 ring-1 ring-purple-200' : ''"
        @click="setTypeFilter('equity')"
      >
        <div class="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-purple-700">
          <Scale class="h-3.5 w-3.5" /> Aset Neto
        </div>
        <p class="font-mono text-base font-semibold tabular-nums">
          <MoneyText :value="summaryStats.netAssets || null" />
        </p>
      </button>
      <div
        class="rounded-xl border bg-card p-3"
        :class="summaryStats.surplus >= 0 ? 'border-emerald-200 bg-emerald-50/30' : 'border-rose-200 bg-rose-50/30'"
      >
        <div
          class="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest"
          :class="summaryStats.surplus >= 0 ? 'text-emerald-700' : 'text-rose-700'"
        >
          <TrendingUp class="h-3.5 w-3.5" /> Surplus / Defisit
        </div>
        <p class="font-mono text-base font-semibold tabular-nums">
          <MoneyText :value="summaryStats.surplus || null" />
        </p>
        <p class="mt-0.5 text-[10px] text-muted-foreground">
          Pendapatan <MoneyText :value="summaryStats.income || null" class="inline text-[10px]" />
          − Beban <MoneyText :value="summaryStats.expense || null" class="inline text-[10px]" />
        </p>
      </div>
    </div>

    <!-- Toolbar: cari + filter -->
    <div class="sticky top-0 z-20 -mx-4 space-y-2 bg-background/95 px-4 py-2 backdrop-blur-md md:static md:mx-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
      <Card>
        <CardContent class="flex flex-col gap-3 px-4 py-3">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div class="relative min-w-0 flex-1">
              <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                v-model="searchQuery"
                class="pl-9 pr-9"
                placeholder="Cari kode atau nama akun…"
                aria-label="Cari akun"
              />
              <button
                v-if="searchQuery"
                type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Hapus pencarian"
                @click="clearSearch"
              >
                <X class="h-4 w-4" />
              </button>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <AppCheckbox v-model="showZero" label="Saldo nol" />
              <Button variant="ghost" size="sm" @click="expandAll">Buka semua</Button>
              <Button variant="ghost" size="sm" @click="collapseAll">Tutup</Button>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              class="rounded-lg px-2.5 py-1 text-xs font-medium transition-colors"
              :class="!filterType ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'"
              @click="setTypeFilter('')"
            >
              Semua
            </button>
            <button
              v-for="type in PRIMARY_TYPES"
              :key="type"
              type="button"
              class="rounded-lg px-2.5 py-1 text-xs font-medium transition-colors"
              :class="filterType === type
                ? TYPE_BADGE[type] + ' ring-1 ring-current/20'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted'"
              @click="setTypeFilter(type)"
            >
              {{ TYPE_LABEL[type] }}
            </button>
            <span class="ml-auto text-xs text-muted-foreground">
              <template v-if="searchQuery || filterType || !showZero">
                {{ visibleCount }} / {{ totalCount }} akun
              </template>
              <template v-else>{{ totalCount }} akun</template>
            </span>
          </div>
        </CardContent>
      </Card>
    </div>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div v-if="loading" class="space-y-2">
      <Skeleton v-for="i in 6" :key="i" class="h-10 w-full" />
    </div>

    <div v-else-if="visibleNodes.length > 0" class="overflow-hidden rounded-xl border bg-card">
      <div class="max-h-[calc(100vh-22rem)] overflow-auto">
        <Table>
          <TableHeader class="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm">
            <TableRow class="hover:bg-transparent">
              <TableHead class="px-4 text-xs uppercase tracking-wide text-muted-foreground">
                <SortableHeader field="name" :active="sort" @sort="setSort">Akun</SortableHeader>
              </TableHead>
              <TableHead class="hidden w-24 px-4 text-xs uppercase tracking-wide text-muted-foreground sm:table-cell">
                <SortableHeader field="code" :active="sort" @sort="setSort">Kode</SortableHeader>
              </TableHead>
              <TableHead class="hidden w-28 px-4 text-xs uppercase tracking-wide text-muted-foreground md:table-cell">
                <SortableHeader field="accountType" :active="sort" @sort="setSort">Tipe</SortableHeader>
              </TableHead>
              <TableHead class="hidden w-28 px-4 text-right text-xs uppercase tracking-wide text-muted-foreground lg:table-cell">
                Saldo Awal
              </TableHead>
              <TableHead class="w-36 px-4 text-right text-xs uppercase tracking-wide text-muted-foreground">
                <SortableHeader field="balance" :active="sort" align="end" @sort="setSort">
                  Saldo Total
                </SortableHeader>
              </TableHead>
              <TableHead class="w-28 px-2" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="node in visibleNodes"
              :key="node.id"
              class="group border-l-2 transition-colors"
              :class="[
                TYPE_ACCENT[node.accountType],
                node.children.length > 0 ? 'bg-muted/20' : '',
                matchesSearch(node) ? 'bg-amber-50/60' : 'hover:bg-muted/30',
              ]"
            >
              <TableCell class="px-4 py-2">
                <button
                  type="button"
                  class="flex w-full min-h-9 items-center gap-1 text-left"
                  :class="node.children.length > 0 ? 'cursor-pointer' : 'cursor-default'"
                  :style="{ paddingLeft: `${node.depth * 14}px` }"
                  @click="toggleRow(node)"
                >
                  <span
                    v-if="node.children.length > 0"
                    class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground"
                  >
                    <ChevronDown v-if="effectiveExpanded.has(node.id)" class="h-3.5 w-3.5" />
                    <ChevronRight v-else class="h-3.5 w-3.5" />
                  </span>
                  <span v-else class="inline-block w-6 shrink-0" />
                  <span class="min-w-0">
                    <span
                      class="block truncate"
                      :class="node.children.length > 0 ? 'font-semibold text-foreground' : 'text-foreground/90'"
                    >
                      {{ node.name }}
                    </span>
                    <span class="font-mono text-[10px] text-muted-foreground sm:hidden">{{ node.code }}</span>
                  </span>
                  <span
                    v-if="node.isSystem"
                    class="ml-1 shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground"
                  >
                    sistem
                  </span>
                  <span
                    v-if="!node.isActive"
                    class="ml-1 shrink-0 rounded bg-rose-50 px-1 py-0.5 text-[10px] text-rose-700"
                  >
                    nonaktif
                  </span>
                </button>
              </TableCell>
              <TableCell class="hidden px-4 py-2 font-mono text-xs text-muted-foreground sm:table-cell">
                {{ node.code }}
              </TableCell>
              <TableCell class="hidden px-4 py-2 md:table-cell">
                <Badge variant="outline" class="text-[10px] font-medium" :class="TYPE_BADGE[node.accountType]">
                  {{ TYPE_LABEL[node.accountType] }}
                </Badge>
              </TableCell>
              <TableCell class="hidden px-4 py-2 text-right font-mono text-sm lg:table-cell">
                <MoneyText
                  :value="Number(node.openingBalance) !== 0 ? node.openingBalance : null"
                  :class="Number(node.openingBalance) === 0 ? 'text-muted-foreground/40' : ''"
                />
              </TableCell>
              <TableCell class="px-4 py-2 text-right font-mono">
                <MoneyText
                  :value="Number(node.totalBalance) !== 0 ? node.totalBalance : null"
                  :class="node.children.length > 0 ? 'font-semibold' : ''"
                />
                <span
                  v-if="node.children.length > 0 && Number(node.balance) !== 0"
                  class="ml-1 hidden text-[10px] text-muted-foreground xl:inline"
                  title="Saldo langsung akun ini (tanpa anak)"
                >
                  (<MoneyText :value="node.balance" class="inline text-[10px]" />)
                </span>
              </TableCell>
              <TableCell class="px-2 py-2">
                <div class="flex justify-end gap-0.5 opacity-70 transition-opacity group-hover:opacity-100 sm:opacity-50">
                  <Button
                    v-if="Number(node.totalBalance) !== 0"
                    variant="ghost"
                    size="sm"
                    title="Lihat transaksi"
                    aria-label="Lihat transaksi"
                    @click="viewTransactions(node.id)"
                  >
                    <ArrowRightLeft class="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" title="Edit akun" aria-label="Edit akun" @click="openEdit(node)">
                    <Pencil class="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    v-if="!node.isSystem"
                    variant="ghost"
                    size="sm"
                    title="Merge akun"
                    aria-label="Merge akun"
                    @click="openMerge(node)"
                  >
                    <GitMerge class="h-3.5 w-3.5 text-violet-600" />
                  </Button>
                  <Button
                    v-if="!node.isSystem"
                    variant="ghost"
                    size="sm"
                    title="Hapus akun"
                    aria-label="Hapus akun"
                    @click="askDelete(node)"
                  >
                    <Trash2 class="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>

    <div
      v-else-if="!loading && items.length > 0"
      class="rounded-xl border border-dashed bg-card px-5 py-10 text-center text-sm text-muted-foreground"
    >
      <p v-if="searchQuery">Tidak ada akun untuk "{{ searchQuery }}".</p>
      <p v-else-if="!showZero">Semua akun bersaldo nol tersembunyi. Centang <strong>Saldo nol</strong> untuk menampilkan.</p>
      <p v-else>Tidak ada akun yang cocok dengan filter.</p>
      <div class="mt-3 flex justify-center gap-2">
        <Button v-if="searchQuery" variant="secondary" size="sm" @click="clearSearch">Hapus pencarian</Button>
        <Button v-if="!showZero" variant="secondary" size="sm" @click="showZero = true">Tampilkan saldo nol</Button>
      </div>
    </div>

    <p v-else-if="!loading" class="rounded-xl border border-dashed bg-card px-5 py-10 text-center text-sm text-muted-foreground">
      Belum ada akun. Klik "Seed default" untuk memuat bagan akun PSAK 45.
    </p>

    <Modal v-model:open="modalOpen" :title="editing ? 'Edit Akun' : 'Akun Baru'" size="lg">
      <Alert v-if="modalError" variant="destructive" class="mb-3">
        <AlertDescription>{{ modalError }}</AlertDescription>
      </Alert>
      <form class="space-y-3" @submit.prevent="save">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Kode" required>
            <Input
              v-model="form.code"
              :disabled="!!editing"
              required
              maxlength="20"
              placeholder="1110"
            />
          </FormField>
          <FormField label="Akun induk">
            <AppSelect v-model="form.parentId" :options="parentSelectOptions" placeholder="— Tidak ada —" />
          </FormField>
        </div>
        <FormField label="Nama" required>
          <Input v-model="form.name" required minlength="2" />
        </FormField>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Tipe akun" required>
            <AppSelect
              v-model="form.accountType"
              :options="accountTypeOptions"
              @update:model-value="onTypeChange"
            />
          </FormField>
          <FormField label="Saldo normal" required>
            <AppSelect v-model="form.normalBalance" :options="normalBalanceOptions" />
          </FormField>
        </div>
        <FormField label="Deskripsi">
          <Textarea v-model="form.description" rows="2" />
        </FormField>
        <FormField label="Saldo awal" hint="Saldo sebelum ada jurnal \u2014 nilainya ditambahkan ke mutasi">
          <Input v-model="form.openingBalance" inputmode="decimal" placeholder="0" />
        </FormField>
        <FormField label="Status">
          <AppCheckbox v-model="form.isActive" label="Aktif" />
        </FormField>
      </form>
      <template #footer>
        <Button variant="secondary" @click="modalOpen = false">Batal</Button>
        <Button :loading="saving" @click="save">{{ editing ? 'Simpan' : 'Buat' }}</Button>
      </template>
    </Modal>

    <ConfirmDialog
      v-model:open="confirmOpen"
      title="Hapus akun"
      :message="`Akun '${toDelete?.code} — ${toDelete?.name}' akan dihapus (soft-delete).`"
      :loading="deleting"
      @confirm="doDelete"
    />

    <Modal v-model:open="mergeOpen" title="Merge akun" size="md">
      <div class="space-y-4">
        <Alert v-if="mergeError" variant="destructive">
          <AlertDescription>{{ mergeError }}</AlertDescription>
        </Alert>

        <!-- Source -->
        <div class="rounded-lg border bg-muted/40 px-4 py-3">
          <p class="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Akun sumber (akan dihapus)</p>
          <p class="font-mono text-sm font-semibold">
            {{ mergeSource?.code }}
            <span class="ml-2 font-sans font-normal text-foreground">{{ mergeSource?.name }}</span>
          </p>
          <p class="mt-0.5 text-xs text-muted-foreground">Semua jurnal, transaksi, dan referensi kategori akan dipindah ke akun tujuan.</p>
        </div>

        <!-- Target -->
        <FormField label="Gabungkan ke akun" required>
          <SmartAccountSelect
            :model-value="mergeTargetId || null"
            :accounts="items.filter(a => a.id !== mergeSource?.id && a.isActive)"
            placeholder="Cari akun tujuan..."
            @update:model-value="(v) => mergeTargetId = v"
          />
        </FormField>

        <p class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <strong>Perhatian:</strong> tindakan ini tidak bisa dibatalkan. Akun sumber akan di-nonaktifkan permanen setelah semua datanya dipindah.
        </p>
      </div>
      <template #footer>
        <Button variant="secondary" @click="mergeOpen = false">Batal</Button>
        <Button
          :loading="merging"
          :disabled="!mergeTargetId"
          class="bg-violet-600 hover:bg-violet-700 text-white"
          @click="doMerge"
        >
          <GitMerge class="h-4 w-4" /> Merge sekarang
        </Button>
      </template>
    </Modal>
  </div>
</template>
