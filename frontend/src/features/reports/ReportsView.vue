<script setup lang="ts">
/**
 * Laporan Keuangan — periode picker + render salah satu dari 9 laporan.
 *
 * Periode default = bulan berjalan. Tipe laporan via dropdown. Tabel di-render
 * generik: ambil shape dari response, mapping ke tabel HTML. Export PDF/XLSX
 * = trigger window.open ke URL backend dgn query yang sama.
 *
 * Catatan warna: MoneyText mewarnai otomatis berdasar tanda (+/-). Itu cuma
 * benar untuk angka yang MEMANG bermakna surplus/defisit (aset neto, surplus
 * aktivitas, perubahan kas, surplus dana). Untuk saldo akun biasa (Posisi
 * Keuangan, Neraca Saldo, Buku Besar, Jurnal Umum) tanda minus hanyalah arah
 * saldo — bukan "masalah" — sehingga warnanya di-override netral di sana.
 */
import { computed, onActivated, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  AlertTriangle,
  Download,
  FileBarChart2,
  Landmark,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-vue-next';
import { api, getTenantSlug } from '@/shared/api/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table } from '@/components/ui/table';
import Button from '@/shared/ui/Button.vue';
import DatePicker from '@/shared/ui/DatePicker.vue';
import PageHeader from '@/shared/ui/PageHeader.vue';
import AppSelect from '@/shared/ui/AppSelect.vue';
import MoneyText from '@/shared/ui/MoneyText.vue';

type ReportType =
  | 'posisi-keuangan'
  | 'aktivitas'
  | 'perubahan-aset-neto'
  | 'arus-kas'
  | 'general-ledger'
  | 'trial-balance'
  | 'jurnal-umum'
  | 'sumber-penggunaan-dana'
  | 'buku-dana'
  | 'konsolidasi-dana';

const REPORTS: { value: ReportType; label: string }[] = [
  { value: 'posisi-keuangan', label: 'Posisi Keuangan' },
  { value: 'aktivitas', label: 'Aktivitas' },
  { value: 'perubahan-aset-neto', label: 'Perubahan Aset Neto' },
  { value: 'arus-kas', label: 'Arus Kas' },
  { value: 'sumber-penggunaan-dana', label: 'Sumber & Penggunaan Dana' },
  { value: 'buku-dana', label: 'Buku Dana (detail 1 dana)' },
  { value: 'konsolidasi-dana', label: 'Konsolidasi Dana (Multi-Cabang)' },
  { value: 'general-ledger', label: 'Buku Besar' },
  { value: 'trial-balance', label: 'Neraca Saldo' },
  { value: 'jurnal-umum', label: 'Jurnal Umum' },
];

const reportOptions = REPORTS.map((r) => ({ value: r.value, label: r.label }));

const periodModeOptions = [
  { value: 'monthly', label: 'Per Bulan' },
  { value: 'custom', label: 'Custom' },
];

const route = useRoute();
const router = useRouter();
const now = new Date();
const reportType = ref<ReportType>('posisi-keuangan');
const month = ref(now.getMonth() + 1);
const year = ref(now.getFullYear());
const periodMode = ref<'monthly' | 'custom'>('monthly');
const dateFrom = ref<string | null>(null);
const dateTo = ref<string | null>(null);
const fundId = ref<string>('');
const fundOptions = ref<{ value: string; label: string }[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const data = ref<any>(null);
const periodLabel = ref<string>('');
/** Hindari double-load saat apply query + watch. */
const suppressWatchLoad = ref(false);

const REPORT_TYPE_SET = new Set(REPORTS.map((r) => r.value));

function qStr(key: string): string | undefined {
  const v = route.query[key];
  if (Array.isArray(v)) return v[0] || undefined;
  return typeof v === 'string' && v.length ? v : undefined;
}

/** Deep-link dari dashboard (kartu dana) / bookmark: ?type=&fundId=&month=&year= */
function applyRouteQuery(): boolean {
  let changed = false;
  const typeQ = qStr('type');
  if (typeQ && REPORT_TYPE_SET.has(typeQ as ReportType) && reportType.value !== typeQ) {
    reportType.value = typeQ as ReportType;
    changed = true;
  }
  const mQ = qStr('month');
  if (mQ) {
    const m = Number(mQ);
    if (m >= 1 && m <= 12 && month.value !== m) {
      month.value = m;
      changed = true;
    }
  }
  const yQ = qStr('year');
  if (yQ) {
    const y = Number(yQ);
    if (y >= 2000 && y <= 2100 && year.value !== y) {
      year.value = y;
      changed = true;
    }
  }
  const fQ = qStr('fundId');
  if (fQ && fundId.value !== fQ) {
    fundId.value = fQ;
    changed = true;
  }
  return changed;
}

async function loadFunds(): Promise<void> {
  try {
    const res = await api.get<{ data: Array<{ id: string; code: string; name: string }> }>(
      '/api/v1/funds',
    );
    fundOptions.value = res.data.map((f) => ({
      value: f.id,
      label: `${f.code} — ${f.name}`,
    }));
    // Prefer query fundId; else keep current; else first fund
    const fromQuery = qStr('fundId');
    if (fromQuery && fundOptions.value.some((o) => o.value === fromQuery)) {
      fundId.value = fromQuery;
    } else if (!fundId.value && fundOptions.value[0]) {
      fundId.value = fundOptions.value[0].value;
    }
  } catch {
    fundOptions.value = [];
  }
}

async function load(): Promise<void> {
  if (reportType.value === 'buku-dana' && !fundId.value) {
    data.value = null;
    error.value = 'Pilih dana terlebih dahulu untuk Buku Dana';
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    const query: Record<string, string | number | undefined> =
      periodMode.value === 'custom'
        ? { startDate: dateFrom.value || undefined, endDate: dateTo.value || undefined }
        : { month: month.value, year: year.value };
    if (reportType.value === 'buku-dana') {
      query.fundId = fundId.value;
    }
    const path =
      reportType.value === 'konsolidasi-dana'
        ? '/api/v1/reports/konsolidasi/sumber-penggunaan-dana'
        : `/api/v1/reports/${reportType.value}`;
    const res = await api.get<any>(path, { query });
    data.value = res.data;
    periodLabel.value = res.period?.label ?? `${month.value}/${year.value}`;
  } catch (err) {
    const e = err as { body?: { error?: string; detail?: string } };
    error.value = e.body?.detail ?? e.body?.error ?? (err as Error).message;
    data.value = null;
  } finally {
    loading.value = false;
  }
}

function downloadUrl(format: 'pdf' | 'xlsx'): string {
  const tenant = getTenantSlug();
  const params = new URLSearchParams({ format });
  if (periodMode.value === 'custom') {
    if (dateFrom.value) params.set('startDate', dateFrom.value);
    if (dateTo.value) params.set('endDate', dateTo.value);
  } else {
    params.set('month', String(month.value));
    params.set('year', String(year.value));
  }
  if (reportType.value === 'buku-dana' && fundId.value) {
    params.set('fundId', fundId.value);
  }
  if (tenant) params.set('tenant_slug', tenant);
  const path =
    reportType.value === 'konsolidasi-dana'
      ? 'konsolidasi/sumber-penggunaan-dana'
      : reportType.value;
  return `/api/v1/reports/${path}?${params.toString()}`;
}

const monthOptions = computed(() =>
  Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: new Date(2000, i, 1).toLocaleDateString('id-ID', { month: 'long' }),
  })),
);

