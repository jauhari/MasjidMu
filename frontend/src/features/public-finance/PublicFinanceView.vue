<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { CalendarDays, FileDown, ImageDown, Printer, ShieldCheck, TrendingDown, TrendingUp, Wallet } from 'lucide-vue-next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table } from '@/components/ui/table';
import AppSelect from '@/shared/ui/AppSelect.vue';
import Button from '@/shared/ui/Button.vue';
import DatePicker from '@/shared/ui/DatePicker.vue';
import MoneyText from '@/shared/ui/MoneyText.vue';
import { getTenantSlug } from '@/shared/api/client';

interface CategoryAmount {
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  amount: string;
}

interface MonthlyAmount {
  month: string;
  income: string;
  expense: string;
}

/** Buku Kas row: the same TGL | Keterangan | Masuk | Keluar | Saldo as the handwritten cash book. */
interface LedgerEntry {
  date: string;
  keterangan: string;
  masuk: string;
  keluar: string;
  saldo: string;
}

interface CashLedger {
  openingBalance: string;
  closingBalance: string;
  totalMasuk: string;
  totalKeluar: string;
  entries: LedgerEntry[];
  truncated: boolean;
  /** true when keterangan carries (name-masked) transaction descriptions instead of category names */
  descriptionsVisible: boolean;
}

interface PublicFinanceReport {
  reportType: 'finance-transparency';
  mosque: { name: string; shortName: string | null; logoUrl: string | null; bannerUrl: string | null };
  period: { startDate: string; endDate: string; label: string };
  publication: { publishedAt: string };
  generatedAt: string;
  data: {
    cashPosition: string;
    topIncome: CategoryAmount[];
    topExpense: CategoryAmount[];
    monthlyTrend: MonthlyAmount[];
    ledger: CashLedger;
  };
}

/** One <tbody> of the printed Buku Kas (see ledgerGroups). */
interface PrintLedgerGroup {
  key: string;
  /** never split this group across two pages */
  keep: boolean;
  /** starts with the "Saldo awal" row */
  opening: boolean;
  /** ends with the "Jumlah" row */
  total: boolean;
  rows: (LedgerEntry & { alt: boolean })[];
}

const MONTH_NAME_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
const MONTH_ABBR_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Printed Buku Kas: keep this many rows together with "Saldo awal" (and the heading)
 * and this many with "Jumlah", so a page never starts or ends with one or two lonely lines. */
const LEDGER_HEAD_ROWS = 4;
const LEDGER_TAIL_ROWS = 3;

const route = useRoute();
const now = new Date();
const loading = ref(false);
const unavailable = ref(false);
const error = ref<string | null>(null);
const report = ref<PublicFinanceReport | null>(null);
const periodMode = ref<'monthly' | 'custom' | 'all'>('monthly');
const month = ref(now.getMonth() + 1);
const year = ref(now.getFullYear());
const dateFrom = ref<string | null>(null);
const dateTo = ref<string | null>(null);

const periodModeOptions: { value: 'monthly' | 'custom' | 'all'; label: string }[] = [
  { value: 'monthly', label: 'Per Bulan' },
  { value: 'custom', label: 'Custom' },
  { value: 'all', label: 'Semua Data' },
];

const monthOptions = computed(() =>
  Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: new Date(2000, i, 1).toLocaleDateString('id-ID', { month: 'long' }),
  })),
);
const yearOptions = computed(() => {
  const y = now.getFullYear();
  return Array.from({ length: 6 }, (_, i) => ({ value: String(y - i), label: String(y - i) }));
});
const monthStr = computed({ get: () => String(month.value), set: (v: string) => { month.value = Number(v); } });
const yearStr = computed({ get: () => String(year.value), set: (v: string) => { year.value = Number(v); } });

function validTenantSlug(slug: unknown): string | null {
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  return !['api', 'admin', 'app', 'www'].includes(slug) ? slug : null;
}

function tenantSlugForDev(): string | null {
  const routeSlug = validTenantSlug(route.params.tenantSlug);
  if (routeSlug) return routeSlug;
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.pages.dev')) {
    return validTenantSlug(getTenantSlug());
  }
  return null;
}

function buildPublicUrl(format?: 'image' | 'pdf'): string {
  const params = new URLSearchParams();
  if (periodMode.value === 'all') {
    params.set('period', 'all');
  } else if (periodMode.value === 'custom') {
    if (dateFrom.value) params.set('startDate', dateFrom.value);
    if (dateTo.value) params.set('endDate', dateTo.value);
  } else {
    params.set('month', String(month.value));
    params.set('year', String(year.value));
  }
  const tenantSlug = tenantSlugForDev();
  if (tenantSlug) params.set('tenant_slug', tenantSlug);
  if (format) params.set('format', format);
  return `/api/public/keuangan?${params.toString()}`;
}

const imageUrl = computed(() => buildPublicUrl('image'));
const pdfUrl = computed(() => buildPublicUrl('pdf'));

function printReport(): void {
  window.print();
}

