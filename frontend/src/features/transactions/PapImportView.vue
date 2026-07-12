<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileImage,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  ShieldAlert,
  Trash2,
  UploadCloud,
} from 'lucide-vue-next';
import { api, formatApiError } from '@/shared/api/client';
import { useAuthStore } from '@/features/auth/store';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import Button from '@/shared/ui/Button.vue';
import FormField from '@/shared/ui/FormField.vue';
import PageHeader from '@/shared/ui/PageHeader.vue';
import AppSelect from '@/shared/ui/AppSelect.vue';
import AppCheckbox from '@/shared/ui/AppCheckbox.vue';
import AccountSelect from '@/shared/ui/AccountSelect.vue';
import MoneyInput from '@/shared/ui/MoneyInput.vue';
import MoneyText from '@/shared/ui/MoneyText.vue';

type Direction = 'income' | 'expense';
type Stage = 'source' | 'review' | 'confirm' | 'result';
type SourceKind = 'images' | 'excel';

interface Fund { id: string; code: string; name: string; isActive?: boolean }
interface Account {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  accountType?: string;
  isActive?: boolean;
}
interface ReviewRow {
  id: string;
  date: string | null;
  description: string;
  referenceNo: string | null;
  direction: Direction | null;
  amount: string | null;
  writtenBalance: string | null;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
  source: { kind: 'excel' | 'ocr'; row: number; ref: string; fingerprint: string };
}
interface ParseResult {
  rows: ReviewRow[];
  totals: { income: string; expense: string; net: string; finalWrittenBalance: string | null };
  warnings: string[];
  source: { kind: string; fingerprint: string; sheetName?: string; [key: string]: unknown };
}
interface EditableRow extends Omit<ReviewRow, 'date' | 'referenceNo' | 'amount'> {
  date: string;
  referenceNo: string;
  amount: string;
  selected: boolean;
  acknowledged: boolean;
  expenseAccountId: string;
}
interface CommitResult {
  duplicate: boolean;
  importedCount: number;
  transactions: Array<{ id: string; transactionNo: string }>;
  fundId: string;
}
interface ImageFile { file: File; url: string }

const MB = 1024 * 1024;
const router = useRouter();
const auth = useAuthStore();
const stage = ref<Stage>('source');
const sourceKind = ref<SourceKind>('images');
const images = ref<ImageFile[]>([]);
const excelFile = ref<File | null>(null);
const sheetName = ref('');
const parsing = ref(false);
const committing = ref(false);
const loadingMappings = ref(false);
const error = ref<string | null>(null);
const sourceWarnings = ref<string[]>([]);
const sourceTotals = ref<ParseResult['totals'] | null>(null);
const sourceFingerprint = ref('');
const rows = ref<EditableRow[]>([]);
const reason = ref('');
const result = ref<CommitResult | null>(null);
const mapping = reactive({ fundId: '', cashAccountId: '', incomeAccountId: '', defaultExpenseAccountId: '' });
const funds = ref<Fund[]>([]);
const accounts = ref<Account[]>([]);

const allowed = computed(
  () => auth.isSuperAdmin || (auth.hasPermission('transactions.create') && auth.hasPermission('transactions.post')),
);
const activeFunds = computed(() => funds.value.filter((item) => item.isActive !== false));
const fundOptions = computed(() => activeFunds.value.map((item) => ({ value: item.id, label: `${item.code} — ${item.name}` })));
const hasAccountTypes = computed(() => accounts.value.some((item) => Boolean(item.accountType)));
const cashAccounts = computed(() => filterAccounts('asset'));
const incomeAccounts = computed(() => filterAccounts('income'));
const expenseAccounts = computed(() => filterAccounts('expense'));
const sourceReady = computed(() => sourceKind.value === 'images' ? images.value.length > 0 : excelFile.value !== null);
const mappingsReady = computed(() => Object.values(mapping).every(Boolean));