const yearOptions = computed(() => {
  const y = now.getFullYear();
  return Array.from({ length: 6 }, (_, i) => ({
    value: String(y - i),
    label: String(y - i),
  }));
});

const monthStr = computed({
  get: () => String(month.value),
  set: (v: string) => { month.value = Number(v); },
});

const yearStr = computed({
  get: () => String(year.value),
  set: (v: string) => { year.value = Number(v); },
});

// ─── Data-integrity glances — murni tampilan, tidak mengubah angka apa pun.
// Toleransi 0.5 (setengah rupiah) untuk meredam noise pembulatan string.
const balanceSheetDiff = computed(() => {
  if (reportType.value !== 'posisi-keuangan' || !data.value) return 0;
  return Math.abs(Number(data.value.assets?.total ?? 0) - Number(data.value.totalLiabilitiesAndNetAssets ?? 0));
});

const trialBalanceDiff = computed(() => {
  if (reportType.value !== 'trial-balance' || !data.value) return 0;
  return Math.abs(Number(data.value.totalDebit ?? 0) - Number(data.value.totalCredit ?? 0));
});

watch([reportType, month, year, periodMode, dateFrom, dateTo, fundId], () => {
  if (suppressWatchLoad.value) return;
  data.value = null;
  void load();
  // Sinkronkan URL supaya shareable / back-button ramah
  const nextQuery: Record<string, string> = {
    type: reportType.value,
    month: String(month.value),
    year: String(year.value),
  };
  if (reportType.value === 'buku-dana' && fundId.value) {
    nextQuery.fundId = fundId.value;
  }
  const cur = route.query;
  const same =
    cur.type === nextQuery.type &&
    cur.month === nextQuery.month &&
    cur.year === nextQuery.year &&
    (nextQuery.fundId ? cur.fundId === nextQuery.fundId : !cur.fundId);
  if (!same) {
    void router.replace({ query: nextQuery });
  }
});

async function bootReports(): Promise<void> {
  suppressWatchLoad.value = true;
  try {
    applyRouteQuery();
    await loadFunds();
    applyRouteQuery();
  } finally {
    suppressWatchLoad.value = false;
  }
  await load();
}

onMounted(() => {
  void bootReports();
});

// KeepAlive: masuk lagi dari dashboard dengan query baru
onActivated(() => {
  const changed = applyRouteQuery();
  if (changed || !data.value) {
    void load();
  }
});

watch(
  () => [route.query.type, route.query.fundId, route.query.month, route.query.year],
  () => {
    if (suppressWatchLoad.value) return;
    const changed = applyRouteQuery();
    if (changed) void load();
  },
);
</script>