function longDate(d: Date): string {
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

const printDate = ref(longDate(new Date()));

/** Address printed in the footer so a paper copy can be checked against the live page. */
const verifyUrl = computed(() => {
  if (typeof window === 'undefined') return '';
  return `${window.location.host}${window.location.pathname.replace(/\/+$/, '')}`;
});

/** Chrome puts document.title in the print header and uses it as the suggested PDF file
 * name -- swap in a meaningful one while the print dialog is open (covers Ctrl+P too). */
let titleBeforePrint: string | null = null;

function onBeforePrint(): void {
  printDate.value = longDate(new Date());
  if (!report.value || titleBeforePrint !== null) return;
  titleBeforePrint = document.title;
  document.title = `Laporan Keuangan ${report.value.mosque.name} - ${report.value.period.label}`;
}

function onAfterPrint(): void {
  if (titleBeforePrint === null) return;
  document.title = titleBeforePrint;
  titleBeforePrint = null;
}

const leaderName = computed(() => {
  const slug = tenantSlugForDev();
  if (slug === 'pca-ponjong') return 'Umi Fadhilah';
  return '( ................................ )';
});

const treasurerName = computed(() => {
  const slug = tenantSlugForDev();
  if (slug === 'pca-ponjong') return 'Iva Fitria';
  return '( ................................ )';
});

/** "2026-08-04" -> "04 Agu 2026". String math on purpose: a date-only value
 * run through `new Date()` is UTC midnight and shows as the previous day in
 * any timezone behind UTC. */
function formatLedgerDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d} ${MONTH_ABBR_ID[Number(m) - 1] ?? m} ${y}`;
}

const NUMBER_ID = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

/** Plain number for the printed document: "7.386.000", negative "−1.036.000".
 * The printed tables put "Rp" in the column header instead of on every cell. */
function fmtNum(value: string | number | null | undefined, showSign = false): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  const body = NUMBER_ID.format(Math.abs(n));
  if (n < 0) return `−${body}`;
  return showSign ? `+${body}` : body;
}

function fmtRp(value: string | number | null | undefined): string {
  const s = fmtNum(value);
  if (s === '—') return s;
  return s.startsWith('−') ? `−Rp ${s.slice(1)}` : `Rp ${s}`;
}

/** Tabel per tahun, terbaru dulu -- semua 12 bulan ditampilkan (bulan
 * tanpa transaksi = baris nol, bukan disembunyikan) supaya tidak ada
 * kesan data "hilang", plus baris Total per tahun. */
const trendByYear = computed(() => {
  const trend = report.value?.data.monthlyTrend ?? [];
  if (!trend.length) return [];
  const byMonth = new Map(trend.map((m) => [m.month, m]));
  const years = [...new Set(trend.map((m) => Number(m.month.slice(0, 4))))];
  const byYear = new Map<number, { label: string; income: string; expense: string; net: string }[]>();
  for (const y of years) {
    const rows = Array.from({ length: 12 }, (_, i) => {
      const key = `${y}-${String(i + 1).padStart(2, '0')}`;
      const found = byMonth.get(key);
      const income = found?.income ?? '0';
      const expense = found?.expense ?? '0';
      return { label: MONTH_NAME_ID[i]!, income, expense, net: (Number(income) - Number(expense)).toFixed(2) };
    });
    byYear.set(y, rows);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, months]) => {
      const totalIncome = months.reduce((s, m) => s + Number(m.income), 0);
      const totalExpense = months.reduce((s, m) => s + Number(m.expense), 0);
      return {
        year,
        months,
        totalIncome: totalIncome.toFixed(2),
        totalExpense: totalExpense.toFixed(2),
        totalNet: (totalIncome - totalExpense).toFixed(2),
      };
    });
});

/** Grand total under the per-year recap of the printed "Semua Data" report. */
const trendTotals = computed(() => {
  const income = trendByYear.value.reduce((s, y) => s + Number(y.totalIncome), 0);
  const expense = trendByYear.value.reduce((s, y) => s + Number(y.totalExpense), 0);
  return { income: income.toFixed(2), expense: expense.toFixed(2), net: (income - expense).toFixed(2) };
});

/** Colour class for a printed amount; zero is greyed out so the real movements stand out. */
function amountClass(value: string | number | null | undefined, tone: 'in' | 'out' | 'net'): string {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n === 0) return 'pd-zero';
  if (tone === 'in') return 'pd-in';
  if (tone === 'out') return 'pd-out';
  return n < 0 ? 'pd-neg' : 'pd-pos';
}

/** The per-year recap is built from income/expense categories while the Buku Kas follows every
 * cash movement, so their totals can differ (e.g. an opening-balance receipt is cash but not
 * income). Say so instead of leaving two different "Total Pemasukan" figures unexplained. */
const recapGapText = computed(() => {
  const ledger = report.value?.data.ledger;
  if (!ledger || periodMode.value !== 'all' || !trendByYear.value.length) return null;
  const income = Math.abs(Math.round(Number(ledger.totalMasuk) - Number(trendTotals.value.income)));
  const expense = Math.abs(Math.round(Number(ledger.totalKeluar) - Number(trendTotals.value.expense)));
  const parts: string[] = [];
  if (income > 0) parts.push(`pemasukan Rp ${fmtNum(income)}`);
  if (expense > 0) parts.push(`pengeluaran Rp ${fmtNum(expense)}`);
  return parts.length ? parts.join(', ') : null;
});

/** The printed document only exists once a report is on screen (not while a new period loads). */
const printable = computed(() => report.value !== null && !loading.value);

/** Printed Buku Kas as 1-3 <tbody> groups: the first (with "Saldo awal") and last (with
 * "Jumlah") are unbreakable, the middle one flows over as many pages as it needs. The
 * heading is kept with the first group, so a table never starts as a stub at a page bottom. */
const ledgerGroups = computed<PrintLedgerGroup[]>(() => {
  const entries = (report.value?.data.ledger?.entries ?? []).map((e, i) => ({ ...e, alt: i % 2 === 1 }));
  if (entries.length <= LEDGER_HEAD_ROWS + LEDGER_TAIL_ROWS) {
    return [{ key: 'all', keep: true, opening: true, total: true, rows: entries }];
  }
  return [
    { key: 'head', keep: true, opening: true, total: false, rows: entries.slice(0, LEDGER_HEAD_ROWS) },
    { key: 'body', keep: false, opening: false, total: false, rows: entries.slice(LEDGER_HEAD_ROWS, -LEDGER_TAIL_ROWS) },
    { key: 'tail', keep: true, opening: false, total: true, rows: entries.slice(-LEDGER_TAIL_ROWS) },
  ];
});

async function load(): Promise<void> {
  if (periodMode.value === 'custom' && (!dateFrom.value || !dateTo.value)) return;
  loading.value = true;
  error.value = null;
  unavailable.value = false;
  try {
    const res = await fetch(buildPublicUrl(), { credentials: 'omit', headers: { Accept: 'application/json' } });
    const parsed = await res.json().catch(() => null) as PublicFinanceReport | { error?: string; detail?: string } | null;
    if (res.status === 404) {
      unavailable.value = true;
      report.value = null;
      return;
    }
    if (!res.ok) {
      error.value = (parsed as { detail?: string; error?: string } | null)?.detail
        ?? (parsed as { error?: string } | null)?.error
        ?? 'Gagal memuat laporan publik';
      report.value = null;
      return;
    }
    report.value = parsed as PublicFinanceReport;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Gagal memuat laporan publik';
    report.value = null;
  } finally {
    loading.value = false;
  }
}

watch([periodMode, month, year, dateFrom, dateTo], () => { void load(); });
onMounted(() => {
  void load();
  window.addEventListener('beforeprint', onBeforePrint);
  window.addEventListener('afterprint', onAfterPrint);
});
onBeforeUnmount(() => {
  window.removeEventListener('beforeprint', onBeforePrint);
  window.removeEventListener('afterprint', onAfterPrint);
  onAfterPrint();
});
</script>

<template>
  <main
    class="pd-root min-h-svh bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.10),transparent_32rem),linear-gradient(180deg,#f8fbf9_0%,#eef4ef_100%)] px-4 py-6 text-foreground sm:px-6 lg:px-8"
    :class="{ 'pd-has-doc': printable }"
  >
    <!-- UI LAYAR. Saat dicetak seluruh blok ini disembunyikan dan digantikan dokumen cetak (.pd) di bawah. -->
    <div class="screen-only mx-auto max-w-4xl space-y-5">
      <header class="overflow-hidden rounded-3xl border bg-card shadow-sm">
        <div v-if="report?.mosque.bannerUrl" class="h-32 bg-cover bg-center" :style="{ backgroundImage: `url(${report.mosque.bannerUrl})` }" />
        <div class="flex flex-col gap-4 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div class="flex items-center gap-4">
            <img v-if="report?.mosque.logoUrl" :src="report.mosque.logoUrl" alt="" class="size-14 rounded-2xl border bg-background object-cover" />
            <span v-else class="grid size-14 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><ShieldCheck class="size-7" /></span>
            <div>
              <p class="text-xs font-bold uppercase tracking-[0.22em] text-emerald-700">Transparansi Keuangan</p>
              <h1 class="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{{ report?.mosque.name || 'Laporan Keuangan' }}</h1>
              <p class="mt-1 text-sm text-muted-foreground">{{ report?.period.label || 'Ringkasan publik keuangan lembaga' }}</p>
            </div>
          </div>
          <div v-if="report" class="flex flex-wrap items-center gap-2">
            <Button variant="outline" @click="printReport">
              <Printer class="h-4 w-4" /> Cetak Laporan
            </Button>
            <a :href="pdfUrl" target="_blank" rel="noopener">
              <Button variant="outline">
                <FileDown class="h-4 w-4" /> Unduh PDF
              </Button>
            </a>
            <a :href="imageUrl" target="_blank" rel="noopener">
              <Button variant="secondary">
                <ImageDown class="h-4 w-4" /> Unduh Gambar
              </Button>
            </a>
          </div>
        </div>
      </header>

      <Card class="overflow-visible">
        <CardContent class="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:gap-4 sm:px-6">
          <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
            <CalendarDays class="size-5" />
          </span>

          <div class="inline-flex items-center gap-1 rounded-full bg-muted/70 p-1">
            <button
              v-for="opt in periodModeOptions"
              :key="opt.value"
              type="button"
              class="rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors duration-150 sm:px-4 sm:text-sm"
              :class="periodMode === opt.value
                ? 'bg-white text-emerald-700 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'"
              @click="periodMode = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>

          <div class="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
            <template v-if="periodMode === 'monthly'">
              <div class="w-[140px]"><AppSelect v-model="monthStr" :options="monthOptions" /></div>
              <div class="w-[95px]"><AppSelect v-model="yearStr" :options="yearOptions" /></div>
            </template>
            <template v-else-if="periodMode === 'custom'">
              <div class="w-[150px]"><DatePicker v-model="dateFrom" placeholder="Dari tgl" /></div>
              <span class="text-xs text-muted-foreground">s/d</span>
              <div class="w-[150px]"><DatePicker v-model="dateTo" placeholder="Sampai tgl" /></div>
            </template>
          </div>
        </CardContent>
      </Card>

      <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

      <Card v-if="unavailable && !loading">
        <CardContent class="flex flex-col items-center gap-3 py-16 text-center">
          <span class="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground"><Wallet class="size-6" /></span>
          <div>
            <p class="text-base font-semibold text-foreground">Laporan belum dipublikasikan</p>
            <p class="mt-1 max-w-md text-sm text-muted-foreground">Pengelola belum mengaktifkan ringkasan keuangan publik untuk lembaga ini.</p>
          </div>
        </CardContent>
      </Card>

      <template v-else-if="loading">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3"><Skeleton v-for="i in 3" :key="i" class="h-24 rounded-2xl" /></div>
        <Skeleton class="h-64 rounded-2xl" />
      </template>

      <template v-else-if="report">
        <section class="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Ringkasan Keuangan">
          <div class="rounded-2xl border bg-card p-4 shadow-sm">
            <p class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Wallet class="size-3.5 text-emerald-700" /> Posisi Kas Saat Ini</p>
            <MoneyText :value="report.data.cashPosition" tone="none" class="mt-1 block text-2xl font-extrabold" />
          </div>
          <div class="rounded-2xl border bg-card p-4 shadow-sm">
            <p class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><TrendingUp class="size-3.5 text-emerald-700" /> Pemasukan Terbesar</p>
            <template v-if="report.data.topIncome[0]">
              <p class="mt-1 truncate text-sm font-semibold text-foreground">{{ report.data.topIncome[0].categoryName }}</p>
              <MoneyText :value="report.data.topIncome[0].amount" tone="income" class="block text-xl font-extrabold" />
            </template>
            <p v-else class="mt-1 text-sm text-muted-foreground">Belum ada data</p>
          </div>
          <div class="rounded-2xl border bg-card p-4 shadow-sm">
            <p class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><TrendingDown class="size-3.5 text-amber-700" /> Pengeluaran Terbesar</p>
            <template v-if="report.data.topExpense[0]">
              <p class="mt-1 truncate text-sm font-semibold text-foreground">{{ report.data.topExpense[0].categoryName }}</p>
              <MoneyText :value="report.data.topExpense[0].amount" tone="expense" class="block text-xl font-extrabold" />
            </template>
            <p v-else class="mt-1 text-sm text-muted-foreground">Belum ada data</p>
          </div>
        </section>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <CardContent class="space-y-2 p-4">
              <h2 class="text-sm font-bold text-foreground">Kategori Pemasukan</h2>
              <div v-for="c in report.data.topIncome" :key="c.categoryId" class="flex items-center justify-between border-b border-border/60 py-1.5 text-sm last:border-0">
                <span class="text-foreground">{{ c.categoryName }}</span>
                <MoneyText :value="c.amount" tone="income" />
              </div>
              <p v-if="!report.data.topIncome.length" class="py-4 text-center text-xs text-muted-foreground">Belum ada data</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent class="space-y-2 p-4">
              <h2 class="text-sm font-bold text-foreground">Kategori Pengeluaran</h2>
              <div v-for="c in report.data.topExpense" :key="c.categoryId" class="flex items-center justify-between border-b border-border/60 py-1.5 text-sm last:border-0">
                <span class="text-foreground">{{ c.categoryName }}</span>
                <MoneyText :value="c.amount" tone="expense" />
              </div>
              <p v-if="!report.data.topExpense.length" class="py-4 text-center text-xs text-muted-foreground">Belum ada data</p>
            </CardContent>
          </Card>
        </div>

        <Card v-if="periodMode === 'all' && trendByYear.length">
          <CardContent class="space-y-6 p-4 sm:p-5">
            <h2 class="text-sm font-bold text-foreground">Rincian Bulanan</h2>

            <div v-for="y in trendByYear" :key="y.year" class="overflow-x-auto">
              <p class="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Tahun {{ y.year }}</p>
              <Table>
                <thead>
                  <tr class="border-b border-border bg-muted/50">
                    <th class="rounded-l-lg px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Bulan</th>
                    <th class="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pemasukan</th>
                    <th class="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pengeluaran</th>
                    <th class="rounded-r-lg px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Selisih</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(m, i) in y.months" :key="m.label" class="border-b border-border/60" :class="i % 2 === 1 ? 'bg-muted/20' : ''">
                    <td class="px-3 py-2 text-sm text-foreground">{{ m.label }}</td>
                    <td class="px-3 py-2 text-right text-sm"><MoneyText :value="m.income" tone="income" /></td>
                    <td class="px-3 py-2 text-right text-sm"><MoneyText :value="m.expense" tone="expense" /></td>
                    <td class="px-3 py-2 text-right text-sm font-medium"><MoneyText :value="m.net" show-sign /></td>
                  </tr>
                  <tr class="bg-primary/5 font-bold">
                    <td class="px-3 py-2.5 text-sm">Total {{ y.year }}</td>
                    <td class="px-3 py-2.5 text-right text-sm"><MoneyText :value="y.totalIncome" tone="income" /></td>
                    <td class="px-3 py-2.5 text-right text-sm"><MoneyText :value="y.totalExpense" tone="expense" /></td>
                    <td class="px-3 py-2.5 text-right text-sm"><MoneyText :value="y.totalNet" show-sign /></td>
                  </tr>
                </tbody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <!-- Buku Kas: same layout as the handwritten cash book (TGL | Keterangan | Masuk | Keluar | Saldo).
             v-if: during a deploy the page can briefly talk to the previous API version (no `ledger`
             yet) -- hide the card instead of crashing the whole public page. -->
        <Card v-if="report.data.ledger">
          <CardContent class="space-y-4 p-4 sm:p-5">
            <div class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <h2 class="text-sm font-bold text-foreground">Buku Kas</h2>
              <p class="text-xs text-muted-foreground">{{ report.period.label }}</p>
            </div>
            <div class="overflow-x-auto">
              <Table>
                <thead>
                  <tr class="border-b border-border bg-muted/50">
                    <th class="rounded-l-lg px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tanggal</th>
                    <th class="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Keterangan</th>
                    <th class="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Masuk</th>
                    <th class="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Keluar</th>
                    <th class="rounded-r-lg px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  <tr class="border-b border-border bg-muted/30 font-semibold">
                    <td class="px-3 py-2"></td>
                    <td class="px-3 py-2 text-sm text-foreground">Saldo awal</td>
                    <td class="px-3 py-2"></td>
                    <td class="px-3 py-2"></td>
                    <td class="px-3 py-2 text-right text-sm"><MoneyText :value="report.data.ledger.openingBalance" tone="none" /></td>
                  </tr>
                  <tr v-if="!report.data.ledger.entries.length">
                    <td colspan="5" class="px-3 py-10 text-center text-sm text-muted-foreground">Belum ada transaksi kas pada periode ini.</td>
                  </tr>
                  <tr v-for="(e, i) in report.data.ledger.entries" :key="i" class="border-b border-border/60" :class="i % 2 === 1 ? 'bg-muted/20' : ''">
                    <td class="whitespace-nowrap px-3 py-2 text-sm tabular-nums text-muted-foreground">{{ formatLedgerDate(e.date) }}</td>
                    <td class="min-w-[180px] px-3 py-2 text-sm text-foreground">{{ e.keterangan }}</td>
                    <td class="whitespace-nowrap px-3 py-2 text-right text-sm"><MoneyText v-if="Number(e.masuk) > 0" :value="e.masuk" tone="income" /></td>
                    <td class="whitespace-nowrap px-3 py-2 text-right text-sm"><MoneyText v-if="Number(e.keluar) > 0" :value="e.keluar" tone="expense" /></td>
                    <td class="whitespace-nowrap px-3 py-2 text-right text-sm font-medium"><MoneyText :value="e.saldo" tone="none" /></td>
                  </tr>
                  <tr class="border-t-2 border-border bg-primary/5 font-bold">
                    <td class="px-3 py-2.5"></td>
                    <td class="px-3 py-2.5 text-sm">Jumlah</td>
                    <td class="whitespace-nowrap px-3 py-2.5 text-right text-sm"><MoneyText :value="report.data.ledger.totalMasuk" tone="income" /></td>
                    <td class="whitespace-nowrap px-3 py-2.5 text-right text-sm"><MoneyText :value="report.data.ledger.totalKeluar" tone="expense" /></td>
                    <td class="whitespace-nowrap px-3 py-2.5 text-right text-sm"><MoneyText :value="report.data.ledger.closingBalance" tone="none" /></td>
                  </tr>
                </tbody>
              </Table>
            </div>
            <p v-if="report.data.ledger.truncated" class="text-xs italic text-muted-foreground">
              Hanya {{ report.data.ledger.entries.length }} baris pertama yang ditampilkan — persempit periode untuk melihat sisanya.
            </p>
            <p v-if="report.data.ledger.descriptionsVisible" class="text-xs text-muted-foreground">
              Nama pribadi pada keterangan disamarkan untuk menjaga privasi.
            </p>
          </CardContent>
        </Card>

        <p class="rounded-2xl border bg-card px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          Detail internal seperti nomor bukti, nama akun, dan catatan audit sengaja tidak dipublikasikan untuk menjaga privasi. Angka berasal dari transaksi yang sudah diposting.
        </p>
      </template>
    </div>

    <!-- DOKUMEN CETAK. Tidak tampil di layar; saat Ctrl+P / "Cetak Laporan" inilah yang tercetak:
         markup tabel polos (tanpa kartu, bayangan, sudut membulat) supaya terbaca seperti
         laporan keuangan resmi, bukan "halaman web yang dicetak". -->
    <article v-if="printable && report" class="pd">
      <header class="pd-kop" :class="{ 'pd-kop--logo': report.mosque.logoUrl }">
        <img v-if="report.mosque.logoUrl" :src="report.mosque.logoUrl" alt="" class="pd-kop-img" />
        <div>
          <p class="pd-kop-org">{{ report.mosque.name || 'Lembaga' }}</p>
          <p class="pd-kop-sub">Sistem Tata Kelola &amp; Laporan Transparansi Keuangan Terpadu</p>
        </div>
        <span v-if="report.mosque.logoUrl" aria-hidden="true" />
      </header>

      <div class="pd-title">
        <h2>Laporan Transparansi Keuangan</h2>
        <p>Periode: <strong>{{ report.period.label }}</strong></p>
      </div>

      <!-- Ringkasan kas: Saldo awal + Pemasukan - Pengeluaran = Saldo akhir -->
      <section v-if="report.data.ledger" class="pd-summary pd-keep" aria-label="Ringkasan Kas">
        <div class="pd-stat pd-stat--open">
          <span class="pd-stat-label">Saldo Awal</span>
          <span class="pd-stat-value">{{ fmtRp(report.data.ledger.openingBalance) }}</span>
        </div>
        <span class="pd-op" aria-hidden="true">+</span>
        <div class="pd-stat pd-stat--in">
          <span class="pd-stat-label">Total Pemasukan</span>
          <span class="pd-stat-value">{{ fmtRp(report.data.ledger.totalMasuk) }}</span>
        </div>
        <span class="pd-op" aria-hidden="true">−</span>
        <div class="pd-stat pd-stat--out">
          <span class="pd-stat-label">Total Pengeluaran</span>
          <span class="pd-stat-value">{{ fmtRp(report.data.ledger.totalKeluar) }}</span>
        </div>
        <span class="pd-op" aria-hidden="true">=</span>
        <div class="pd-stat pd-stat--close">
          <span class="pd-stat-label">Saldo Akhir</span>
          <span class="pd-stat-value">{{ fmtRp(report.data.ledger.closingBalance) }}</span>
        </div>
      </section>
      <section v-else class="pd-summary pd-summary--single pd-keep" aria-label="Ringkasan Kas">
        <div class="pd-stat pd-stat--close">
          <span class="pd-stat-label">Posisi Kas Saat Ini</span>
          <span class="pd-stat-value">{{ fmtRp(report.data.cashPosition) }}</span>
        </div>
      </section>

      <!-- Dari mana uang masuk dan ke mana dipakai -->
      <section class="pd-cols pd-keep">
        <div>
          <h3 class="pd-h">Pemasukan Terbesar per Kategori</h3>
          <table class="pd-table">
            <thead>
              <tr>
                <th scope="col" class="pd-no">No</th>
                <th scope="col">Kategori</th>
                <th scope="col" class="pd-r">Jumlah (Rp)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(c, i) in report.data.topIncome" :key="c.categoryId" :class="{ 'pd-alt': i % 2 === 1 }">
                <td class="pd-no">{{ i + 1 }}</td>
                <td>{{ c.categoryName }}</td>
                <td class="pd-r pd-in">{{ fmtNum(c.amount) }}</td>
              </tr>
              <tr v-if="!report.data.topIncome.length">
                <td colspan="3" class="pd-empty">Belum ada data</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h3 class="pd-h">Pengeluaran Terbesar per Kategori</h3>
          <table class="pd-table">
            <thead>
              <tr>
                <th scope="col" class="pd-no">No</th>
                <th scope="col">Kategori</th>
                <th scope="col" class="pd-r">Jumlah (Rp)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(c, i) in report.data.topExpense" :key="c.categoryId" :class="{ 'pd-alt': i % 2 === 1 }">
                <td class="pd-no">{{ i + 1 }}</td>
                <td>{{ c.categoryName }}</td>
                <td class="pd-r pd-out">{{ fmtNum(c.amount) }}</td>
              </tr>
              <tr v-if="!report.data.topExpense.length">
                <td colspan="3" class="pd-empty">Belum ada data</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- "Semua Data": rekap per tahun + rincian tiap bulan -->
      <template v-if="periodMode === 'all' && trendByYear.length">
        <section class="pd-section pd-keep">
          <h3 class="pd-h">Rekapitulasi per Tahun</h3>
          <table class="pd-table">
            <thead>
              <tr>
                <th scope="col">Tahun Buku</th>
                <th scope="col" class="pd-r">Pemasukan (Rp)</th>
                <th scope="col" class="pd-r">Pengeluaran (Rp)</th>
                <th scope="col" class="pd-r">Selisih (Rp)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(y, i) in trendByYear" :key="y.year" :class="{ 'pd-alt': i % 2 === 1 }">
                <td>Tahun {{ y.year }}</td>
                <td class="pd-r" :class="amountClass(y.totalIncome, 'in')">{{ fmtNum(y.totalIncome) }}</td>
                <td class="pd-r" :class="amountClass(y.totalExpense, 'out')">{{ fmtNum(y.totalExpense) }}</td>
                <td class="pd-r" :class="amountClass(y.totalNet, 'net')">{{ fmtNum(y.totalNet, true) }}</td>
              </tr>
              <tr class="pd-total">
                <td>Akumulasi Seluruh Waktu</td>
                <td class="pd-r" :class="amountClass(trendTotals.income, 'in')">{{ fmtNum(trendTotals.income) }}</td>
                <td class="pd-r" :class="amountClass(trendTotals.expense, 'out')">{{ fmtNum(trendTotals.expense) }}</td>
                <td class="pd-r" :class="amountClass(trendTotals.net, 'net')">{{ fmtNum(trendTotals.net, true) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="recapGapText" class="pd-note">
            Rekapitulasi dihitung dari kategori pemasukan dan pengeluaran, sedangkan Buku Kas mencatat seluruh
            pergerakan kas (termasuk saldo awal dan transaksi non-operasional). Selisih total: {{ recapGapText }}.
          </p>
        </section>

        <section class="pd-years" :class="{ 'pd-years--single': trendByYear.length === 1 }">
          <div v-for="y in trendByYear" :key="y.year" class="pd-keep">
            <h3 class="pd-h">Rincian Bulanan {{ y.year }} <span class="pd-h-note">dalam Rp</span></h3>
            <table class="pd-table">
              <thead>
                <tr>
                  <th scope="col">Bulan</th>
                  <th scope="col" class="pd-r">Masuk</th>
                  <th scope="col" class="pd-r">Keluar</th>
                  <th scope="col" class="pd-r">Selisih</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(m, i) in y.months" :key="m.label" :class="{ 'pd-alt': i % 2 === 1 }">
                  <td>{{ m.label }}</td>
                  <td class="pd-r" :class="amountClass(m.income, 'in')">{{ fmtNum(m.income) }}</td>
                  <td class="pd-r" :class="amountClass(m.expense, 'out')">{{ fmtNum(m.expense) }}</td>
                  <td class="pd-r" :class="amountClass(m.net, 'net')">{{ fmtNum(m.net, true) }}</td>
                </tr>
                <tr class="pd-total">
                  <td>Total {{ y.year }}</td>
                  <td class="pd-r" :class="amountClass(y.totalIncome, 'in')">{{ fmtNum(y.totalIncome) }}</td>
                  <td class="pd-r" :class="amountClass(y.totalExpense, 'out')">{{ fmtNum(y.totalExpense) }}</td>
                  <td class="pd-r" :class="amountClass(y.totalNet, 'net')">{{ fmtNum(y.totalNet, true) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>

      <!-- Buku Kas: format buku kas tulis (Tanggal | Keterangan | Masuk | Keluar | Saldo) -->
      <section v-if="report.data.ledger" class="pd-section pd-ledger">
        <h3 class="pd-h">Buku Kas <span class="pd-h-note">{{ report.period.label }} · dalam Rp</span></h3>
        <table class="pd-table pd-table--ledger">
          <colgroup>
            <col class="pd-col-date" />
            <col />
            <col class="pd-col-num" />
            <col class="pd-col-num" />
            <col class="pd-col-num" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Tanggal</th>
              <th scope="col">Keterangan</th>
              <th scope="col" class="pd-r">Masuk</th>
              <th scope="col" class="pd-r">Keluar</th>
              <th scope="col" class="pd-r">Saldo</th>
            </tr>
          </thead>
          <tbody v-for="g in ledgerGroups" :key="g.key" :class="{ 'pd-keep': g.keep }">
            <tr v-if="g.opening" class="pd-open">
              <td></td>
              <td>Saldo awal</td>
              <td></td>
              <td></td>
              <td class="pd-r" :class="{ 'pd-neg': Number(report.data.ledger.openingBalance) < 0 }">{{ fmtNum(report.data.ledger.openingBalance) }}</td>
            </tr>
            <tr v-if="g.key === 'all' && !g.rows.length">
              <td colspan="5" class="pd-empty">Belum ada transaksi kas pada periode ini.</td>
            </tr>
            <tr v-for="(e, i) in g.rows" :key="g.key + i" :class="{ 'pd-alt': e.alt }">
              <td class="pd-date">{{ formatLedgerDate(e.date) }}</td>
              <td class="pd-desc">{{ e.keterangan }}</td>
              <td class="pd-r pd-in">{{ Number(e.masuk) > 0 ? fmtNum(e.masuk) : '' }}</td>
              <td class="pd-r pd-out">{{ Number(e.keluar) > 0 ? fmtNum(e.keluar) : '' }}</td>
              <td class="pd-r pd-saldo" :class="{ 'pd-neg': Number(e.saldo) < 0 }">{{ fmtNum(e.saldo) }}</td>
            </tr>
            <tr v-if="g.total" class="pd-total">
              <td></td>
              <td>Jumlah</td>
              <td class="pd-r" :class="amountClass(report.data.ledger.totalMasuk, 'in')">{{ fmtNum(report.data.ledger.totalMasuk) }}</td>
              <td class="pd-r" :class="amountClass(report.data.ledger.totalKeluar, 'out')">{{ fmtNum(report.data.ledger.totalKeluar) }}</td>
              <td class="pd-r" :class="{ 'pd-neg': Number(report.data.ledger.closingBalance) < 0 }">{{ fmtNum(report.data.ledger.closingBalance) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="report.data.ledger.truncated" class="pd-note">
          Hanya {{ report.data.ledger.entries.length }} baris pertama yang ditampilkan — persempit periode untuk melihat sisanya.
        </p>
        <p v-if="report.data.ledger.descriptionsVisible" class="pd-note">
          Nama pribadi pada keterangan disamarkan untuk menjaga privasi.
        </p>
      </section>

      <p class="pd-note pd-note--block">
        Catatan: angka berasal dari transaksi yang sudah diposting. Detail internal seperti nomor bukti, nama akun,
        dan catatan audit sengaja tidak dipublikasikan untuk menjaga privasi.
      </p>

      <!-- Pengesahan -->
      <section class="pd-sign pd-keep">
        <p class="pd-sign-date">Ditetapkan pada: {{ printDate }}</p>
        <div class="pd-sign-row">
          <div>
            <p class="pd-sign-role">Mengetahui,<br />Pimpinan / Ketua Lembaga</p>
            <p class="pd-sign-name">{{ leaderName }}</p>
          </div>
          <div>
            <p class="pd-sign-role">Pengelola Keuangan,<br />Bendahara</p>
            <p class="pd-sign-name">{{ treasurerName }}</p>
          </div>
        </div>
      </section>

      <footer class="pd-foot">
        <span>Diterbitkan secara sah melalui platform MizanMu &middot; Tautan verifikasi: {{ verifyUrl }}</span>
        <span>Dokumen Sah</span>
      </footer>
    </article>
  </main>
</template>

<style>
/* ---------------------------------------------------------------------------
 * CETAK (Ctrl+P / tombol "Cetak Laporan")
 * Di layar dipakai UI kartu (.screen-only). Saat dicetak UI itu disembunyikan dan yang
 * keluar adalah dokumen terpisah (.pd): tabel polos, garis tipis, tanpa bayangan atau
 * sudut membulat -- bentuknya laporan keuangan, bukan tangkapan halaman web.
 * ------------------------------------------------------------------------- */
@media screen {
  .pd {
    display: none !important;
  }
}

@page {
  size: A4 portrait;
  margin: 14mm 13mm 17mm;

  /* Nomor halaman (Chrome 131+; browser lain mengabaikan blok ini). */
  @bottom-center {
    content: 'Halaman ' counter(page) ' dari ' counter(pages);
    font: 8pt Arial, 'Helvetica Neue', Helvetica, sans-serif;
    color: #6b7280;
  }
}

@media print {
  html,
  body {
    background: #ffffff !important;
    color: #111827 !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  [data-sonner-toaster] {
    display: none !important;
  }

  .pd-root {
    background: #ffffff !important;
    padding: 0 !important;
    min-height: 0 !important;
  }

  .pd-root.pd-has-doc > .screen-only {
    display: none !important;
  }

  .pd {
    display: block;
    font-family: Arial, 'Helvetica Neue', Helvetica, 'Liberation Sans', sans-serif;
    font-size: 9pt;
    line-height: 1.4;
    color: #111827;
  }

  .pd *,
  .pd *::before,
  .pd *::after {
    box-sizing: border-box;
  }

  .pd p,
  .pd h2,
  .pd h3 {
    margin: 0;
  }

  .pd-keep {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  /* ---- Kop surat ---- */
  .pd-kop {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    padding-bottom: 9px;
    margin-bottom: 15px;
    text-align: center;
    border-bottom: 3.5pt double #111827;
  }

  .pd-kop--logo {
    grid-template-columns: 22mm minmax(0, 1fr) 22mm;
    column-gap: 4mm;
  }

  .pd-kop-img {
    width: 21mm;
    height: 21mm;
    object-fit: contain;
  }

  .pd-kop-org {
    font-family: 'Times New Roman', Times, 'Liberation Serif', Georgia, serif;
    font-size: 18pt;
    font-weight: 700;
    line-height: 1.15;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: #065f46;
  }

  .pd-kop-sub {
    margin-top: 4px;
    font-size: 7.2pt;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #4b5563;
  }

  /* ---- Judul ---- */
  .pd-title {
    margin-bottom: 15px;
    text-align: center;
  }

  .pd-title h2 {
    font-family: 'Times New Roman', Times, 'Liberation Serif', Georgia, serif;
    font-size: 14pt;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .pd-title p {
    margin-top: 3px;
    font-size: 9.5pt;
    color: #374151;
  }

  .pd-title p strong {
    color: #111827;
  }

  .pd-title::after {
    content: '';
    display: block;
    width: 26mm;
    height: 1.6pt;
    margin: 8px auto 0;
    background: #065f46;
  }

  /* ---- Ringkasan kas ---- */
  .pd-summary {
    display: grid;
    grid-template-columns: 1fr auto 1fr auto 1fr auto 1fr;
    align-items: stretch;
    margin-bottom: 16px;
  }

  .pd-summary--single {
    grid-template-columns: minmax(0, 1fr);
  }

  .pd-stat {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    padding: 7px 9px 8px;
    border: 0.6pt solid #cfd6d3;
    border-top: 2.6pt solid var(--pd-accent, #9ca3af);
    background: #ffffff;
  }

  .pd-stat--open {
    --pd-accent: #9ca3af;
  }

  .pd-stat--in {
    --pd-accent: #047857;
  }

  .pd-stat--out {
    --pd-accent: #b45309;
  }

  .pd-stat--close {
    --pd-accent: #065f46;
    background: #ecfdf5;
  }

  .pd-stat-label {
    font-size: 6.6pt;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #4b5563;
  }

  .pd-stat-value {
    font-size: 11pt;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: #111827;
  }

  .pd-stat--in .pd-stat-value {
    color: #047857;
  }

  .pd-stat--out .pd-stat-value {
    color: #b45309;
  }

  .pd-stat--close .pd-stat-value {
    color: #065f46;
  }

  .pd-op {
    align-self: center;
    padding: 0 5px;
    font-size: 12pt;
    font-weight: 700;
    color: #9ca3af;
  }

  /* ---- Judul bagian ---- */
  .pd-h {
    margin-bottom: 5px;
    padding-bottom: 3px;
    font-size: 8pt;
    font-weight: 800;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: #065f46;
    border-bottom: 1.4pt solid #065f46;
    break-after: avoid;
    page-break-after: avoid;
  }

  .pd-h-note {
    float: right;
    font-size: 7pt;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: none;
    color: #6b7280;
  }

  .pd-section {
    margin-bottom: 16px;
  }

  .pd-cols,
  .pd-years {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    column-gap: 7mm;
    align-items: start;
    margin-bottom: 16px;
  }

  .pd-years {
    row-gap: 14px;
  }

  .pd-years--single {
    grid-template-columns: minmax(0, 1fr);
  }

  /* ---- Tabel ---- */
  .pd-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 8.6pt;
  }

  .pd-table th {
    padding: 4px 6px;
    font-size: 6.8pt;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-align: left;
    text-transform: uppercase;
    white-space: nowrap;
    color: #374151;
    background: #f1f3f2;
    border-top: 1pt solid #111827;
    border-bottom: 0.6pt solid #111827;
  }

  .pd-table td {
    padding: 3.4px 6px;
    vertical-align: top;
    border-bottom: 0.4pt solid #d5dbd8;
  }

  .pd-table .pd-r {
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .pd-table .pd-no {
    width: 8mm;
    text-align: center;
    color: #6b7280;
  }

  .pd-alt td {
    background: #f7f9f8;
  }

  .pd-in {
    color: #047857;
  }

  .pd-out {
    color: #b45309;
  }

  .pd-pos {
    color: #047857;
  }

  .pd-neg {
    color: #b91c1c;
  }

  .pd-zero {
    font-weight: 400;
    color: #9ca3af;
  }

  .pd-empty {
    padding: 10px 6px !important;
    text-align: center;
    font-style: italic;
    color: #6b7280;
  }

  .pd-open td,
  .pd-total td {
    font-weight: 700;
    background: #eef2f0;
  }

  .pd-open td {
    border-bottom: 0.6pt solid #9ca3af;
  }

  .pd-total td {
    padding-top: 5px;
    padding-bottom: 5px;
    font-weight: 800;
    border-top: 1.2pt solid #111827;
    border-bottom: 3pt double #111827;
  }

  /* ---- Buku Kas: header tabel ikut tercetak di tiap halaman, baris tidak terpotong ---- */
  .pd-table--ledger {
    table-layout: fixed;
  }

  .pd-table--ledger thead {
    display: table-header-group;
  }

  .pd-table--ledger tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .pd-col-date {
    width: 21mm;
  }

  .pd-col-num {
    width: 27mm;
  }

  .pd-date {
    white-space: nowrap;
    font-size: 8pt;
    color: #4b5563;
  }

  .pd-desc {
    overflow-wrap: anywhere;
  }

  .pd-saldo {
    font-weight: 700;
  }

  .pd-note {
    margin-top: 5px;
    font-size: 7.4pt;
    font-style: italic;
    color: #6b7280;
  }

  .pd-note--block {
    margin: 0 0 4px;
    font-style: normal;
    line-height: 1.5;
  }

  /* ---- Pengesahan ---- */
  .pd-sign {
    margin-top: 20px;
    font-size: 9pt;
  }

  .pd-sign-date {
    margin-bottom: 14px;
    text-align: right;
  }

  .pd-sign-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 16mm;
    text-align: center;
  }

  .pd-sign-role {
    min-height: 11mm;
    font-weight: 700;
    line-height: 1.35;
  }

  .pd-sign-name {
    margin-top: 19mm !important;
    font-weight: 700;
    text-decoration: underline;
  }

  .pd-foot {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-top: 16px;
    padding-top: 6px;
    font-size: 7.2pt;
    color: #6b7280;
    border-top: 0.6pt solid #9ca3af;
  }
}
</style>