function rowValid(row: EditableRow): boolean {
  return Boolean(row.date && row.direction && row.description.trim() && Number(row.amount) > 0);
}
const selectedRows = computed(() => rows.value.filter((row) => row.selected));
const invalidSelected = computed(() => selectedRows.value.filter((row) => !rowValid(row)).length);
const isLowConfidence = (confidence: ReviewRow['confidence']) => confidence === 'low';
const unacknowledged = computed(() => selectedRows.value.filter((row) => isLowConfidence(row.confidence) && !row.acknowledged).length);
const reviewTotals = computed(() => selectedRows.value.reduce(
  (totals, row) => {
    const amount = Number(row.amount) || 0;
    if (row.direction === 'income') totals.income += amount;
    if (row.direction === 'expense') totals.expense += amount;
    totals.net = totals.income - totals.expense;
    return totals;
  },
  { income: 0, expense: 0, net: 0 },
));
const canReview = computed(() => selectedRows.value.length > 0 && invalidSelected.value === 0 && unacknowledged.value === 0);
const canCommit = computed(() => canReview.value && reason.value.trim().length >= 10 && !committing.value);
const selectedFund = computed(() => activeFunds.value.find((item) => item.id === mapping.fundId));
const selectedMappingLabels = computed(() => ({
  fund: selectedFund.value ? `${selectedFund.value.code} — ${selectedFund.value.name}` : '—',
  cash: accountLabel(mapping.cashAccountId),
  income: accountLabel(mapping.incomeAccountId),
  expense: accountLabel(mapping.defaultExpenseAccountId),
}));

function filterAccounts(type: string): Account[] {
  const active = accounts.value.filter((item) => item.isActive !== false);
  const typed = active.filter((item) => item.accountType === type);
  return typed.length > 0 ? typed : active;
}
function accountLabel(id: string): string {
  const account = accounts.value.find((item) => item.id === id);
  return account ? `${account.code} — ${account.name}` : '—';
}
function displayError(err: unknown): string { return formatApiError(err, 'Impor PAP gagal diproses.'); }
function confidenceLabel(value: ReviewRow['confidence']): string {
  return value === 'high' ? 'Tinggi' : value === 'medium' ? 'Sedang' : 'Rendah';
}
function fileSize(size: number): string { return size >= MB ? `${(size / MB).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`; }
function sourceRef(row: EditableRow): string { return row.source.ref || `Baris ${row.source.row}`; }

async function loadMappings(): Promise<void> {
  loadingMappings.value = true;
  try {
    const [fundRes, accountRes] = await Promise.all([
      api.get<{ data: Fund[] }>('/api/v1/funds'),
      api.get<{ data: Account[] }>('/api/v1/accounts', { query: { lite: 1 } }),
    ]);
    funds.value = fundRes.data;
    accounts.value = accountRes.data;
  } catch (err) {
    error.value = displayError(err);
  } finally {
    loadingMappings.value = false;
  }
}

function onImagesChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const picked = Array.from(input.files ?? []);
  input.value = '';
  if (!picked.length) return;
  const permitted = picked.filter((file) => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type));
  if (permitted.length !== picked.length) return void (error.value = 'Gunakan gambar JPEG, PNG, atau WebP.');
  if (permitted.some((file) => file.size > 8 * MB)) return void (error.value = 'Setiap gambar maksimal 8 MB.');
  const combined = [...images.value.map((item) => item.file), ...permitted];
  if (combined.length > 5) return void (error.value = 'Maksimal 5 gambar dalam satu impor.');
  if (combined.reduce((sum, file) => sum + file.size, 0) > 20 * MB) return void (error.value = 'Total gambar maksimal 20 MB.');
  error.value = null;
  images.value.push(...permitted.map((file) => ({ file, url: URL.createObjectURL(file) })));
}
function removeImage(index: number): void {
  const [removed] = images.value.splice(index, 1);
  if (removed) URL.revokeObjectURL(removed.url);
}
function moveImage(index: number, offset: number): void {
  const target = index + offset;
  if (target < 0 || target >= images.value.length) return;
  const next = [...images.value];
  [next[index], next[target]] = [next[target]!, next[index]!];
  images.value = next;
}
function onExcelChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  input.value = '';
  if (!file) return;
  if (!/\.(xlsx|xlsm)$/i.test(file.name)) return void (error.value = 'Gunakan file Excel .xlsx atau .xlsm.');
  if (file.size > 20 * MB) return void (error.value = 'File Excel maksimal 20 MB.');
  error.value = null;
  excelFile.value = file;
}