<template>
  <div class="space-y-4">
    <PageHeader
      title="Laporan Keuangan"
      :description="`Periode: ${periodLabel || `${month}/${year}`}`"
      :crumbs="[{ label: 'Dashboard', to: '/' }, { label: 'Keuangan' }, { label: 'Laporan' }]"
    >
      <template #actions>
        <a :href="downloadUrl('pdf')" target="_blank" rel="noopener">
          <Button variant="secondary" size="sm"><Download class="h-3.5 w-3.5" /> PDF</Button>
        </a>
        <a :href="downloadUrl('xlsx')" target="_blank" rel="noopener">
          <Button variant="secondary" size="sm"><Download class="h-3.5 w-3.5" /> XLSX</Button>
        </a>
      </template>
    </PageHeader>

    <Card>
      <CardContent class="flex flex-wrap items-center gap-2.5 px-4 py-3">
        <span class="hidden shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground sm:flex">
          <FileBarChart2 class="size-4" /> Laporan
        </span>
        <div class="w-full max-w-[240px]">
          <AppSelect v-model="reportType" :options="reportOptions" />
        </div>
        <span class="mx-0.5 hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
        <div class="w-full max-w-[120px]">
          <AppSelect v-model="periodMode" :options="periodModeOptions" />
        </div>
        <template v-if="periodMode === 'monthly'">
          <div class="w-full max-w-[140px]">
            <AppSelect v-model="monthStr" :options="monthOptions" />
          </div>
          <div class="w-full max-w-[100px]">
            <AppSelect v-model="yearStr" :options="yearOptions" />
          </div>
        </template>
        <template v-else>
          <DatePicker v-model="dateFrom" placeholder="Dari tgl" />
          <span class="text-xs text-muted-foreground">s/d</span>
          <DatePicker v-model="dateTo" placeholder="Sampai tgl" />
        </template>
        <template v-if="reportType === 'buku-dana'">
          <span class="mx-0.5 hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
          <div class="w-full max-w-[260px]">
            <AppSelect
              v-model="fundId"
              :options="fundOptions.length ? fundOptions : [{ value: '', label: '— Belum ada dana —' }]"
            />
          </div>
        </template>
      </CardContent>
    </Card>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div v-if="loading" class="space-y-3">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Skeleton v-for="i in 3" :key="i" class="h-[76px] w-full rounded-2xl" />
      </div>
      <Skeleton class="h-64 w-full rounded-xl" />
    </div>

    <Card v-else-if="data">
      <CardContent class="p-4 sm:p-5">
      <!-- Posisi Keuangan -->
      <template v-if="reportType === 'posisi-keuangan'">
        <div class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-100 text-blue-700">
              <Wallet class="size-5" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-medium text-muted-foreground">Total Aset</p>
              <MoneyText :value="data.assets.total" class="block truncate text-xl font-extrabold text-foreground" />
            </div>
          </div>
          <div class="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
              <Landmark class="size-5" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-medium text-muted-foreground">Total Liabilitas</p>
              <MoneyText :value="data.liabilities.total" class="block truncate text-xl font-extrabold text-foreground" />
            </div>
          </div>
          <div class="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <span
              class="grid size-10 shrink-0 place-items-center rounded-xl"
              :class="Number(data.netAssets.total) >= 0 ? 'bg-primary/10 text-primary' : 'bg-rose-100 text-rose-700'"
            >
              <Scale class="size-5" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-medium text-muted-foreground">Total Aset Neto</p>
              <MoneyText
                :value="data.netAssets.total"
                class="block truncate text-xl font-extrabold"
                :class="Number(data.netAssets.total) >= 0 ? 'text-primary' : 'text-rose-700'"
              />
            </div>
          </div>
        </div>

        <div v-if="balanceSheetDiff > 0.5" class="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <AlertTriangle class="mt-0.5 size-4 shrink-0" />
          <span>
            Neraca belum seimbang — selisih <MoneyText :value="balanceSheetDiff" class="inline font-semibold text-amber-800" /> antara Total Aset dan Total Liabilitas + Aset Neto. Periksa saldo awal atau transaksi yang belum diposting.
          </span>
        </div>

        <Table>
          <thead>
            <tr class="border-b border-border bg-muted/50">
              <th class="rounded-l-lg px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Kode</th>
              <th class="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Akun</th>
              <th class="rounded-r-lg px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Saldo</th>
            </tr>
          </thead>
          <tbody>
            <!-- Aset -->
            <tr>
              <td colspan="3" class="px-3 pb-1.5 pt-4">
                <span class="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-blue-700">
                  <Wallet class="size-3.5" /> {{ data.assets.label }}
                </span>
              </td>
            </tr>
            <tr v-for="(l, i) in data.assets.lines" :key="l.accountCode" class="border-b border-border/60" :class="i % 2 === 1 ? 'bg-muted/20' : ''">
              <td class="px-3 py-2 font-mono text-xs text-muted-foreground">{{ l.accountCode }}</td>
              <td class="px-3 py-2 text-sm text-foreground">{{ l.accountName }}</td>
              <td class="px-3 py-2 text-right text-sm font-medium"><MoneyText :value="l.amount" class="text-foreground" /></td>
            </tr>
            <tr class="border-b-2 border-border bg-muted/30 font-bold">
              <td colspan="2" class="px-3 py-2 text-sm">Total {{ data.assets.label }}</td>
              <td class="px-3 py-2 text-right text-sm"><MoneyText :value="data.assets.total" class="text-foreground" /></td>
            </tr>

            <!-- Liabilitas -->
            <tr>
              <td colspan="3" class="px-3 pb-1.5 pt-4">
                <span class="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-700">
                  <Landmark class="size-3.5" /> {{ data.liabilities.label }}
                </span>
              </td>
            </tr>
            <tr v-for="(l, i) in data.liabilities.lines" :key="l.accountCode" class="border-b border-border/60" :class="i % 2 === 1 ? 'bg-muted/20' : ''">
              <td class="px-3 py-2 font-mono text-xs text-muted-foreground">{{ l.accountCode }}</td>
              <td class="px-3 py-2 text-sm text-foreground">{{ l.accountName }}</td>
              <td class="px-3 py-2 text-right text-sm font-medium"><MoneyText :value="l.amount" class="text-foreground" /></td>
            </tr>
            <tr class="border-b-2 border-border bg-muted/30 font-bold">
              <td colspan="2" class="px-3 py-2 text-sm">Total {{ data.liabilities.label }}</td>
              <td class="px-3 py-2 text-right text-sm"><MoneyText :value="data.liabilities.total" class="text-foreground" /></td>
            </tr>

            <!-- Aset Neto -->
            <tr>
              <td colspan="3" class="px-3 pb-1.5 pt-4">
                <span class="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary">
                  <Scale class="size-3.5" /> {{ data.netAssets.label }}
                </span>
              </td>
            </tr>
            <tr v-for="(l, i) in data.netAssets.lines" :key="l.accountCode" class="border-b border-border/60" :class="i % 2 === 1 ? 'bg-muted/20' : ''">
              <td class="px-3 py-2 font-mono text-xs text-muted-foreground">{{ l.accountCode }}</td>
              <td class="px-3 py-2 text-sm text-foreground">{{ l.accountName }}</td>
              <td class="px-3 py-2 text-right text-sm font-medium"><MoneyText :value="l.amount" class="text-foreground" /></td>
            </tr>
            <tr class="border-b-2 border-border bg-muted/30 font-bold">
              <td colspan="2" class="px-3 py-2 text-sm">Total {{ data.netAssets.label }}</td>
              <td class="px-3 py-2 text-right text-sm"><MoneyText :value="data.netAssets.total" class="text-foreground" /></td>
            </tr>

            <tr class="bg-primary/5 font-extrabold">
              <td colspan="2" class="px-3 py-3 text-sm">Total Liabilitas + Aset Neto</td>
              <td class="px-3 py-3 text-right text-base"><MoneyText :value="data.totalLiabilitiesAndNetAssets" class="text-foreground" /></td>
            </tr>
          </tbody>
        </Table>
      </template>

      <!-- Aktivitas -->
      <template v-else-if="reportType === 'aktivitas'">
        <div class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
              <TrendingUp class="size-5" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-medium text-muted-foreground">Total {{ data.income.label }}</p>
              <MoneyText :value="data.income.total" class="block truncate text-xl font-extrabold text-emerald-700" />
            </div>
          </div>
          <div class="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-rose-100 text-rose-700">
              <TrendingDown class="size-5" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-medium text-muted-foreground">Total {{ data.expense.label }}</p>
              <MoneyText :value="data.expense.total" class="block truncate text-xl font-extrabold text-rose-700" />
            </div>
          </div>
          <div class="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <span
              class="grid size-10 shrink-0 place-items-center rounded-xl"
              :class="Number(data.surplusDeficit) >= 0 ? 'bg-primary/10 text-primary' : 'bg-rose-100 text-rose-700'"
            >
              <Scale class="size-5" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-medium text-muted-foreground">Surplus / Defisit</p>
              <MoneyText
                :value="data.surplusDeficit"
                show-sign
                class="block truncate text-xl font-extrabold"
                :class="Number(data.surplusDeficit) >= 0 ? 'text-primary' : 'text-rose-700'"
              />
            </div>
          </div>
        </div>

        <Table>
          <thead>
            <tr class="border-b border-border bg-muted/50">
              <th class="rounded-l-lg px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Kode</th>
              <th class="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Akun</th>
              <th class="rounded-r-lg px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Jumlah</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colspan="3" class="px-3 pb-1.5 pt-4">
                <span class="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-700">
                  <TrendingUp class="size-3.5" /> {{ data.income.label }}
                </span>
              </td>
            </tr>
            <tr v-for="(l, i) in data.income.lines" :key="l.accountCode" class="border-b border-border/60" :class="i % 2 === 1 ? 'bg-muted/20' : ''">
              <td class="px-3 py-2 font-mono text-xs text-muted-foreground">{{ l.accountCode }}</td>
              <td class="px-3 py-2 text-sm text-foreground">{{ l.accountName }}</td>
              <td class="px-3 py-2 text-right text-sm font-medium"><MoneyText :value="l.amount" class="text-foreground" /></td>
            </tr>
            <tr class="border-b-2 border-border bg-muted/30 font-bold">
              <td colspan="2" class="px-3 py-2 text-sm">Total {{ data.income.label }}</td>
              <td class="px-3 py-2 text-right text-sm"><MoneyText :value="data.income.total" class="text-foreground" /></td>
            </tr>

            <tr>
              <td colspan="3" class="px-3 pb-1.5 pt-4">
                <span class="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-rose-700">
                  <TrendingDown class="size-3.5" /> {{ data.expense.label }}
                </span>
              </td>
            </tr>
            <tr v-for="(l, i) in data.expense.lines" :key="l.accountCode" class="border-b border-border/60" :class="i % 2 === 1 ? 'bg-muted/20' : ''">
              <td class="px-3 py-2 font-mono text-xs text-muted-foreground">{{ l.accountCode }}</td>
              <td class="px-3 py-2 text-sm text-foreground">{{ l.accountName }}</td>
              <td class="px-3 py-2 text-right text-sm font-medium"><MoneyText :value="l.amount" class="text-foreground" /></td>
            </tr>
            <tr class="border-b-2 border-border bg-muted/30 font-bold">
              <td colspan="2" class="px-3 py-2 text-sm">Total {{ data.expense.label }}</td>
              <td class="px-3 py-2 text-right text-sm"><MoneyText :value="data.expense.total" class="text-foreground" /></td>
            </tr>

            <tr class="bg-primary/5 font-extrabold">
              <td colspan="2" class="px-3 py-3 text-sm">Surplus / Defisit</td>
              <td class="px-3 py-3 text-right text-base">
                <MoneyText
                  :value="data.surplusDeficit"
                  show-sign
                  :class="Number(data.surplusDeficit) >= 0 ? 'text-emerald-700' : 'text-rose-700'"
                />
              </td>
            </tr>
          </tbody>
        </Table>
      </template>

      <!-- Trial Balance -->
      <template v-else-if="reportType === 'trial-balance'">
        <div v-if="trialBalanceDiff > 0.5" class="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <AlertTriangle class="mt-0.5 size-4 shrink-0" />
          <span>
            Neraca saldo tidak seimbang — selisih Debit dan Kredit sebesar <MoneyText :value="trialBalanceDiff" class="inline font-semibold text-amber-800" />.
          </span>
        </div>
        <Table>
          <thead>
            <tr class="border-b border-border bg-muted/50">
              <th class="rounded-l-lg px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Kode</th>
              <th class="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Akun</th>
              <th class="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tipe</th>
              <th class="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Debit</th>
              <th class="rounded-r-lg px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Kredit</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(l, i) in data.lines" :key="l.accountCode" class="border-b border-border/60" :class="i % 2 === 1 ? 'bg-muted/20' : ''">
              <td class="px-3 py-2 font-mono text-xs text-muted-foreground">{{ l.accountCode }}</td>
              <td class="px-3 py-2 text-sm text-foreground">{{ l.accountName }}</td>
              <td class="px-3 py-2 text-xs text-muted-foreground">{{ l.accountType }}</td>
              <td class="px-3 py-2 text-right text-sm font-medium"><MoneyText :value="l.debit" class="text-foreground" /></td>
              <td class="px-3 py-2 text-right text-sm font-medium"><MoneyText :value="l.credit" class="text-foreground" /></td>
            </tr>
            <tr class="bg-primary/5 font-extrabold">
              <td colspan="3" class="px-3 py-3 text-sm">
                Total
                <span v-if="trialBalanceDiff <= 0.5" class="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Seimbang</span>
              </td>
              <td class="px-3 py-3 text-right text-base"><MoneyText :value="data.totalDebit" class="text-foreground" /></td>
              <td class="px-3 py-3 text-right text-base"><MoneyText :value="data.totalCredit" class="text-foreground" /></td>
            </tr>
          </tbody>
        </Table>
      </template>

      <!-- Jurnal Umum -->
      <template v-else-if="reportType === 'jurnal-umum'">
        <Table>
          <thead>
            <tr class="border-b border-border bg-muted/50">
              <th class="rounded-l-lg px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tanggal</th>
              <th class="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">No</th>
              <th class="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Akun</th>
              <th class="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Debit</th>
              <th class="rounded-r-lg px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Kredit</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(l, i) in data.lines" :key="i" class="border-b border-border/60" :class="i % 2 === 1 ? 'bg-muted/20' : ''">
              <td class="px-3 py-2 text-xs text-muted-foreground">{{ l.journalDate }}</td>
              <td class="px-3 py-2 font-mono text-xs text-muted-foreground">{{ l.journalNo }}</td>
              <td class="px-3 py-2 text-sm text-foreground">{{ l.accountCode }} {{ l.accountName }}</td>
              <td class="px-3 py-2 text-right text-sm font-medium"><MoneyText :value="l.debit" class="text-foreground" /></td>
              <td class="px-3 py-2 text-right text-sm font-medium"><MoneyText :value="l.credit" class="text-foreground" /></td>
            </tr>
            <tr class="bg-primary/5 font-extrabold">
              <td colspan="3" class="px-3 py-3 text-sm">Total</td>
              <td class="px-3 py-3 text-right text-base"><MoneyText :value="data.totalDebit" class="text-foreground" /></td>
              <td class="px-3 py-3 text-right text-base"><MoneyText :value="data.totalCredit" class="text-foreground" /></td>
            </tr>
          </tbody>
        </Table>
      </template>

      <!-- General Ledger -->
      <template v-else-if="reportType === 'general-ledger'">
        <div v-for="acc in data.accounts" :key="acc.accountCode" class="mb-5 overflow-hidden rounded-2xl border bg-card last:mb-0">
          <div class="flex items-center gap-2.5 border-b bg-muted/40 px-4 py-2.5">
            <span class="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-[10px] font-bold text-primary">
              {{ acc.accountCode }}
            </span>
            <h3 class="text-sm font-semibold text-foreground">{{ acc.accountName }}</h3>
          </div>
          <Table>
            <thead>
              <tr class="border-b border-border bg-muted/30">
                <th class="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tanggal</th>
                <th class="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">No</th>
                <th class="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Debit</th>
                <th class="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Kredit</th>
                <th class="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Saldo</th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-b border-border/60 bg-muted/20">
                <td colspan="4" class="px-3 py-2 text-xs italic text-muted-foreground">Saldo Awal</td>
                <td class="px-3 py-2 text-right text-sm font-medium"><MoneyText :value="acc.openingBalance" class="text-foreground" /></td>
              </tr>
              <tr v-for="(l, i) in acc.lines" :key="i" class="border-b border-border/60" :class="i % 2 === 1 ? 'bg-muted/20' : ''">
                <td class="px-3 py-2 text-xs text-muted-foreground">{{ l.journalDate }}</td>
                <td class="px-3 py-2 font-mono text-xs text-muted-foreground">{{ l.journalNo }}</td>
                <td class="px-3 py-2 text-right text-sm"><MoneyText :value="l.debit" class="text-foreground" /></td>
                <td class="px-3 py-2 text-right text-sm"><MoneyText :value="l.credit" class="text-foreground" /></td>
                <td class="px-3 py-2 text-right text-sm font-medium"><MoneyText :value="l.runningBalance" class="text-foreground" /></td>
              </tr>
              <tr class="bg-primary/5 font-bold">
                <td colspan="4" class="px-3 py-2.5 text-sm">Saldo Akhir</td>
                <td class="px-3 py-2.5 text-right text-sm"><MoneyText :value="acc.closingBalance" class="text-foreground" /></td>
              </tr>
            </tbody>
          </Table>
        </div>
      </template>

      <!-- Perubahan Aset Neto -->
      <template v-else-if="reportType === 'perubahan-aset-neto'">
        <div class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Wallet class="size-5" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-medium text-muted-foreground">Saldo Awal</p>
              <MoneyText :value="data.openingBalance" class="block truncate text-xl font-extrabold text-foreground" />
            </div>
          </div>
          <div class="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <span
              class="grid size-10 shrink-0 place-items-center rounded-xl"
              :class="Number(data.surplusDeficit) >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'"
            >
              <Scale class="size-5" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-medium text-muted-foreground">Surplus / Defisit</p>
              <MoneyText
                :value="data.surplusDeficit"
                show-sign
                class="block truncate text-xl font-extrabold"
                :class="Number(data.surplusDeficit) >= 0 ? 'text-emerald-700' : 'text-rose-700'"
              />
            </div>
          </div>
          <div class="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Scale class="size-5" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-medium text-muted-foreground">Saldo Akhir</p>
              <MoneyText :value="data.closingBalance" class="block truncate text-xl font-extrabold text-foreground" />
            </div>
          </div>
        </div>
        <Table v-if="data.byEquityAccount?.length">
          <thead>
            <tr class="border-b border-border bg-muted/50">
              <th class="rounded-l-lg px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Kode</th>
              <th class="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Akun Ekuitas</th>
              <th class="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Saldo Awal</th>
              <th class="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mutasi</th>
              <th class="rounded-r-lg px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Saldo Akhir</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in data.byEquityAccount" :key="r.accountCode" class="border-b border-border/60" :class="i % 2 === 1 ? 'bg-muted/20' : ''">
              <td class="px-3 py-2 font-mono text-xs text-muted-foreground">{{ r.accountCode }}</td>
              <td class="px-3 py-2 text-sm text-foreground">{{ r.accountName }}</td>
              <td class="px-3 py-2 text-right text-sm"><MoneyText :value="r.opening" class="text-foreground" /></td>
              <td class="px-3 py-2 text-right text-sm"><MoneyText :value="r.movement" class="text-foreground" /></td>
              <td class="px-3 py-2 text-right text-sm font-medium"><MoneyText :value="r.closing" class="text-foreground" /></td>
            </tr>
          </tbody>
        </Table>
      </template>

      <!-- Arus Kas -->
      <template v-else-if="reportType === 'arus-kas'">
        <div class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Wallet class="size-5" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-medium text-muted-foreground">Kas Awal</p>
              <MoneyText :value="data.openingCash" class="block truncate text-xl font-extrabold text-foreground" />
            </div>
          </div>
          <div class="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <span
              class="grid size-10 shrink-0 place-items-center rounded-xl"
              :class="Number(data.netCashChange) >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'"
            >
              <Scale class="size-5" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-medium text-muted-foreground">Perubahan Kas</p>
              <MoneyText
                :value="data.netCashChange"
                show-sign
                class="block truncate text-xl font-extrabold"
                :class="Number(data.netCashChange) >= 0 ? 'text-emerald-700' : 'text-rose-700'"
              />
            </div>
          </div>
          <div class="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Wallet class="size-5" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-medium text-muted-foreground">Kas Akhir</p>
              <MoneyText :value="data.closingCash" class="block truncate text-xl font-extrabold text-foreground" />
            </div>
          </div>
        </div>

        <template v-for="section in [
          { key: 'operating', label: 'Aktivitas Operasi', data: data.operating },
          { key: 'investing', label: 'Aktivitas Investasi', data: data.investing },
          { key: 'financing', label: 'Aktivitas Pendanaan', data: data.financing },
        ]" :key="section.key">
          <div class="mb-4 overflow-hidden rounded-2xl border bg-card last:mb-0">
            <div class="border-b bg-muted/40 px-4 py-2.5">
              <h3 class="text-sm font-semibold text-foreground">{{ section.label }}</h3>
            </div>
            <Table>
              <thead>
                <tr class="border-b border-border bg-muted/20">
                  <th class="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Uraian</th>
                  <th class="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Jumlah</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!section.data.lines?.length">
                  <td colspan="2" class="px-3 py-4 text-center text-xs italic text-muted-foreground">Tidak ada aktivitas</td>
                </tr>
                <tr v-for="(l, i) in section.data.lines" :key="i" class="border-b border-border/60" :class="i % 2 === 1 ? 'bg-muted/20' : ''">
                  <td class="px-3 py-2 text-sm text-foreground">{{ l.description }}</td>
                  <td class="px-3 py-2 text-right text-sm font-medium"><MoneyText :value="l.amount" class="text-foreground" /></td>
                </tr>
                <tr class="bg-muted/30 font-bold">
                  <td class="px-3 py-2.5 text-sm">Total {{ section.label }}</td>
                  <td class="px-3 py-2.5 text-right text-sm"><MoneyText :value="section.data.total" class="text-foreground" /></td>
                </tr>
              </tbody>
            </Table>
          </div>
        </template>
      </template>

      <!-- Sumber & Penggunaan Dana (PSAK 109) -->
      <template v-else-if="reportType === 'sumber-penggunaan-dana'">
        <div class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
              <TrendingUp class="size-5" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-medium text-muted-foreground">Total Penerimaan</p>
              <MoneyText :value="data.totalPenerimaan" class="block truncate text-xl font-extrabold text-emerald-700" />
            </div>
          </div>
          <div class="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-rose-100 text-rose-700">
              <TrendingDown class="size-5" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-medium text-muted-foreground">Total Penyaluran</p>
              <MoneyText :value="data.totalPenyaluran" class="block truncate text-xl font-extrabold text-rose-700" />
            </div>
          </div>
          <div class="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <span
              class="grid size-10 shrink-0 place-items-center rounded-xl"
              :class="Number(data.totalSurplusDeficit) >= 0 ? 'bg-primary/10 text-primary' : 'bg-rose-100 text-rose-700'"
            >
              <Scale class="size-5" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-medium text-muted-foreground">Surplus / Defisit</p>
              <MoneyText
                :value="data.totalSurplusDeficit"
                show-sign
                class="block truncate text-xl font-extrabold"
                :class="Number(data.totalSurplusDeficit) >= 0 ? 'text-primary' : 'text-rose-700'"
              />
            </div>
          </div>
        </div>

        <Table>
          <thead>
            <tr class="border-b border-border bg-muted/50">
              <th class="rounded-l-lg px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Dana</th>
              <th class="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Saldo Awal</th>
              <th class="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Penerimaan</th>
              <th class="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Penyaluran</th>
              <th class="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Surplus / Defisit</th>
              <th class="rounded-r-lg px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Saldo Akhir</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!data.funds?.length">
              <td colspan="6" class="px-3 py-6 text-center text-xs italic text-muted-foreground">
                Belum ada dana. Aktifkan dana PSAK 109 di pengaturan akuntansi.
              </td>
            </tr>
            <tr v-for="(f, i) in data.funds" :key="f.fundCode" class="border-b border-border/60" :class="i % 2 === 1 ? 'bg-muted/20' : ''">
              <td class="px-3 py-2 text-sm text-foreground">
                {{ f.fundName }}
                <span v-if="f.isRestricted" class="ml-1 text-amber-600" title="Dana terikat syariah">*</span>
              </td>
              <td class="px-3 py-2 text-right text-sm"><MoneyText :value="f.openingBalance" class="text-foreground" /></td>
              <td class="px-3 py-2 text-right text-sm"><MoneyText :value="f.penerimaan" class="text-foreground" /></td>
              <td class="px-3 py-2 text-right text-sm"><MoneyText :value="f.penyaluran" class="text-foreground" /></td>
              <td class="px-3 py-2 text-right text-sm">
                <MoneyText
                  :value="f.surplusDeficit"
                  show-sign
                  :class="Number(f.surplusDeficit) >= 0 ? 'text-emerald-700' : 'text-rose-700'"
                />
              </td>
              <td class="px-3 py-2 text-right text-sm font-medium"><MoneyText :value="f.closingBalance" class="text-foreground" /></td>
            </tr>
            <tr class="bg-primary/5 font-extrabold">
              <td class="px-3 py-3 text-sm">Total</td>
              <td class="px-3 py-3 text-right text-sm"><MoneyText :value="data.totalOpening" class="text-foreground" /></td>
              <td class="px-3 py-3 text-right text-sm"><MoneyText :value="data.totalPenerimaan" class="text-foreground" /></td>
              <td class="px-3 py-3 text-right text-sm"><MoneyText :value="data.totalPenyaluran" class="text-foreground" /></td>
              <td class="px-3 py-3 text-right text-sm">
                <MoneyText
                  :value="data.totalSurplusDeficit"
                  show-sign
                  :class="Number(data.totalSurplusDeficit) >= 0 ? 'text-emerald-700' : 'text-rose-700'"
                />
              </td>
              <td class="px-3 py-3 text-right text-base"><MoneyText :value="data.totalClosing" class="text-foreground" /></td>
            </tr>
          </tbody>
        </Table>
        <p class="mt-3 text-xs text-muted-foreground">* dana terikat syariah (mis. zakat, wakaf) — penggunaan dibatasi. Untuk rincian 1 dana (masuk/keluar), pilih laporan <strong>Buku Dana</strong>.</p>

      <!-- Buku Dana — detail 1 dana (mis. Infaq Rutin PAP) -->
      </template>
      <template v-else-if="reportType === 'buku-dana'">
        <div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 class="text-base font-bold text-foreground">{{ data.fundName }}</h3>
            <p class="text-xs text-muted-foreground">
              Kode {{ data.fundCode }}
              <span v-if="data.isRestricted"> · terikat</span>
            </p>
          </div>
        </div>

        <div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="rounded-2xl border bg-card p-3.5">
            <p class="text-[11px] font-medium text-muted-foreground">Saldo Awal</p>
            <MoneyText :value="data.openingBalance" class="mt-0.5 block text-lg font-extrabold text-foreground" />
          </div>
          <div class="rounded-2xl border bg-card p-3.5">
            <p class="text-[11px] font-medium text-muted-foreground">Penerimaan (masuk)</p>
            <MoneyText :value="data.totalPenerimaan" tone="income" class="mt-0.5 block text-lg font-extrabold" />
          </div>
          <div class="rounded-2xl border bg-card p-3.5">
            <p class="text-[11px] font-medium text-muted-foreground">Penyaluran (keluar)</p>
            <MoneyText :value="data.totalPenyaluran" tone="expense" class="mt-0.5 block text-lg font-extrabold" />
          </div>
          <div class="rounded-2xl border bg-card p-3.5">
            <p class="text-[11px] font-medium text-muted-foreground">Saldo Akhir</p>
            <MoneyText :value="data.closingBalance" class="mt-0.5 block text-lg font-extrabold text-foreground" />
          </div>
        </div>

        <Table>
          <thead>
            <tr class="border-b border-border bg-muted/50">
              <th class="rounded-l-lg px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tanggal</th>
              <th class="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Keterangan</th>
              <th class="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Akun</th>
              <th class="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Arah</th>
              <th class="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Jumlah</th>
              <th class="rounded-r-lg px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Saldo</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!data.movements?.length">
              <td colspan="6" class="px-3 py-8 text-center text-xs italic text-muted-foreground">
                Belum ada mutasi di periode ini. Pastikan saat input transaksi kolom <strong>Dana</strong> diisi.
              </td>
            </tr>
            <tr
              v-for="(m, i) in data.movements"
              :key="m.journalId + m.accountCode + i"
              class="border-b border-border/60 transition-colors"
              :class="[
                i % 2 === 1 ? 'bg-muted/20' : '',
                m.transactionId ? 'cursor-pointer hover:bg-emerald-50/50' : '',
              ]"
              :title="m.transactionId ? 'Buka detail transaksi' : undefined"
              @click="m.transactionId && router.push({ path: '/transactions', query: { open: m.transactionId } })"
            >
              <td class="px-3 py-2 text-sm tabular-nums text-muted-foreground">
                {{ String(m.journalDate).slice(0, 10) }}
              </td>
              <td class="px-3 py-2 text-sm text-foreground">
                <p class="font-medium">{{ m.description || m.journalNo }}</p>
                <p class="text-[11px] text-muted-foreground">
                  {{ m.transactionNo || m.journalNo }}
                </p>
              </td>
              <td class="px-3 py-2 text-sm text-muted-foreground">
                {{ m.accountCode }} — {{ m.accountName }}
              </td>
              <td class="px-3 py-2 text-sm">
                <span
                  class="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  :class="m.direction === 'penerimaan'
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-amber-50 text-amber-900'"
                >
                  {{ m.direction === 'penerimaan' ? 'Masuk' : 'Keluar' }}
                </span>
              </td>
              <td class="px-3 py-2 text-right text-sm">
                <MoneyText
                  :value="m.amount"
                  :tone="m.direction === 'penerimaan' ? 'income' : 'expense'"
                  class="font-semibold"
                />
              </td>
              <td class="px-3 py-2 text-right text-sm font-medium">
                <MoneyText :value="m.runningBalance" class="text-foreground" />
              </td>
            </tr>
          </tbody>
        </Table>
      </template>

      <!-- Konsolidasi Dana Multi-Cabang (PSAK 109) -->
      <template v-else-if="reportType === 'konsolidasi-dana'">
        <div class="mb-4 flex items-center gap-2">
          <span class="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
            {{ data.entityCount }} entitas
          </span>
          <span class="text-xs text-muted-foreground">induk + cabang yang terhubung</span>
        </div>

        <div class="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
              <TrendingUp class="size-5" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-medium text-muted-foreground">Total Penerimaan</p>
              <MoneyText :value="data.totalPenerimaan" class="block truncate text-xl font-extrabold text-emerald-700" />
            </div>
          </div>
          <div class="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-rose-100 text-rose-700">
              <TrendingDown class="size-5" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-medium text-muted-foreground">Total Penyaluran</p>
              <MoneyText :value="data.totalPenyaluran" class="block truncate text-xl font-extrabold text-rose-700" />
            </div>
          </div>
          <div class="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <span
              class="grid size-10 shrink-0 place-items-center rounded-xl"
              :class="Number(data.totalSurplusDeficit) >= 0 ? 'bg-primary/10 text-primary' : 'bg-rose-100 text-rose-700'"
            >
              <Scale class="size-5" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-medium text-muted-foreground">Surplus / Defisit</p>
              <MoneyText
                :value="data.totalSurplusDeficit"
                show-sign
                class="block truncate text-xl font-extrabold"
                :class="Number(data.totalSurplusDeficit) >= 0 ? 'text-primary' : 'text-rose-700'"
              />
            </div>
          </div>
        </div>

        <h3 class="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">Ringkasan per Entitas</h3>
        <Table class="mb-6">
          <thead>
            <tr class="border-b border-border bg-muted/50">
              <th class="rounded-l-lg px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Entitas</th>
              <th class="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Penerimaan</th>
              <th class="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Penyaluran</th>
              <th class="rounded-r-lg px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Saldo Akhir</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in data.entities" :key="e.tenantId" class="border-b border-border/60" :class="i % 2 === 1 ? 'bg-muted/20' : ''">
              <td class="px-3 py-2 text-sm text-foreground">{{ e.tenantName }}</td>
              <td class="px-3 py-2 text-right text-sm"><MoneyText :value="e.penerimaan" class="text-foreground" /></td>
              <td class="px-3 py-2 text-right text-sm"><MoneyText :value="e.penyaluran" class="text-foreground" /></td>
              <td class="px-3 py-2 text-right text-sm font-medium"><MoneyText :value="e.closingBalance" class="text-foreground" /></td>
            </tr>
          </tbody>
        </Table>

        <h3 class="mb-2 text-sm font-semibold text-foreground">Konsolidasi per Jenis Dana</h3>
        <Table>
          <thead>
            <tr class="border-b border-border bg-muted/50">
              <th class="rounded-l-lg px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Dana</th>
              <th class="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Saldo Awal</th>
              <th class="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Penerimaan</th>
              <th class="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Penyaluran</th>
              <th class="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Surplus / Defisit</th>
              <th class="rounded-r-lg px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Saldo Akhir</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!data.byFundType?.length">
              <td colspan="6" class="px-3 py-6 text-center text-xs italic text-muted-foreground">
                Belum ada dana di entitas mana pun.
              </td>
            </tr>
            <tr v-for="(f, i) in data.byFundType" :key="f.fundType" class="border-b border-border/60" :class="i % 2 === 1 ? 'bg-muted/20' : ''">
              <td class="px-3 py-2 text-sm text-foreground">{{ f.label }}</td>
              <td class="px-3 py-2 text-right text-sm"><MoneyText :value="f.openingBalance" class="text-foreground" /></td>
              <td class="px-3 py-2 text-right text-sm"><MoneyText :value="f.penerimaan" class="text-foreground" /></td>
              <td class="px-3 py-2 text-right text-sm"><MoneyText :value="f.penyaluran" class="text-foreground" /></td>
              <td class="px-3 py-2 text-right text-sm">
                <MoneyText
                  :value="f.surplusDeficit"
                  show-sign
                  :class="Number(f.surplusDeficit) >= 0 ? 'text-emerald-700' : 'text-rose-700'"
                />
              </td>
              <td class="px-3 py-2 text-right text-sm font-medium"><MoneyText :value="f.closingBalance" class="text-foreground" /></td>
            </tr>
            <tr class="bg-primary/5 font-extrabold">
              <td class="px-3 py-3 text-sm">Total Konsolidasi</td>
              <td class="px-3 py-3 text-right text-sm"><MoneyText :value="data.totalOpening" class="text-foreground" /></td>
              <td class="px-3 py-3 text-right text-sm"><MoneyText :value="data.totalPenerimaan" class="text-foreground" /></td>
              <td class="px-3 py-3 text-right text-sm"><MoneyText :value="data.totalPenyaluran" class="text-foreground" /></td>
              <td class="px-3 py-3 text-right text-sm">
                <MoneyText
                  :value="data.totalSurplusDeficit"
                  show-sign
                  :class="Number(data.totalSurplusDeficit) >= 0 ? 'text-emerald-700' : 'text-rose-700'"
                />
              </td>
              <td class="px-3 py-3 text-right text-base"><MoneyText :value="data.totalClosing" class="text-foreground" /></td>
            </tr>
          </tbody>
        </Table>
      </template>

      <!-- Fallback — JSON dump for any unknown type -->
      <template v-else>
        <pre class="overflow-x-auto rounded-lg bg-muted p-3 text-xs text-muted-foreground">{{ JSON.stringify(data, null, 2) }}</pre>
      </template>
      </CardContent>
    </Card>

    <Card v-else-if="!loading && !error">
      <CardContent class="flex flex-col items-center gap-2 py-14 text-center">
        <span class="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <FileBarChart2 class="size-5" />
        </span>
        <p class="text-sm font-semibold text-foreground">Tidak ada data untuk periode ini</p>
        <p class="max-w-[18rem] text-xs text-muted-foreground">Coba ganti periode atau jenis laporan di atas.</p>
      </CardContent>
    </Card>
  </div>
</template>
