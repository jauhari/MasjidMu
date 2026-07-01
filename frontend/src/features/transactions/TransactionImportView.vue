<script setup lang="ts">
/**
 * TransactionImportView — historical journal import dari Google Sheets.
 *
 * Backend menerima file .xlsx, parse sheet "JURNAL" (Tanggal/Keterangan/
 * Akun/Debit/Kredit), grouping per (Tanggal+Keterangan), auto-match akun
 * ke COA berdasarkan nama. Frontend bertugas:
 *
 *   1. Upload — pilih file xlsx + nama sheet (default "JURNAL")
 *   2. Review — preview hasil parse + mapping akun yang belum match
 *   3. Commit — kirim alasan ≥10 char, backend bikin transaksi + posting jurnal
 *   4. Result — laporan jumlah berhasil/gagal
 *
 * Permission: `transactions.god_mode` (super_admin only).
 *
 * Endpoint:
 *   POST /api/v1/transactions/_import/parse  (multipart form)
 *   POST /api/v1/transactions/_import/commit (JSON { reason, groups })
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  ArrowLeft,
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Send,
  Shield,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Link2,
  HardDriveUpload,
} from 'lucide-vue-next';
import { api } from '@/shared/api/client';
import { useAuthStore } from '@/features/auth/store';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Button from '@/shared/ui/Button.vue';
import FormField from '@/shared/ui/FormField.vue';
import PageHeader from '@/shared/ui/PageHeader.vue';
import AppSelect from '@/shared/ui/AppSelect.vue';
import AppCheckbox from '@/shared/ui/AppCheckbox.vue';
import MoneyText from '@/shared/ui/MoneyText.vue';

// ─── Types matching backend ─────────────────────────────────────────────────
interface ParsedLine {
  rowIndex: number;
  accountName: string;
  subAccountName: string | null;
  debit: string;
  credit: string;
  matchedAccountId: string | null;
  matchedAccountCode: string | null;
}
interface ParsedGroup {
  groupId: string;
  date: string;
  description: string;
  lines: ParsedLine[];
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
  warning: string | null;
}
interface ParseResult {
  totalRows: number;
  totalGroups: number;
  unmatchedAccountNames: string[];
  errors: Array<{ row: number; message: string }>;
  groups: ParsedGroup[];
}
interface Account {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}
interface CommitResult {
  importedCount: number;
  failedCount: number;
  failures: Array<{ index: number; description: string; error: string }>;
}

const SKIP = '__SKIP__';
type Override = string; // accountId | SKIP

// ─── State ─────────────────────────────────────────────────────────────────
const router = useRouter();
const auth = useAuthStore();

const stage = ref<'upload' | 'review' | 'committing' | 'result'>('upload');
const source = ref<'file' | 'url'>('url');
const file = ref<File | null>(null);
const sheetUrl = ref('');
const sheetName = ref('JURNAL');
const parsing = ref(false);
const parseResult = ref<ParseResult | null>(null);
const error = ref<string | null>(null);

const accounts = ref<Account[]>([]);
const overrides = reactive<Record<string, Override>>({});
const selectedIds = ref<Set<string>>(new Set());
const expandedIds = ref<Set<string>>(new Set());

const reason = ref('');
const committing = ref(false);
const commitResult = ref<CommitResult | null>(null);

// ─── Permission gate ───────────────────────────────────────────────────────
const allowed = computed(() => auth.isSuperAdmin || auth.hasPermission('transactions.god_mode'));

// ─── File handling ─────────────────────────────────────────────────────────
function onFileChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0] ?? null;
  if (!f) {
    file.value = null;
    return;
  }
  if (f.size > 20 * 1024 * 1024) {
    error.value = 'File terlalu besar (maksimal 20 MB)';
    return;
  }
  if (!/\.(xlsx|xlsm)$/i.test(f.name)) {
    error.value = 'Hanya file Excel (.xlsx) yang didukung';
    return;
  }
  error.value = null;
  file.value = f;
}

function resetAll(): void {
  file.value = null;
  sheetUrl.value = '';
  parseResult.value = null;
  selectedIds.value = new Set();
  expandedIds.value = new Set();
  for (const k of Object.keys(overrides)) delete overrides[k];
  reason.value = '';
  commitResult.value = null;
  error.value = null;
  stage.value = 'upload';
}

// ─── Parse ─────────────────────────────────────────────────────────────────
async function loadAccounts(): Promise<void> {
  try {
    const res = await api.get<{ data: Account[] }>('/api/v1/accounts', { query: { lite: 1 } });
    accounts.value = res.data.filter((a) => a.isActive);
  } catch (err) {
    error.value = (err as Error).message;
  }
}

async function parseFile(): Promise<void> {
  if (source.value === 'file' && !file.value) return;
  if (source.value === 'url' && !sheetUrl.value.trim()) return;

  parsing.value = true;
  error.value = null;
  try {
    let res: { data: ParseResult };
    if (source.value === 'file') {
      const fd = new FormData();
      fd.append('file', file.value!);
      fd.append('sheet', sheetName.value || 'JURNAL');
      res = await api.post<{ data: ParseResult }>('/api/v1/transactions/_import/parse', fd);
    } else {
      res = await api.post<{ data: ParseResult }>('/api/v1/transactions/_import/parse-url', {
        url: sheetUrl.value.trim(),
        sheet: sheetName.value || 'JURNAL',
      });
    }
    parseResult.value = res.data;

    // Default selection: only balanced groups
    selectedIds.value = new Set(res.data.groups.filter((g) => g.balanced).map((g) => g.groupId));

    // Initialize overrides for unmatched names (empty string = needs mapping)
    for (const n of res.data.unmatchedAccountNames) {
      if (!(n in overrides)) overrides[n] = '';
    }

    // Auto-expand first 5 groups for quick scan
    expandedIds.value = new Set(res.data.groups.slice(0, 5).map((g) => g.groupId));

    stage.value = 'review';
  } catch (err) {
    const e = err as { body?: { error?: string; detail?: string } };
    error.value = e.body?.detail ?? e.body?.error ?? (err as Error).message;
  } finally {
    parsing.value = false;
  }
}

// ─── Mapping helpers ───────────────────────────────────────────────────────
function effectiveAccountId(line: ParsedLine): string | null {
  if (line.matchedAccountId) return line.matchedAccountId;
  const ov = overrides[line.accountName];
  if (!ov || ov === SKIP) return null;
  return ov;
}

function effectiveLines(g: ParsedGroup): ParsedLine[] {
  return g.lines.filter((l) => {
    if (l.matchedAccountId) return true;
    const ov = overrides[l.accountName];
    return ov && ov !== SKIP;
  });
}

function groupReady(g: ParsedGroup): { ok: boolean; reason?: string } {
  const lines = effectiveLines(g);
  if (lines.length < 2) return { ok: false, reason: `tersisa ${lines.length} baris setelah skip` };
  let d = 0;
  let c = 0;
  for (const l of lines) {
    d += Number(l.debit) || 0;
    c += Number(l.credit) || 0;
  }
  if (Math.abs(d - c) > 0.005) {
    return { ok: false, reason: `tidak balance (D=${fmtIDR(String(d))} K=${fmtIDR(String(c))})` };
  }
  if (d <= 0) return { ok: false, reason: 'nominal nol' };
  return { ok: true };
}

const unresolvedCount = computed(() => {
  if (!parseResult.value) return 0;
  return parseResult.value.unmatchedAccountNames.filter((n) => !overrides[n]).length;
});

const groupsReady = computed(() => {
  if (!parseResult.value) return new Map<string, { ok: boolean; reason?: string }>();
  const m = new Map<string, { ok: boolean; reason?: string }>();
  for (const g of parseResult.value.groups) m.set(g.groupId, groupReady(g));
  return m;
});

const totals = computed(() => {
  if (!parseResult.value) return { selected: 0, ready: 0, blocked: 0 };
  let ready = 0;
  let blocked = 0;
  for (const g of parseResult.value.groups) {
    if (!selectedIds.value.has(g.groupId)) continue;
    const r = groupsReady.value.get(g.groupId);
    if (r?.ok) ready++;
    else blocked++;
  }
  return { selected: selectedIds.value.size, ready, blocked };
});

const canCommit = computed(
  () =>
    !committing.value &&
    reason.value.trim().length >= 10 &&
    totals.value.ready > 0 &&
    totals.value.blocked === 0,
);

// ─── Commit ────────────────────────────────────────────────────────────────
function toggleSelect(g: ParsedGroup): void {
  const next = new Set(selectedIds.value);
  if (next.has(g.groupId)) next.delete(g.groupId);
  else next.add(g.groupId);
  selectedIds.value = next;
}

function toggleExpand(g: ParsedGroup): void {
  const next = new Set(expandedIds.value);
  if (next.has(g.groupId)) next.delete(g.groupId);
  else next.add(g.groupId);
  expandedIds.value = next;
}

function selectAll(): void {
  if (!parseResult.value) return;
  selectedIds.value = new Set(parseResult.value.groups.map((g) => g.groupId));
}
function selectReady(): void {
  if (!parseResult.value) return;
  selectedIds.value = new Set(
    parseResult.value.groups.filter((g) => groupsReady.value.get(g.groupId)?.ok).map((g) => g.groupId),
  );
}
function selectNone(): void {
  selectedIds.value = new Set();
}

async function commit(): Promise<void> {
  if (!parseResult.value || !canCommit.value) return;
  committing.value = true;
  error.value = null;
  stage.value = 'committing';
  try {
    const groups = parseResult.value.groups
      .filter((g) => selectedIds.value.has(g.groupId))
      .map((g) => ({
        date: g.date,
        description: g.description || '(tanpa keterangan)',
        referenceNo: null,
        lines: effectiveLines(g).map((l) => ({
          accountId: effectiveAccountId(l)!,
          debit: l.debit,
          credit: l.credit,
          description: l.subAccountName ?? null,
        })),
      }));

    const res = await api.post<{ data: CommitResult }>('/api/v1/transactions/_import/commit', {
      reason: reason.value.trim(),
      groups,
    });
    commitResult.value = res.data;
    stage.value = 'result';
  } catch (err) {
    const e = err as { body?: { error?: string; detail?: string } };
    error.value = e.body?.detail ?? e.body?.error ?? (err as Error).message;
    stage.value = 'review';
  } finally {
    committing.value = false;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function fmtIDR(s: string | number): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return String(s);
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(n);
}

function fmtDate(s: string): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function accountLabel(id: string | null): string {
  if (!id) return '—';
  const a = accounts.value.find((x) => x.id === id);
  return a ? `${a.code} — ${a.name}` : id;
}

const overrideSelectOptions = computed(() => [
  { value: '', label: '— Pilih akun COA atau lewati —', disabled: true },
  { value: SKIP, label: '⊘ Lewati (abaikan baris dengan akun ini)' },
  ...accounts.value.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
]);

onMounted(() => {
  if (!allowed.value) return;
  loadAccounts();
});
</script>

<template>
  <!-- Permission gate -->
  <div
    v-if="!allowed"
    class="rounded-xl border border-rose-200 bg-rose-50 px-5 py-6 text-sm text-rose-800"
  >
    <div class="flex items-center gap-2 font-semibold">
      <Shield class="h-4 w-4" /> Akses ditolak
    </div>
    <p class="mt-1">
      Fitur impor jurnal hanya tersedia untuk super admin (permission
      <code>transactions.god_mode</code>). Hubungi admin platform jika butuh impor data historis.
    </p>
  </div>

  <div v-else class="space-y-5">
    <button
      class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      @click="router.push('/transactions')"
    >
      <ArrowLeft class="h-3.5 w-3.5" /> Kembali ke transaksi
    </button>

    <PageHeader
      title="Impor Jurnal Historis"
      description="Unggah file Excel (.xlsx) dari Google Sheets layanan lama. Sheet bernama JURNAL dengan kolom Tanggal • Keterangan • Akun • Debit • Kredit."
      :crumbs="[{ label: 'Dashboard', to: '/' }, { label: 'Keuangan' }, { label: 'Transaksi', to: '/transactions' }, { label: 'Impor Jurnal' }]"
    >
      <template #actions>
        <div
          class="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700"
        >
          <Shield class="h-3.5 w-3.5" /> GOD MODE — bypass state machine, langsung posted.
        </div>
      </template>
    </PageHeader>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <!-- ─── STAGE 1: UPLOAD ──────────────────────────────────────────────── -->
    <Card v-if="stage === 'upload'">
      <CardContent class="space-y-4 p-6">
      <h2 class="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <Upload class="h-4 w-4" /> Langkah 1 — Pilih sumber data
      </h2>

      <!-- Source toggle -->
      <div class="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition"
          :class="source === 'url' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'"
          @click="source = 'url'"
        >
          <Link2 class="h-3.5 w-3.5" /> Google Sheets URL
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition"
          :class="source === 'file' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'"
          @click="source = 'file'"
        >
          <HardDriveUpload class="h-3.5 w-3.5" /> Upload XLSX
        </button>
      </div>

      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <!-- URL source -->
        <FormField
          v-if="source === 'url'"
          label="URL Google Sheets"
          required
          hint="Sheet harus di-share 'Anyone with link can view'"
        >
          <Input
            v-model="sheetUrl"
            placeholder="https://docs.google.com/spreadsheets/d/..."
            type="url"
            autocomplete="off"
            spellcheck="false"
          />
        </FormField>

        <!-- File source -->
        <FormField
          v-else
          label="File Excel (.xlsx)"
          required
          hint="Maksimal 20 MB"
        >
          <label
            class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-600 hover:border-brand-400 hover:bg-brand-50/40"
          >
            <FileSpreadsheet class="h-7 w-7 text-slate-400" />
            <span v-if="!file">Klik untuk memilih file…</span>
            <span v-else class="font-medium text-slate-900">{{ file.name }}</span>
            <span v-if="file" class="text-xs text-slate-500">{{ (file.size / 1024).toFixed(1) }} KB</span>
            <Input
              type="file"
              accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              class="hidden"
              @change="onFileChange"
            />
          </label>
        </FormField>

        <FormField label="Nama sheet" required hint="Default: JURNAL">
          <Input v-model="sheetName" placeholder="JURNAL" />
        </FormField>
      </div>

      <div v-if="source === 'url'" class="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-900">
        <p class="font-medium">Cara share Google Sheets:</p>
        <ol class="mt-1 ml-4 list-decimal space-y-0.5">
          <li>Buka spreadsheet → klik tombol <strong>Share</strong> (kanan atas)</li>
          <li>Di "General access", pilih <strong>Anyone with the link</strong></li>
          <li>Role: <strong>Viewer</strong> sudah cukup</li>
          <li>Copy link, paste di kolom URL</li>
        </ol>
      </div>

      <div class="rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-600">
        <p class="font-medium text-slate-700">Format yang diharapkan:</p>
        <p class="mt-1">
          Baris header berisi kolom <strong>Tanggal</strong>, <strong>Keterangan</strong>,
          <strong>Sub Akun</strong> (opsional), <strong>Akun</strong>,
          <strong>Debit</strong>, <strong>Kredit</strong>. Baris konsekutif dengan tanggal +
          keterangan yang sama dianggap satu transaksi (multi-line). Setiap baris harus
          punya debit ATAU kredit (bukan keduanya).
        </p>
      </div>

      <div class="flex justify-end gap-2 pt-2">
        <Button
          variant="secondary"
          :disabled="source === 'file' ? !file : !sheetUrl.trim()"
          @click="resetAll"
        >
          Batal
        </Button>
        <Button
          :loading="parsing"
          :disabled="parsing || (source === 'file' ? !file : !sheetUrl.trim())"
          @click="parseFile"
        >
          <Upload class="h-4 w-4" /> Parse data
        </Button>
      </div>
      </CardContent>
    </Card>

    <!-- ─── STAGE 2: REVIEW ──────────────────────────────────────────────── -->
    <template v-else-if="stage === 'review' && parseResult">
      <!-- Summary bar -->
      <div class="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-5">
        <div>
          <p class="text-xs uppercase tracking-wide text-slate-500">Total baris</p>
          <p class="mt-0.5 text-lg font-semibold tabular-nums">{{ parseResult.totalRows }}</p>
        </div>
        <div>
          <p class="text-xs uppercase tracking-wide text-slate-500">Total grup</p>
          <p class="mt-0.5 text-lg font-semibold tabular-nums">{{ parseResult.totalGroups }}</p>
        </div>
        <div>
          <p class="text-xs uppercase tracking-wide text-slate-500">Akun belum match</p>
          <p
            class="mt-0.5 text-lg font-semibold tabular-nums"
            :class="unresolvedCount > 0 ? 'text-amber-700' : 'text-emerald-700'"
          >
            {{ unresolvedCount }} / {{ parseResult.unmatchedAccountNames.length }}
          </p>
        </div>
        <div>
          <p class="text-xs uppercase tracking-wide text-slate-500">Siap impor</p>
          <p class="mt-0.5 text-lg font-semibold tabular-nums text-emerald-700">{{ totals.ready }}</p>
        </div>
        <div>
          <p class="text-xs uppercase tracking-wide text-slate-500">Terblokir</p>
          <p
            class="mt-0.5 text-lg font-semibold tabular-nums"
            :class="totals.blocked > 0 ? 'text-rose-700' : 'text-slate-400'"
          >
            {{ totals.blocked }}
          </p>
        </div>
      </div>

      <!-- Parser errors -->
      <details
        v-if="parseResult.errors.length > 0"
        class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
      >
        <summary class="cursor-pointer font-medium">
          {{ parseResult.errors.length }} baris dilewati saat parsing
        </summary>
        <ul class="mt-2 max-h-40 overflow-y-auto space-y-1 text-xs">
          <li v-for="(e, i) in parseResult.errors" :key="i">Baris {{ e.row }}: {{ e.message }}</li>
        </ul>
      </details>

      <!-- Unmatched account mapping -->
      <section
        v-if="parseResult.unmatchedAccountNames.length > 0"
        class="rounded-xl border border-slate-200 bg-white p-5"
      >
        <header class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-slate-700">
            Mapping akun yang belum cocok
          </h2>
          <span class="text-xs text-slate-500">
            Pilih akun COA yang sesuai, atau lewati untuk mengabaikan baris terkait.
          </span>
        </header>
        <div class="mt-3 overflow-hidden rounded-lg border">
          <Table>
            <TableHeader class="bg-muted/50">
              <TableRow class="hover:bg-transparent">
                <TableHead class="px-3 text-xs uppercase tracking-wide text-muted-foreground">Nama akun (di file)</TableHead>
                <TableHead class="px-3 text-xs uppercase tracking-wide text-muted-foreground">→ Akun COA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="name in parseResult.unmatchedAccountNames" :key="name">
                <TableCell class="px-3 py-2 font-medium">{{ name }}</TableCell>
                <TableCell class="px-3 py-2">
                  <AppSelect
                    v-model="overrides[name]"
                    :options="overrideSelectOptions"
                    placeholder="— Pilih akun COA atau lewati —"
                  />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </section>

      <!-- Group preview list -->
      <section class="rounded-xl border border-slate-200 bg-white">
        <header class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
          <h2 class="text-sm font-semibold text-slate-700">
            Pratinjau grup transaksi
          </h2>
          <div class="flex items-center gap-1.5 text-xs">
            <Button variant="ghost" size="sm" @click="selectReady">Pilih siap</Button>
            <Button variant="ghost" size="sm" @click="selectAll">Semua</Button>
            <Button variant="ghost" size="sm" @click="selectNone">Kosongkan</Button>
            <span class="ml-2 text-slate-500">
              {{ totals.selected }} dipilih ({{ totals.ready }} siap, {{ totals.blocked }} blok)
            </span>
          </div>
        </header>

        <div class="divide-y divide-slate-100">
          <article
            v-for="g in parseResult.groups"
            :key="g.groupId"
            class="px-5 py-3"
            :class="{ 'bg-slate-50/50': !groupsReady.get(g.groupId)?.ok }"
          >
            <div class="flex items-start gap-3">
              <AppCheckbox
                class="mt-1"
                :model-value="selectedIds.has(g.groupId)"
                @update:model-value="toggleSelect(g)"
              />
              <button
                type="button"
                class="flex-1 text-left"
                @click="toggleExpand(g)"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <ChevronDown v-if="expandedIds.has(g.groupId)" class="h-3.5 w-3.5 text-slate-400" />
                  <ChevronRight v-else class="h-3.5 w-3.5 text-slate-400" />
                  <span class="text-xs font-mono text-slate-500">{{ fmtDate(g.date) }}</span>
                  <span class="text-sm font-medium text-slate-900">{{ g.description || '(tanpa keterangan)' }}</span>
                  <span class="text-xs text-slate-500">• {{ g.lines.length }} baris</span>
                </div>
                <div class="mt-1 flex items-center gap-2">
                  <span
                    v-if="groupsReady.get(g.groupId)?.ok"
                    class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
                  >
                    <CheckCircle2 class="h-3 w-3" /> Siap
                  </span>
                  <span
                    v-else
                    class="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700"
                  >
                    <AlertTriangle class="h-3 w-3" /> {{ groupsReady.get(g.groupId)?.reason }}
                  </span>
                  <span class="text-xs font-mono text-slate-500">
                    D <MoneyText :value="g.totalDebit" class="inline text-xs" /> • K <MoneyText :value="g.totalCredit" class="inline text-xs" />
                  </span>
                </div>
              </button>
            </div>

            <div v-if="expandedIds.has(g.groupId)" class="mt-3 ml-7 overflow-hidden rounded-lg border">
              <Table class="text-xs">
                <TableHeader class="bg-muted/50">
                  <TableRow class="hover:bg-transparent">
                    <TableHead class="w-10 px-2 text-[11px] uppercase tracking-wide text-muted-foreground">#</TableHead>
                    <TableHead class="px-2 text-[11px] uppercase tracking-wide text-muted-foreground">Akun (file)</TableHead>
                    <TableHead class="px-2 text-[11px] uppercase tracking-wide text-muted-foreground">→ COA</TableHead>
                    <TableHead class="w-24 px-2 text-right text-[11px] uppercase tracking-wide text-muted-foreground">Debit</TableHead>
                    <TableHead class="w-24 px-2 text-right text-[11px] uppercase tracking-wide text-muted-foreground">Kredit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow
                    v-for="(l, idx) in g.lines"
                    :key="idx"
                    :class="{ 'bg-rose-50/40 line-through text-muted-foreground': overrides[l.accountName] === SKIP }"
                  >
                    <TableCell class="px-2 py-1.5 text-center text-muted-foreground">{{ l.rowIndex }}</TableCell>
                    <TableCell class="px-2 py-1.5">
                      {{ l.accountName }}
                      <span v-if="l.subAccountName" class="text-muted-foreground">/ {{ l.subAccountName }}</span>
                    </TableCell>
                    <TableCell class="px-2 py-1.5">
                      <span v-if="l.matchedAccountId" class="font-mono">
                        {{ l.matchedAccountCode }}
                      </span>
                      <span v-else-if="overrides[l.accountName] === SKIP" class="text-rose-600">
                        ⊘ dilewati
                      </span>
                      <span v-else-if="overrides[l.accountName]" class="font-mono text-emerald-700">
                        {{ accountLabel(overrides[l.accountName]) }}
                      </span>
                      <span v-else class="text-amber-600">belum dipetakan</span>
                    </TableCell>
                    <TableCell class="px-2 py-1.5 text-right font-mono">
                      <MoneyText :value="Number(l.debit) > 0 ? l.debit : null" />
                    </TableCell>
                    <TableCell class="px-2 py-1.5 text-right font-mono">
                      <MoneyText :value="Number(l.credit) > 0 ? l.credit : null" />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </article>
        </div>
      </section>

      <!-- Commit form -->
      <section class="rounded-xl border border-rose-200 bg-rose-50/50 p-5">
        <h2 class="flex items-center gap-2 text-sm font-semibold text-rose-800">
          <Shield class="h-4 w-4" /> Konfirmasi impor
        </h2>
        <p class="mt-1 text-xs text-rose-700/80">
          {{ totals.ready }} grup siap diimpor sebagai transaksi <strong>posted</strong> (langsung
          membuat jurnal). Aksi ini melewati state machine. Setiap impor dicatat di approval log
          dengan alasan di bawah.
        </p>

        <FormField label="Alasan impor" required class="mt-3">
          <Textarea
            v-model="reason"
            rows="3"
            minlength="10"
            placeholder="Mis. Migrasi data dari Google Sheets buku jurnal Mei 2024 - April 2026"
          />
        </FormField>

        <div class="mt-3 flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" @click="resetAll">
            <RotateCcw class="h-4 w-4" /> Mulai ulang
          </Button>
          <Button :loading="committing" :disabled="!canCommit" @click="commit">
            <Send class="h-4 w-4" /> Impor {{ totals.ready }} transaksi
          </Button>
        </div>
        <p v-if="!canCommit && !committing" class="mt-2 text-right text-xs text-rose-700">
          <span v-if="reason.trim().length < 10">Alasan minimal 10 karakter. </span>
          <span v-if="totals.ready === 0">Pilih minimal 1 grup yang siap. </span>
          <span v-if="totals.blocked > 0">Hapus pilihan grup yang masih terblokir. </span>
        </p>
      </section>
    </template>

    <!-- ─── STAGE 3: COMMITTING ──────────────────────────────────────────── -->
    <section
      v-else-if="stage === 'committing'"
      class="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-600"
    >
      <Loader2 class="mx-auto h-8 w-8 animate-spin text-brand-600" />
      <p class="mt-3 font-medium text-slate-900">Mengimpor transaksi…</p>
      <p class="mt-1 text-xs text-slate-500">
        Setiap grup di-insert + posting jurnal secara berurutan. Mohon tidak menutup tab.
      </p>
    </section>

    <!-- ─── STAGE 4: RESULT ──────────────────────────────────────────────── -->
    <section
      v-else-if="stage === 'result' && commitResult"
      class="space-y-4"
    >
      <div class="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <CheckCircle2 class="mx-auto h-10 w-10 text-emerald-600" />
        <h2 class="mt-2 text-lg font-semibold text-emerald-900">Impor selesai</h2>
        <p class="mt-1 text-sm text-emerald-800">
          <strong>{{ commitResult.importedCount }}</strong> transaksi berhasil diposting
          <span v-if="commitResult.failedCount > 0">
            • <strong class="text-rose-700">{{ commitResult.failedCount }}</strong> gagal
          </span>
        </p>
      </div>

      <div
        v-if="commitResult.failures.length > 0"
        class="rounded-xl border border-rose-200 bg-white"
      >
        <header class="flex items-center gap-2 border-b border-rose-100 bg-rose-50 px-5 py-3 text-sm font-semibold text-rose-800">
          <XCircle class="h-4 w-4" /> Daftar kegagalan
        </header>
        <ul class="divide-y divide-slate-100 text-sm">
          <li v-for="f in commitResult.failures" :key="f.index" class="px-5 py-3">
            <p class="font-medium text-slate-900">{{ f.description }}</p>
            <p class="mt-0.5 text-xs text-rose-700">{{ f.error }}</p>
          </li>
        </ul>
      </div>

      <div class="flex justify-end gap-2">
        <Button variant="secondary" @click="resetAll">
          <Upload class="h-4 w-4" /> Impor file lain
        </Button>
        <Button @click="router.push('/transactions')">
          Lihat daftar transaksi
        </Button>
      </div>
    </section>
  </div>
</template>