async function parseSource(): Promise<void> {
  if (!sourceReady.value || !mappingsReady.value) return;
  parsing.value = true;
  error.value = null;
  try {
    const form = new FormData();
    let response: { data: ParseResult };
    if (sourceKind.value === 'images') {
      images.value.forEach((item) => form.append('files', item.file));
      response = await api.post<{ data: ParseResult }>('/api/v1/transactions/_import/pap/parse-images', form, { timeoutMs: 120_000 });
    } else {
      form.append('file', excelFile.value!);
      if (sheetName.value.trim()) form.append('sheet', sheetName.value.trim());
      response = await api.post<{ data: ParseResult }>('/api/v1/transactions/_import/pap/parse-excel', form, { timeoutMs: 60_000 });
    }
    const data = response.data;
    rows.value = data.rows.map((row) => ({
      ...row,
      date: row.date ?? '',
      referenceNo: row.referenceNo ?? '',
      amount: row.amount ?? '',
      selected: Boolean(row.date && row.direction && row.description.trim() && Number(row.amount) > 0),
      acknowledged: !isLowConfidence(row.confidence),
      expenseAccountId: '',
    }));
    sourceWarnings.value = data.warnings ?? [];
    sourceTotals.value = data.totals;
    sourceFingerprint.value = data.source.fingerprint;
    stage.value = 'review';
  } catch (err) {
    error.value = displayError(err);
  } finally {
    parsing.value = false;
  }
}

function selectValid(): void { rows.value.forEach((row) => { row.selected = rowValid(row); }); }
function goToConfirmation(): void {
  if (!canReview.value) return;
  stage.value = 'confirm';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function commit(): Promise<void> {
  if (!canCommit.value) return;
  committing.value = true;
  error.value = null;
  try {
    const response = await api.post<{ data: CommitResult }>('/api/v1/transactions/_import/pap/commit', {
      reason: reason.value.trim(),
      sourceFingerprint: sourceFingerprint.value,
      sourceType: sourceKind.value === 'images' ? 'ocr' : 'excel',
      fundId: mapping.fundId,
      cashAccountId: mapping.cashAccountId,
      incomeAccountId: mapping.incomeAccountId,
      expenseAccountId: mapping.defaultExpenseAccountId,
      rows: selectedRows.value.map((row) => ({
        id: row.id,
        date: row.date,
        direction: row.direction,
        description: row.description.trim(),
        amount: row.amount,
        referenceNo: row.referenceNo || null,
        ...(row.direction === 'expense' && row.expenseAccountId ? { expenseAccountId: row.expenseAccountId } : {}),
      })),
    }, { timeoutMs: 60_000 });
    result.value = response.data;
    stage.value = 'result';
  } catch (err) {
    error.value = displayError(err);
  } finally {
    committing.value = false;
  }
}
function resetAll(): void {
  images.value.forEach((item) => URL.revokeObjectURL(item.url));
  images.value = [];
  excelFile.value = null;
  rows.value = [];
  sourceWarnings.value = [];
  sourceTotals.value = null;
  sourceFingerprint.value = '';
  reason.value = '';
  result.value = null;
  error.value = null;
  stage.value = 'source';
}

onMounted(() => { if (allowed.value) void loadMappings(); });
onBeforeUnmount(() => images.value.forEach((item) => URL.revokeObjectURL(item.url)));
</script>

<template>
  <div v-if="!allowed" class="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
    <div class="flex items-center gap-2 font-semibold"><ShieldAlert class="size-4" /> Akses ditolak</div>
    <p class="mt-2">Impor PAP memerlukan izin membuat dan mem-posting transaksi.</p>
  </div>

  <div v-else class="space-y-5">
    <button type="button" class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" @click="router.push('/transactions')">
      <ArrowLeft class="size-3.5" /> Kembali ke transaksi
    </button>
    <PageHeader
      title="Impor Rekapan PAP"
      description="Ubah rekapan kas dari foto atau Excel menjadi transaksi terposting, dengan pemeriksaan manusia sebelum posting."
      :crumbs="[{ label: 'Dashboard', to: '/' }, { label: 'Transaksi', to: '/transactions' }, { label: 'Impor Rekapan PAP' }]"
    />

    <ol class="grid grid-cols-4 gap-2" aria-label="Tahapan impor">
      <li v-for="(item, index) in ['Sumber & akun', 'Periksa data', 'Konfirmasi', 'Selesai']" :key="item" class="min-w-0">
        <div class="h-1 rounded-full" :class="index <= ['source','review','confirm','result'].indexOf(stage) ? 'bg-emerald-700' : 'bg-border'" />
        <p class="mt-1 truncate text-[11px] font-medium" :class="index <= ['source','review','confirm','result'].indexOf(stage) ? 'text-emerald-800' : 'text-muted-foreground'">{{ index + 1 }}. {{ item }}</p>
      </li>
    </ol>

    <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

    <template v-if="stage === 'source'">
      <div class="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
        <Card><CardContent class="p-5 sm:p-6">
          <div class="mb-5"><h2 class="font-semibold">1. Pilih sumber rekapan</h2><p class="mt-1 text-sm text-muted-foreground">Urutan gambar menentukan urutan halaman yang dibaca.</p></div>
          <div class="mb-5 grid grid-cols-2 rounded-xl bg-muted p-1">
            <button type="button" class="rounded-lg px-4 py-2.5 text-sm font-medium transition" :class="sourceKind === 'images' ? 'bg-background shadow-sm' : 'text-muted-foreground'" @click="sourceKind = 'images'">
              <FileImage class="mr-2 inline size-4" />Foto / scan
            </button>
            <button type="button" class="rounded-lg px-4 py-2.5 text-sm font-medium transition" :class="sourceKind === 'excel' ? 'bg-background shadow-sm' : 'text-muted-foreground'" @click="sourceKind = 'excel'">
              <FileSpreadsheet class="mr-2 inline size-4" />Excel
            </button>
          </div>

          <div v-if="sourceKind === 'images'" class="space-y-4">
            <label class="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-emerald-700/30 bg-emerald-50/40 px-6 py-9 text-center transition hover:border-emerald-700/60 hover:bg-emerald-50">
              <UploadCloud class="mb-3 size-8 text-emerald-700" /><span class="text-sm font-semibold">Pilih 1–5 gambar rekapan</span><span class="mt-1 text-xs text-muted-foreground">JPEG, PNG, WebP · 8 MB/file · total 20 MB</span>
              <input class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple @change="onImagesChange" />
            </label>
            <div v-if="images.length" class="grid gap-3 sm:grid-cols-2">
              <div v-for="(item, index) in images" :key="item.url" class="flex items-center gap-3 rounded-xl border bg-card p-2.5">
                <img :src="item.url" :alt="`Pratinjau halaman ${index + 1}`" class="size-16 rounded-lg border object-cover" />
                <div class="min-w-0 flex-1"><p class="truncate text-sm font-medium">{{ index + 1 }}. {{ item.file.name }}</p><p class="text-xs text-muted-foreground">{{ fileSize(item.file.size) }}</p>
                  <div class="mt-2 flex gap-1"><Button size="icon" variant="ghost" class="size-7" :disabled="index === 0" aria-label="Pindah ke depan" @click="moveImage(index, -1)"><ArrowLeft class="size-3.5" /></Button><Button size="icon" variant="ghost" class="size-7" :disabled="index === images.length - 1" aria-label="Pindah ke belakang" @click="moveImage(index, 1)"><ArrowRight class="size-3.5" /></Button><Button size="icon" variant="ghost" class="size-7 text-destructive" aria-label="Hapus gambar" @click="removeImage(index)"><Trash2 class="size-3.5" /></Button></div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="space-y-4">
            <label class="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-emerald-700/30 bg-emerald-50/40 px-6 py-9 text-center transition hover:border-emerald-700/60 hover:bg-emerald-50">
              <FileSpreadsheet class="mb-3 size-8 text-emerald-700" /><span class="text-sm font-semibold">{{ excelFile?.name ?? 'Pilih file Excel' }}</span><span class="mt-1 text-xs text-muted-foreground">.xlsx atau .xlsm · maksimal 20 MB</span>
              <input class="sr-only" type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change="onExcelChange" />
            </label>
            <FormField label="Nama sheet (opsional)" hint="Kosongkan untuk memakai sheet pertama"><Input v-model="sheetName" placeholder="Contoh: Rekapan PAP" /></FormField>
          </div>
        </CardContent></Card>

        <Card><CardContent class="space-y-4 p-5 sm:p-6">
          <div><h2 class="font-semibold">2. Tentukan dana & akun</h2><p class="mt-1 text-sm text-muted-foreground">Satu file memakai satu dana. Akun pengeluaran dapat diubah per baris nanti.</p></div>
          <div v-if="loadingMappings" class="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 class="size-4 animate-spin" /> Memuat dana dan akun…</div>
          <template v-else>
            <FormField label="Dana" required><AppSelect v-model="mapping.fundId" :options="fundOptions" placeholder="Pilih dana untuk seluruh file" /></FormField>
            <FormField label="Akun kas / bank" required><AccountSelect v-model="mapping.cashAccountId" :accounts="cashAccounts" :filter-type="hasAccountTypes ? 'asset' : undefined" placeholder="Pilih akun aset kas" /></FormField>
            <FormField label="Akun pemasukan" required><AccountSelect v-model="mapping.incomeAccountId" :accounts="incomeAccounts" :filter-type="hasAccountTypes ? 'income' : undefined" placeholder="Pilih akun pendapatan" /></FormField>
            <FormField label="Akun pengeluaran default" required><AccountSelect v-model="mapping.defaultExpenseAccountId" :accounts="expenseAccounts" :filter-type="hasAccountTypes ? 'expense' : undefined" placeholder="Pilih akun beban" /></FormField>
            <Alert v-if="accounts.length && !hasAccountTypes" class="border-amber-300 bg-amber-50 text-amber-900"><AlertTriangle class="size-4" /><AlertDescription>Respons akun lite tidak memuat jenis akun. Semua akun ditampilkan; pastikan pemetaan aset, pemasukan, dan pengeluaran sudah benar.</AlertDescription></Alert>
          </template>
          <Button class="mt-2 w-full" :disabled="!sourceReady || !mappingsReady || parsing" @click="parseSource">
            <Loader2 v-if="parsing" class="size-4 animate-spin" /><UploadCloud v-else class="size-4" />{{ parsing ? 'Membaca rekapan…' : 'Baca & periksa rekapan' }}
          </Button>
          <p v-if="sourceKind === 'images'" class="text-center text-[11px] text-muted-foreground">Pemrosesan gambar dapat memerlukan waktu hingga 2 menit.</p>
        </CardContent></Card>
      </div>
    </template>

    <template v-else-if="stage === 'review'">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div><h2 class="text-lg font-semibold">Periksa hasil pembacaan</h2><p class="text-sm text-muted-foreground">Baris tidak valid otomatis tidak dipilih. Semua nilai masih dapat diperbaiki.</p></div>
        <div class="flex gap-2"><Button variant="outline" @click="stage = 'source'"><ArrowLeft class="size-4" /> Sumber</Button><Button variant="outline" @click="selectValid">Pilih yang valid</Button></div>
      </div>
      <Alert v-if="sourceWarnings.length" class="border-amber-300 bg-amber-50 text-amber-900"><AlertTriangle class="size-4" /><AlertDescription><strong>{{ sourceWarnings.length }} peringatan sumber.</strong> {{ sourceWarnings.slice(0, 3).join(' · ') }}<span v-if="sourceWarnings.length > 3"> · dan {{ sourceWarnings.length - 3 }} lainnya</span></AlertDescription></Alert>
      <div class="grid gap-3 sm:grid-cols-4">
        <Card><CardContent class="p-4"><p class="text-xs text-muted-foreground">Dipilih</p><p class="mt-1 text-xl font-semibold">{{ selectedRows.length }} <span class="text-xs font-normal">dari {{ rows.length }}</span></p></CardContent></Card>
        <Card><CardContent class="p-4"><p class="text-xs text-muted-foreground">Pemasukan terpilih</p><MoneyText :value="reviewTotals.income" class="mt-1 block text-base font-semibold text-emerald-700" /></CardContent></Card>
        <Card><CardContent class="p-4"><p class="text-xs text-muted-foreground">Pengeluaran terpilih</p><MoneyText :value="reviewTotals.expense" class="mt-1 block text-base font-semibold text-amber-700" /></CardContent></Card>
        <Card><CardContent class="p-4"><p class="text-xs text-muted-foreground">Saldo akhir tertulis</p><MoneyText :value="sourceTotals?.finalWrittenBalance ?? 0" class="mt-1 block text-base font-semibold" /></CardContent></Card>
      </div>

      <div class="overflow-x-auto rounded-xl border bg-card">
        <table class="w-full min-w-[1500px] text-sm">
          <thead class="bg-muted/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th class="p-3">Pakai</th><th class="p-3">Sumber</th><th class="p-3">Tanggal</th><th class="p-3">Arah</th><th class="p-3">Uraian</th><th class="p-3">Nominal</th><th class="p-3">Referensi</th><th class="p-3">Saldo tertulis</th><th class="p-3">Akun beban khusus</th><th class="p-3">Keyakinan</th></tr></thead>
          <tbody class="divide-y">
            <tr v-for="row in rows" :key="row.id" :class="[!row.selected && 'opacity-55', isLowConfidence(row.confidence) && row.selected && 'bg-amber-50/50']">
              <td class="p-3 align-top"><AppCheckbox v-model="row.selected" :id="`select-${row.id}`" /></td>
              <td class="max-w-32 p-3 align-top text-xs text-muted-foreground"><span :title="row.source.ref">{{ sourceRef(row) }}</span></td>
              <td class="p-3 align-top"><Input v-model="row.date" type="date" class="w-36" :aria-invalid="row.selected && !row.date" /></td>
              <td class="p-3 align-top"><AppSelect v-model="row.direction" :options="[{ value: 'income', label: 'Masuk' }, { value: 'expense', label: 'Keluar' }]" class="w-28" /></td>
              <td class="p-3 align-top"><Input v-model="row.description" class="min-w-56" :aria-invalid="row.selected && !row.description.trim()" /></td>
              <td class="p-3 align-top"><MoneyInput v-model="row.amount" class="w-40" :allow-zero="false" /></td>
              <td class="p-3 align-top"><Input v-model="row.referenceNo" class="w-32" placeholder="—" /></td>
              <td class="p-3 align-top text-right font-mono"><MoneyText v-if="row.writtenBalance !== null" :value="row.writtenBalance" /><span v-else>—</span></td>
              <td class="p-3 align-top"><AccountSelect v-if="row.direction === 'expense'" v-model="row.expenseAccountId" :accounts="expenseAccounts" :filter-type="hasAccountTypes ? 'expense' : undefined" class="w-64" placeholder="Gunakan akun default" /><span v-else class="text-muted-foreground">—</span></td>
              <td class="p-3 align-top"><Badge :variant="isLowConfidence(row.confidence) ? 'destructive' : 'secondary'">{{ confidenceLabel(row.confidence) }}</Badge><ul v-if="row.warnings.length" class="mt-2 max-w-64 list-disc space-y-1 pl-4 text-xs text-amber-800"><li v-for="warning in row.warnings" :key="warning">{{ warning }}</li></ul><AppCheckbox v-if="row.selected && isLowConfidence(row.confidence)" v-model="row.acknowledged" :id="`ack-${row.id}`" label="Sudah saya periksa" class="mt-3" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur">
        <div class="text-sm"><span class="font-semibold">{{ selectedRows.length }} transaksi</span><span v-if="invalidSelected" class="ml-3 text-destructive">{{ invalidSelected }} belum valid</span><span v-if="unacknowledged" class="ml-3 text-amber-700">{{ unacknowledged }} keyakinan rendah belum diakui</span></div>
        <Button :disabled="!canReview" @click="goToConfirmation">Lanjut ke konfirmasi <ArrowRight class="size-4" /></Button>
      </div>
    </template>

    <template v-else-if="stage === 'confirm'">
      <div class="mx-auto max-w-4xl space-y-5">
        <Card><CardContent class="space-y-5 p-6 sm:p-8">
          <div><p class="text-xs font-semibold uppercase tracking-widest text-emerald-700">Siap diposting</p><h2 class="mt-1 text-2xl font-semibold">Konfirmasi {{ selectedRows.length }} transaksi</h2><p class="mt-1 text-sm text-muted-foreground">Periksa ringkasan terakhir. Backend tetap menjadi sumber kebenaran untuk validasi dan total akhir.</p></div>
          <div class="grid gap-3 sm:grid-cols-3"><div class="rounded-xl bg-emerald-50 p-4"><p class="text-xs text-emerald-800">Pemasukan</p><MoneyText :value="reviewTotals.income" class="mt-1 block text-lg font-semibold text-emerald-800" /></div><div class="rounded-xl bg-amber-50 p-4"><p class="text-xs text-amber-800">Pengeluaran</p><MoneyText :value="reviewTotals.expense" class="mt-1 block text-lg font-semibold text-amber-800" /></div><div class="rounded-xl bg-muted p-4"><p class="text-xs text-muted-foreground">Selisih</p><MoneyText :value="reviewTotals.net" class="mt-1 block text-lg font-semibold" /></div></div>
          <dl class="grid gap-x-8 gap-y-4 border-y py-5 text-sm sm:grid-cols-2"><div><dt class="text-xs text-muted-foreground">Dana seluruh file</dt><dd class="mt-1 font-medium">{{ selectedMappingLabels.fund }}</dd></div><div><dt class="text-xs text-muted-foreground">Kas / bank</dt><dd class="mt-1 font-medium">{{ selectedMappingLabels.cash }}</dd></div><div><dt class="text-xs text-muted-foreground">Akun pemasukan</dt><dd class="mt-1 font-medium">{{ selectedMappingLabels.income }}</dd></div><div><dt class="text-xs text-muted-foreground">Beban default</dt><dd class="mt-1 font-medium">{{ selectedMappingLabels.expense }}</dd></div></dl>
          <Alert class="border-rose-300 bg-rose-50 text-rose-900"><ShieldAlert class="size-4" /><AlertDescription><strong>Posting langsung.</strong> Transaksi yang dikonfirmasi langsung berstatus posted dan menghasilkan jurnal. Koreksi setelah posting harus mengikuti prosedur pembatalan.</AlertDescription></Alert>
          <FormField label="Alasan impor untuk jejak audit" required :hint="`${reason.trim().length}/10 karakter minimum`"><Textarea v-model="reason" rows="3" placeholder="Contoh: Migrasi rekapan PAP periode Januari 2026" /></FormField>
          <div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between"><Button variant="outline" :disabled="committing" @click="stage = 'review'"><ArrowLeft class="size-4" /> Kembali periksa</Button><Button variant="danger" :disabled="!canCommit" @click="commit"><Loader2 v-if="committing" class="size-4 animate-spin" /><CheckCircle2 v-else class="size-4" />{{ committing ? 'Memposting…' : 'Konfirmasi & Posting' }}</Button></div>
        </CardContent></Card>
      </div>
    </template>

    <template v-else-if="stage === 'result' && result">
      <Card class="mx-auto max-w-3xl overflow-hidden"><div class="h-2" :class="result.duplicate ? 'bg-amber-500' : 'bg-emerald-700'" /><CardContent class="p-7 text-center sm:p-10"><div class="mx-auto flex size-14 items-center justify-center rounded-full" :class="result.duplicate ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'"><AlertTriangle v-if="result.duplicate" class="size-7" /><CheckCircle2 v-else class="size-7" /></div><h2 class="mt-4 text-2xl font-semibold">{{ result.duplicate ? 'Rekapan sudah pernah diimpor' : 'Rekapan berhasil diposting' }}</h2><p class="mt-2 text-sm text-muted-foreground">{{ result.duplicate ? 'Fingerprint sumber dikenali. Tidak ada transaksi ganda yang dibuat.' : `${result.importedCount} transaksi berhasil dibuat dan diposting.` }}</p>
        <div v-if="result.transactions?.length" class="mx-auto mt-6 max-w-md rounded-xl border bg-muted/30 p-4 text-left"><p class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nomor transaksi</p><div class="flex flex-wrap gap-2"><Badge v-for="transaction in result.transactions" :key="transaction.id" variant="secondary">{{ transaction.transactionNo }}</Badge></div></div>
        <div class="mt-7 flex flex-col justify-center gap-3 sm:flex-row"><Button as-child><RouterLink to="/transactions">Lihat transaksi <ArrowRight class="size-4" /></RouterLink></Button><Button variant="outline" as-child><RouterLink :to="{ path: '/reports', query: { fundId: result.fundId || mapping.fundId } }">Lihat laporan dana</RouterLink></Button><Button variant="ghost" @click="resetAll"><RotateCcw class="size-4" /> Impor lagi</Button></div></CardContent></Card>
    </template>
  </div>
</template>
