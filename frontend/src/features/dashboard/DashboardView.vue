<script setup lang="ts">
import { computed, nextTick, onActivated, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { format, subMonths } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  ChevronRight,
  Download,
  Plus,
  Receipt,
  RefreshCw,
} from 'lucide-vue-next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, clearApiGetCache, formatApiError } from '@/shared/api/client';
import { humanizeSlug, useAuthStore } from '@/features/auth/store';
import { useReferenceDataStore } from '@/shared/stores/reference-data';
import MoneyText from '@/shared/ui/MoneyText.vue';

interface BalanceSheet {
  data: {
    assets: { total: string };
    liabilities: { total: string };
    netAssets: { total: string };
  };
  period: { label: string };
}

interface ActivitySummary {
  data: {
    income: { total: string };
    expense: { total: string };
    surplusDeficit: string;
  };
}

interface MosqueProfile {
  officialName: string | null;
  shortName: string | null;
}

interface EventItem {
  id: string;
  title: string;
  startsAt: string;
  location: string | null;
  status: string;
}

interface FundUsageRow {
  fundCode: string;
  fundName: string;
  fundType: string;
  isRestricted: boolean;
  closingBalance: string;
}

interface FundUsageData {
  data: {
    funds: FundUsageRow[];
    totalClosing: string;
  };
}

interface TxListItem {
  id: string;
  transactionDate: string;
  description: string | null;
  amount: string;
  categoryId: string | null;
  status?: string;
}

interface TxList {
  data: TxListItem[];
}

const auth = useAuthStore();
const refData = useReferenceDataStore();

const kpiLoading = ref(true);
const contentLoading = ref(true);
const chartLoading = ref(true);
const txnLoading = ref(true);
const refreshing = ref(false);
const error = ref<string | null>(null);

const balance = ref<BalanceSheet | null>(null);
const activity = ref<ActivitySummary | null>(null);
const events = ref<EventItem[]>([]);
const mosqueName = ref(auth.tenantDisplayName || 'HisabMu');
const fundUsage = ref<FundUsageData['data'] | null>(null);
const cashFlowMonths = ref<{ month: number; year: number; income: number; expense: number }[]>([]);
const selectedCashFlowKey = ref<string | null>(null);
const cashFlowViewport = ref<HTMLElement | null>(null);
const recentTxns = ref<TxListItem[]>([]);

// Pakai waktu lokal (bukan UTC) supaya "bulan ini" cocok dengan input user di Indonesia.
const now = new Date();
const reportPeriod = ref({ month: now.getMonth() + 1, year: now.getFullYear(), date: now });
const monthName = computed(() => format(reportPeriod.value.date, 'MMMM', { locale: localeId }));
const todayLong = format(now, "EEEE, d MMMM yyyy", { locale: localeId });
const lastLoadedAt = ref<Date | null>(null);
const lastLoadedLabel = computed(() => {
  if (!lastLoadedAt.value) return null;
  return format(lastLoadedAt.value, 'HH:mm');
});

const hasFunds = computed(() => refData.funds.length > 0);

const greetingName = computed(() => {
  const name = auth.user?.name?.trim();
  if (!name) return 'Pengurus';
  // "Pak/Bu" + first word for warmer greeting
  const first = name.split(/\s+/)[0];
  return first;
});

const incomeNum = computed(() => Number(activity.value?.data.income.total ?? 0));
const expenseNum = computed(() => Number(activity.value?.data.expense.total ?? 0));
const surplusNum = computed(() => Number(activity.value?.data.surplusDeficit ?? 0));
const surplusPositive = computed(() => surplusNum.value >= 0);

// ─── Fund cards + donut ────────────────────────────────────────────────────
interface FundAccent {
  /** Garis aksen atas kartu */
  top: string;
  /** Bar sparkline (muted + last solid) */
  spark: string;
  sparkLast: string;
  /** Warna donut */
  conic: string;
  /** Shadow glow hover (CSS color) */
  glow: string;
}

const FUND_ACCENT: Record<string, FundAccent> = {
  umum: {
    top: 'bg-sky-400',
    spark: 'bg-sky-200',
    sparkLast: 'bg-sky-500',
    conic: '#0ea5e9',
    glow: 'rgba(14, 165, 233, 0.28)',
  },
  infaq_sedekah: {
    top: 'bg-emerald-500',
    spark: 'bg-emerald-200',
    sparkLast: 'bg-emerald-700',
    conic: '#059669',
    glow: 'rgba(5, 150, 105, 0.28)',
  },
  zakat: {
    top: 'bg-amber-400',
    spark: 'bg-amber-200',
    sparkLast: 'bg-amber-500',
    conic: '#f59e0b',
    glow: 'rgba(245, 158, 11, 0.32)',
  },
  wakaf: {
    top: 'bg-violet-500',
    spark: 'bg-violet-200',
    sparkLast: 'bg-violet-500',
    conic: '#8b5cf6',
    glow: 'rgba(139, 92, 246, 0.28)',
  },
  amil: {
    top: 'bg-blue-500',
    spark: 'bg-blue-200',
    sparkLast: 'bg-blue-500',
    conic: '#3b82f6',
    glow: 'rgba(59, 130, 246, 0.28)',
  },
  nonhalal: {
    top: 'bg-slate-400',
    spark: 'bg-slate-200',
    sparkLast: 'bg-slate-500',
    conic: '#94a3b8',
    glow: 'rgba(100, 116, 139, 0.22)',
  },
};

const FALLBACK_ACCENTS: FundAccent[] = [
  {
    top: 'bg-sky-400',
    spark: 'bg-sky-200',
    sparkLast: 'bg-sky-500',
    conic: '#0ea5e9',
    glow: 'rgba(14, 165, 233, 0.28)',
  },
  {
    top: 'bg-emerald-500',
    spark: 'bg-emerald-200',
    sparkLast: 'bg-emerald-700',
    conic: '#059669',
    glow: 'rgba(5, 150, 105, 0.28)',
  },
  {
    top: 'bg-amber-400',
    spark: 'bg-amber-200',
    sparkLast: 'bg-amber-500',
    conic: '#f59e0b',
    glow: 'rgba(245, 158, 11, 0.32)',
  },
  {
    top: 'bg-violet-500',
    spark: 'bg-violet-200',
    sparkLast: 'bg-violet-500',
    conic: '#8b5cf6',
    glow: 'rgba(139, 92, 246, 0.28)',
  },
];

function accentFor(fundType: string, index: number): FundAccent {
  return FUND_ACCENT[fundType] ?? FALLBACK_ACCENTS[index % FALLBACK_ACCENTS.length]!;
}

const fundTotal = computed(() => Math.max(Number(fundUsage.value?.totalClosing ?? 0), 1));

const fundIdByCode = computed(() => {
  const m = new Map<string, string>();
  for (const f of refData.funds) m.set(f.code, f.id);
  return m;
});

const fundRows = computed(() =>
  (fundUsage.value?.funds ?? []).map((f, i) => {
    const accent = accentFor(f.fundType, i);
    const bal = Number(f.closingBalance);
    const pct = Math.max(0, Math.round((bal / fundTotal.value) * 100));
    // Mini sparkline heights — proportional pattern from share of total
    const base = Math.max(pct / 100, 0.12);
    const spark = [0.45, 0.7, 0.55, 0.85, 0.6, 1].map((m) => Math.round(10 + base * m * 18));
    const hint =
      f.fundType === 'umum'
        ? 'kas & bank'
        : f.fundType === 'infaq_sedekah'
          ? 'termasuk kotak amal'
          : f.fundType === 'zakat'
            ? 'wajib tersalurkan'
            : f.isRestricted
              ? 'dana terikat'
              : 'saldo aktif';
    const fundId = fundIdByCode.value.get(f.fundCode) ?? null;
    return {
      ...f,
      fundId,
      accent,
      pct,
      spark,
      hint,
      detailTo: fundId
        ? {
            path: '/reports',
            query: {
              type: 'buku-dana',
              fundId,
              month: String(reportPeriod.value.month),
              year: String(reportPeriod.value.year),
            },
          }
        : null,
    };
  }),
);

const fundCount = computed(() => fundRows.value.length || refData.funds.length || 0);

const donutArcs = computed(() => {
  const rows = fundRows.value;
  const r = 36;
  const C = 2 * Math.PI * r;
  if (rows.length === 0) {
    return [{ color: '#34d399', dasharray: `${C} 0`, dashoffset: C * 0.25 }];
  }
  let consumed = 0;
  return rows.map((row) => {
    const share = Math.max(Number(row.closingBalance), 0) / fundTotal.value;
    const len = share * C;
    const dashoffset = C * 0.25 - consumed;
    consumed += len;
    return {
      color: row.accent.conic,
      dasharray: `${len} ${C - len}`,
      dashoffset,
    };
  });
});

// ─── Cashflow chart ────────────────────────────────────────────────────────
function fmtRupiah(n: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n);
}

function compactAmount(value: number, withCurrency = true): string {
  const absolute = Math.abs(value);
  const units = [
    { threshold: 1_000_000_000, divisor: 1_000_000_000, suffix: 'miliar' },
    { threshold: 1_000_000, divisor: 1_000_000, suffix: 'jt' },
    { threshold: 1_000, divisor: 1_000, suffix: 'rb' },
  ];
  const unit = units.find((item) => absolute >= item.threshold);
  const amount = unit ? absolute / unit.divisor : absolute;
  const formatted = new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: amount < 100 && !Number.isInteger(amount) ? 1 : 0,
  }).format(amount);
  return `${withCurrency ? 'Rp ' : ''}${formatted}${unit ? ` ${unit.suffix}` : ''}`;
}

const NUMBER_WORDS = [
  'nol',
  'satu',
  'dua',
  'tiga',
  'empat',
  'lima',
  'enam',
  'tujuh',
  'delapan',
  'sembilan',
  'sepuluh',
  'sebelas',
  'dua belas',
];

function cashFlowKey(monthValue: number, yearValue: number): string {
  return `${yearValue}-${String(monthValue).padStart(2, '0')}`;
}

function selectCashFlowMonth(key: string): void {
  selectedCashFlowKey.value = key;
}

async function revealLatestCashFlowMonth(): Promise<void> {
  await nextTick();
  const viewport = cashFlowViewport.value;
  if (viewport) viewport.scrollLeft = viewport.scrollWidth;
}

const chartModel = computed(() => {
  const rows = cashFlowMonths.value.map((item) => {
    const income = Number.isFinite(item.income) ? Math.max(0, item.income) : 0;
    const expense = Number.isFinite(item.expense) ? Math.max(0, item.expense) : 0;
    const net = income - expense;
    const date = new Date(item.year, item.month - 1, 1);
    return {
      key: cashFlowKey(item.month, item.year),
      month: item.month,
      year: item.year,
      income,
      expense,
      net,
      label: format(date, 'MMM', { locale: localeId }),
      fullLabel: format(date, 'MMMM yyyy', { locale: localeId }),
    };
  });

  const selected = rows.find((row) => row.key === selectedCashFlowKey.value) ?? rows.at(-1) ?? null;
  const max = Math.max(...rows.flatMap((row) => [row.income, row.expense]), 1);
  const bars = rows.map((row) => {
    const inH = row.income > 0 ? Math.max(5, Math.round((row.income / max) * 92)) : 0;
    const outH = row.expense > 0 ? Math.max(5, Math.round((row.expense / max) * 92)) : 0;
    const status = row.net > 0 ? 'surplus' : row.net < 0 ? 'defisit' : 'impas';
    const sign = row.net > 0 ? '+' : row.net < 0 ? '−' : '';
    return {
      ...row,
      isActive: row.key === selected?.key,
      inH,
      outH,
      labelBottom: Math.max(inH, outH) + 5,
      status,
      netLabel: `${sign}${compactAmount(row.net, false)}`,
      inTitle: `Pemasukan ${row.fullLabel}: ${fmtRupiah(row.income)}`,
      outTitle: `Pengeluaran ${row.fullLabel}: ${fmtRupiah(row.expense)}`,
      ariaLabel: `${row.fullLabel}, pemasukan ${fmtRupiah(row.income)}, pengeluaran ${fmtRupiah(row.expense)}, ${status} ${fmtRupiah(Math.abs(row.net))}`,
    };
  });

  const first = rows[0];
  const latest = rows.at(-1) ?? null;
  const range = first && latest
    ? `${format(new Date(cashFlowMonths.value[0]!.year, cashFlowMonths.value[0]!.month - 1, 1), 'MMMM', { locale: localeId })} – ${latest.fullLabel}`
    : '';
  const positiveCount = rows.filter((row) => row.net > 0).length;
  const negativeCount = rows.filter((row) => row.net < 0).length;
  const totalNet = rows.reduce((total, row) => total + row.net, 0);
  const countText = NUMBER_WORDS[rows.length] ?? String(rows.length);
  let trend = `${positiveCount} dari ${rows.length} bulan surplus`;
  if (rows.length > 0 && positiveCount === rows.length) trend = `${countText} bulan berturut surplus`;
  if (rows.length > 0 && negativeCount === rows.length) trend = `${countText} bulan berturut defisit`;
  const totalLabel = `${totalNet < 0 ? '−' : ''}${compactAmount(totalNet)}`;

  return {
    bars,
    selected,
    subtitle: rows.length ? `${range} · ${trend}, ${positiveCount === rows.length || negativeCount === rows.length ? 'total' : 'net'} ${totalLabel}` : '',
  };
});

// ─── Transactions ──────────────────────────────────────────────────────────
function categoryFor(id: string | null) {
  return id ? refData.categories.find((c) => c.id === id) : undefined;
}

const TX_DIAMONDS = ['bg-emerald-600', 'bg-sky-500', 'bg-amber-500', 'bg-blue-500', 'bg-violet-500'];

const recentTxnRows = computed(() =>
  recentTxns.value.map((t, i) => {
    const cat = categoryFor(t.categoryId);
    const direction = cat?.direction ?? null;
    return {
      id: t.id,
      desc: t.description || cat?.name || 'Transaksi',
      catName: cat?.name ?? '—',
      date: format(new Date(t.transactionDate), 'dd MMM', { locale: localeId }),
      amount: t.amount,
      direction,
      status: t.status ?? 'draft',
      diamond: TX_DIAMONDS[i % TX_DIAMONDS.length],
    };
  }),
);

// ─── Events ────────────────────────────────────────────────────────────────
function fmtEventParts(s: string): { day: string; mon: string; time: string } {
  const d = new Date(s);
  return {
    day: d.toLocaleDateString('id-ID', { day: '2-digit' }),
    mon: d.toLocaleDateString('id-ID', { month: 'short' }).toUpperCase(),
    time: d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
  };
}

const quickReports = [
  { to: { path: '/reports', query: { type: 'posisi-keuangan' } }, label: 'Laporan Posisi Keuangan' },
  { to: { path: '/reports', query: { type: 'aktivitas' } }, label: 'Laporan Penghasilan Komprehensif' },
  { to: { path: '/reports', query: { type: 'arus-kas' } }, label: 'Laporan Arus Kas' },
];

// KPI fallback when no funds — reuse fund-card accent shape
const kpiFallback = computed(() => {
  const accents = FALLBACK_ACCENTS;
  return [
    {
      key: 'in',
      label: 'Pemasukan',
      value: activity.value?.data.income.total,
      accent: accents[1]!,
      hint: 'bulan ini',
      pct: 100,
    },
    {
      key: 'out',
      label: 'Pengeluaran',
      value: activity.value?.data.expense.total,
      accent: accents[2]!,
      hint: 'bulan ini',
      pct:
        expenseNum.value && incomeNum.value
          ? Math.min(100, Math.round((expenseNum.value / Math.max(incomeNum.value, 1)) * 100))
          : 0,
    },
    {
      key: 'aset',
      label: 'Total Aset',
      value: balance.value?.data.assets.total,
      accent: accents[0]!,
      hint: 'posisi keuangan',
      pct: 100,
    },
    {
      key: 'liab',
      label: 'Kewajiban',
      value: balance.value?.data.liabilities.total,
      accent: accents[3]!,
      hint: 'posisi keuangan',
      pct: balance.value
        ? Math.min(
            100,
            Math.round(
              (Number(balance.value.data.liabilities.total) /
                Math.max(Number(balance.value.data.assets.total), 1)) *
                100,
            ),
          )
        : 0,
    },
  ];
});

function resolveOrgName(profile?: MosqueProfile | null): string {
  // Prioritas: nama resmi profil → short name → nama tenant (DB) → slug cantik
  const fromProfile =
    profile?.officialName?.trim() ||
    profile?.shortName?.trim() ||
    '';
  if (fromProfile) return fromProfile;
  if (auth.tenantName?.trim()) return auth.tenantName.trim();
  if (auth.tenantDisplayName) return auth.tenantDisplayName;
  return humanizeSlug(auth.tenantSlug) || 'HisabMu';
}

const unpostedCount = computed(
  () => recentTxns.value.filter((t) => t.status && t.status !== 'posted').length,
);

/** KeepAlive: onMounted cuma sekali — load diekstrak supaya bisa di-refresh paksa. */
async function loadDashboard(opts?: { silent?: boolean }): Promise<void> {
  const silent = !!opts?.silent;
  clearApiGetCache();
  error.value = null;

  if (!silent) {
    kpiLoading.value = true;
    contentLoading.value = true;
    chartLoading.value = true;
    txnLoading.value = true;
  } else {
    refreshing.value = true;
  }

  mosqueName.value = resolveOrgName();
  void refData.ensureFunds();
  void refData.ensureCategories();

  const loadNow = new Date();
  const fromIso = loadNow.toISOString();
  const currentMonth = loadNow.getMonth() + 1;
  const currentYear = loadNow.getFullYear();
  reportPeriod.value = { month: currentMonth, year: currentYear, date: loadNow };

  const contentP = (async () => {
    try {
      if (!auth.tenantName && auth.tenantSlug) {
        await auth.fetchMe().catch(() => undefined);
      }
      const [ev, profile] = await Promise.all([
        api.get<{ data: EventItem[] }>('/api/v1/events', {
          query: { status: 'published', from: fromIso, limit: 4 },
        }),
        api.get<{ data: MosqueProfile }>('/api/v1/mosque-profile').catch(() => null),
      ]);
      events.value = [...ev.data]
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
        .slice(0, 4);
      mosqueName.value = resolveOrgName(profile?.data ?? null);
    } catch (err) {
      error.value = formatApiError(err, 'Gagal memuat konten dashboard');
      mosqueName.value = resolveOrgName();
    } finally {
      contentLoading.value = false;
    }
  })();

  const kpiP = (async () => {
    try {
      const [bs, act, fu] = await Promise.all([
        api.get<BalanceSheet>('/api/v1/reports/posisi-keuangan', {
          query: { month: currentMonth, year: currentYear },
        }),
        api.get<ActivitySummary>('/api/v1/reports/aktivitas', {
          query: { month: currentMonth, year: currentYear },
        }),
        api
          .get<FundUsageData>('/api/v1/reports/sumber-penggunaan-dana', {
            query: { month: currentMonth, year: currentYear },
          })
          .catch(() => null),
      ]);
      balance.value = bs;
      activity.value = act;
      fundUsage.value = fu?.data ?? null;
    } catch (err) {
      if (!error.value) {
        error.value = formatApiError(err, 'Gagal memuat ringkasan keuangan');
      }
    } finally {
      kpiLoading.value = false;
    }
  })();

  const chartP = (async () => {
    try {
      const monthStart = new Date(currentYear, currentMonth - 1, 1);
      const points = Array.from({ length: 12 }, (_, i) => subMonths(monthStart, 11 - i));
      const results = await Promise.all(
        points.map((d) =>
          api.get<ActivitySummary>('/api/v1/reports/aktivitas', {
            query: { month: d.getMonth() + 1, year: d.getFullYear() },
          }),
        ),
      );
      cashFlowMonths.value = points.map((d, i) => ({
        month: d.getMonth() + 1,
        year: d.getFullYear(),
        income: Number(results[i]!.data.income.total),
        expense: Number(results[i]!.data.expense.total),
      }));
      const availableKeys = new Set(
        cashFlowMonths.value.map((item) => cashFlowKey(item.month, item.year)),
      );
      if (!selectedCashFlowKey.value || !availableKeys.has(selectedCashFlowKey.value)) {
        const latest = cashFlowMonths.value.at(-1);
        selectedCashFlowKey.value = latest ? cashFlowKey(latest.month, latest.year) : null;
      }
      void revealLatestCashFlowMonth();
    } catch {
      cashFlowMonths.value = [];
      selectedCashFlowKey.value = null;
    } finally {
      chartLoading.value = false;
    }
  })();

  const txnP = (async () => {
    try {
      const res = await api.get<TxList>('/api/v1/transactions', { query: { limit: 5 } });
      recentTxns.value = res.data;
    } catch {
      recentTxns.value = [];
    } finally {
      txnLoading.value = false;
    }
  })();

  await Promise.all([contentP, kpiP, chartP, txnP]);
  lastLoadedAt.value = new Date();
  refreshing.value = false;
}

async function forceRefresh(): Promise<void> {
  if (refreshing.value || kpiLoading.value) return;
  await loadDashboard({ silent: true });
}

let mountedOnce = false;
onMounted(() => {
  mountedOnce = true;
  void loadDashboard();
});

// Kembali dari halaman lain (KeepAlive): ambil data baru tanpa skeleton penuh
onActivated(() => {
  if (!mountedOnce) return;
  // Skip first activate right after mount (onMounted already loads)
  if (!lastLoadedAt.value) return;
  void loadDashboard({ silent: true });
});
</script>

<template>
  <div class="flex flex-col gap-5 md:gap-6">
    <!-- ─── Page header ─────────────────────────────────────────────────── -->
    <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0">
        <p class="text-[13px] text-muted-foreground">
          Assalamu&rsquo;alaikum, {{ greetingName }}
          <span class="text-muted-foreground/50"> · </span>
          <span class="capitalize">{{ todayLong }}</span>
        </p>
        <div class="mt-1 flex flex-wrap items-center gap-2.5">
          <h1 class="text-2xl font-extrabold tracking-tight text-foreground md:text-[28px]">
            {{ mosqueName }}
          </h1>
          <span
            class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-700"
          >
            <span class="relative flex size-1.5">
              <span class="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50"></span>
              <span class="relative inline-flex size-1.5 rounded-full bg-emerald-500"></span>
            </span>
            Terverifikasi
          </span>
        </div>
      </div>

      <div class="flex shrink-0 flex-col items-end gap-1">
        <div class="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            class="h-10 gap-1.5 rounded-full border-border/80 bg-card px-3.5 text-sm font-semibold shadow-xs sm:px-4"
            :disabled="refreshing || kpiLoading"
            title="Muat ulang data dashboard (buang cache)"
            @click="forceRefresh"
          >
            <RefreshCw class="size-4" :class="refreshing ? 'animate-spin' : ''" />
            <span class="hidden sm:inline">{{ refreshing ? 'Memuat…' : 'Refresh' }}</span>
          </Button>
          <Button variant="outline" class="h-10 rounded-full border-border/80 bg-card px-4 text-sm font-semibold shadow-xs" as-child>
            <RouterLink to="/reports">
              <Download class="size-4" />
              Unduh Laporan
            </RouterLink>
          </Button>
          <Button class="h-10 rounded-full px-4 text-sm font-semibold shadow-sm" as-child>
            <RouterLink :to="{ path: '/transactions', query: { action: 'create' } }">
              <Plus class="size-4" />
              Catat Transaksi
            </RouterLink>
          </Button>
        </div>
        <p v-if="lastLoadedLabel" class="pr-0.5 text-[10px] tabular-nums text-muted-foreground/80">
          Diperbarui {{ lastLoadedLabel }}
        </p>
      </div>
    </div>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div
      v-if="!kpiLoading && unpostedCount > 0"
      class="rounded-xl border border-amber-200/80 bg-amber-50/70 px-4 py-3 text-sm text-amber-950"
    >
      <p class="font-semibold">
        {{ unpostedCount }} transaksi belum di-posting
      </p>
      <p class="mt-0.5 text-[13px] text-amber-900/80">
        Draft / diajukan / disetujui belum masuk saldo dashboard. Alur:
        <strong>Ajukan → Setujui → Posting</strong>. Hanya status
        <strong>Posted</strong> yang mengisi laporan &amp; kartu dana.
      </p>
      <RouterLink
        to="/transactions"
        class="mt-2 inline-flex text-[13px] font-semibold text-amber-900 underline-offset-2 hover:underline"
      >
        Buka Transaksi →
      </RouterLink>
    </div>

    <!-- ─── Hero: saldo + fund cards ─────────────────────────────────────── -->
    <section class="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1.2fr)]">
      <!-- Dark saldo card -->
      <div class="saldo-card relative overflow-hidden rounded-[22px] text-white shadow-lg shadow-emerald-950/10">
        <div
          aria-hidden="true"
          class="pointer-events-none absolute -right-10 -top-16 size-56 rounded-full bg-emerald-400/15 blur-3xl"
        ></div>
        <div
          aria-hidden="true"
          class="pointer-events-none absolute -bottom-20 right-8 size-48 rotate-12 rounded-[2rem] border border-white/[0.07]"
        ></div>
        <div
          aria-hidden="true"
          class="pointer-events-none absolute right-16 top-10 size-24 rotate-45 rounded-2xl border border-white/[0.06]"
        ></div>

        <div class="relative flex h-full flex-col p-5 md:p-6">
          <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-200/75">
            Saldo Kas · Semua Dana
          </p>

          <template v-if="!kpiLoading && balance">
            <MoneyText
              :value="balance.data.netAssets.total"
              class="mt-2 block text-[34px] font-extrabold tracking-tight text-white md:text-[40px] !text-white"
            />

            <div v-if="activity" class="mt-3 flex flex-wrap items-center gap-2">
              <span
                class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                :class="
                  surplusPositive
                    ? 'bg-emerald-400/20 text-emerald-100'
                    : 'bg-rose-400/20 text-rose-100'
                "
              >
                <component :is="surplusPositive ? ArrowUpRight : ArrowDownRight" class="size-3.5" />
                {{ surplusPositive ? 'Surplus' : 'Defisit' }}
                <MoneyText
                  :value="activity.data.surplusDeficit"
                  show-sign
                  class="font-semibold !text-inherit"
                />
              </span>
              <span class="text-[11px] text-emerald-100/55">bulan ini</span>
            </div>
          </template>
          <Skeleton v-else class="mt-3 h-12 w-56 bg-white/10" />

          <!-- Donut + footers -->
          <div class="mt-auto flex flex-1 flex-col justify-end pt-6">
            <div class="flex justify-center py-2">
              <div class="relative size-[148px]">
                <svg viewBox="0 0 96 96" class="size-full -rotate-0">
                  <circle
                    cx="48"
                    cy="48"
                    r="36"
                    fill="none"
                    stroke="rgba(255,255,255,0.08)"
                    stroke-width="11"
                  />
                  <circle
                    v-for="(arc, i) in donutArcs"
                    :key="i"
                    cx="48"
                    cy="48"
                    r="36"
                    fill="none"
                    :stroke="arc.color"
                    stroke-width="11"
                    stroke-linecap="butt"
                    :stroke-dasharray="arc.dasharray"
                    :stroke-dashoffset="arc.dashoffset"
                    class="transition-all duration-700"
                  />
                </svg>
                <div class="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span class="text-2xl font-extrabold tabular-nums leading-none text-white">
                    {{ fundCount || '—' }}
                  </span>
                  <span class="mt-1 text-[11px] font-medium text-emerald-100/70">
                    {{ hasFunds ? 'Dana Aktif' : 'Ringkasan' }}
                  </span>
                </div>
              </div>
            </div>

            <div class="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
              <div>
                <p class="text-[11px] text-emerald-100/60">Pemasukan {{ monthName }}</p>
                <template v-if="!kpiLoading && activity">
                  <MoneyText
                    :value="activity.data.income.total"
                    class="mt-0.5 block text-sm font-bold !text-emerald-300"
                  />
                </template>
                <Skeleton v-else class="mt-1 h-4 w-24 bg-white/10" />
              </div>
              <div class="text-right">
                <p class="text-[11px] text-emerald-100/60">Pengeluaran {{ monthName }}</p>
                <template v-if="!kpiLoading && activity">
                  <MoneyText
                    :value="activity.data.expense.total"
                    class="mt-0.5 block text-sm font-bold !text-amber-300/95"
                  />
                </template>
                <Skeleton v-else class="mt-1 ml-auto h-4 w-24 bg-white/10" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Fund / KPI cards 2×2 — aksen atas + glow hover -->
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3.5">
        <template v-if="kpiLoading">
          <div
            v-for="i in 4"
            :key="i"
            class="rounded-[18px] border border-[#E2DFD4] bg-white p-4"
          >
            <Skeleton class="mb-4 h-3 w-24" />
            <Skeleton class="mb-2 h-7 w-36" />
            <Skeleton class="h-3 w-28" />
          </div>
        </template>

        <template v-else-if="hasFunds && fundRows.length > 0">
          <component
            :is="f.detailTo ? RouterLink : 'div'"
            v-for="(f, i) in fundRows.slice(0, 4)"
            :key="f.fundCode"
            v-bind="f.detailTo ? { to: f.detailTo } : {}"
            class="fund-card rise group relative flex flex-col overflow-hidden rounded-[18px] border border-[#E2DFD4] bg-white p-4 text-left outline-none transition-[border-color,box-shadow,transform] duration-200"
            :class="
              f.detailTo
                ? 'cursor-pointer hover:-translate-y-0.5 hover:border-emerald-300/80 hover:shadow-[0_12px_28px_-12px_var(--fund-glow)] focus-visible:ring-2 focus-visible:ring-emerald-500/40'
                : ''
            "
            :style="{
              animationDelay: 40 + i * 45 + 'ms',
              '--fund-glow': f.accent.glow,
            }"
            :title="f.detailTo ? `Buka detail ${f.fundName}` : undefined"
          >
            <span
              aria-hidden="true"
              class="absolute inset-x-0 top-0 h-[3px]"
              :class="f.accent.top"
            ></span>

            <div class="flex items-start justify-between gap-2 pt-0.5">
              <p class="text-[13px] font-medium text-[#6B7A72]">{{ f.fundName }}</p>
              <div class="flex shrink-0 items-center gap-1.5">
                <span class="inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums text-emerald-600">
                  <span class="text-[9px] leading-none" aria-hidden="true">▲</span>
                  {{ f.pct.toLocaleString('id-ID') }}%
                </span>
                <span
                  v-if="f.detailTo"
                  class="grid size-6 place-items-center rounded-full border border-[#E2DFD4] bg-[#F7F6F1] text-[#6B7A72] transition-colors group-hover:border-emerald-300 group-hover:bg-emerald-50 group-hover:text-emerald-700"
                  aria-hidden="true"
                >
                  <ChevronRight class="size-3.5" />
                </span>
              </div>
            </div>

            <MoneyText
              :value="f.closingBalance"
              tone="none"
              class="mt-2.5 block text-[22px] font-extrabold tracking-tight text-[#0E1F18] md:text-[24px]"
            />

            <div class="mt-auto flex items-end justify-between gap-3 pt-5">
              <div class="min-w-0">
                <p class="text-[11px] leading-snug text-[#6B7A72]">
                  <span class="font-semibold text-[#0E1F18]/70">{{ f.pct }}%</span>
                  dari total
                  <span class="text-[#6B7A72]/90"> · {{ f.hint }}</span>
                </p>
                <p
                  v-if="f.detailTo"
                  class="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-700/70 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  Lihat mutasi →
                </p>
              </div>
              <div class="flex h-7 shrink-0 items-end gap-[3px]" aria-hidden="true">
                <span
                  v-for="(h, hi) in f.spark"
                  :key="hi"
                  class="w-[3px] rounded-full transition-colors duration-200"
                  :class="hi === f.spark.length - 1 ? f.accent.sparkLast : f.accent.spark"
                  :style="{ height: h + 'px' }"
                ></span>
              </div>
            </div>
          </component>
        </template>

        <template v-else>
          <div
            v-for="(k, i) in kpiFallback"
            :key="k.key"
            class="fund-card rise group relative flex flex-col overflow-hidden rounded-[18px] border border-[#E2DFD4] bg-white p-4"
            :style="{
              animationDelay: 40 + i * 45 + 'ms',
              '--fund-glow': k.accent.glow,
            }"
          >
            <span
              aria-hidden="true"
              class="absolute inset-x-0 top-0 h-[3px]"
              :class="k.accent.top"
            ></span>
            <div class="flex items-start justify-between gap-2 pt-0.5">
              <p class="text-[13px] font-medium text-[#6B7A72]">{{ k.label }}</p>
              <span class="inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums text-emerald-600">
                <span class="text-[9px] leading-none" aria-hidden="true">▲</span>
                {{ k.pct.toLocaleString('id-ID') }}%
              </span>
            </div>
            <MoneyText
              :value="k.value"
              tone="none"
              class="mt-2.5 block text-[22px] font-extrabold tracking-tight text-[#0E1F18] md:text-[24px]"
            />
            <div class="mt-auto flex items-end justify-between gap-3 pt-5">
              <p class="text-[11px] text-[#6B7A72]">{{ k.hint }}</p>
              <div class="flex h-7 shrink-0 items-end gap-[3px]" aria-hidden="true">
                <span
                  v-for="hi in 6"
                  :key="hi"
                  class="w-[3px] rounded-full"
                  :class="hi === 6 ? k.accent.sparkLast : k.accent.spark"
                  :style="{ height: 8 + ((hi * 7 + i * 3) % 16) + 'px' }"
                ></span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </section>

    <!-- ─── Arus kas + Transaksi ─────────────────────────────────────────── -->
    <section class="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
      <div
        class="rise rounded-[20px] border border-border/60 bg-card p-5 shadow-xs"
        :style="{ animationDelay: '80ms' }"
      >
        <div class="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div class="min-w-0">
            <h2 class="text-base font-bold tracking-tight text-foreground">Arus Kas 12 Bulan</h2>
            <p v-if="chartModel.subtitle" class="mt-0.5 text-[11px] text-muted-foreground sm:text-[12px]">
              {{ chartModel.subtitle }}
            </p>
          </div>
          <div class="flex items-center gap-4 text-[11px] font-medium text-muted-foreground">
            <span class="inline-flex items-center gap-1.5">
              <span class="size-2 rounded-full bg-emerald-700" aria-hidden="true"></span>
              Pemasukan
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span class="size-2 rounded-full bg-amber-400" aria-hidden="true"></span>
              Pengeluaran
            </span>
          </div>
        </div>

        <template v-if="chartLoading">
          <div class="overflow-hidden">
            <div class="flex h-[166px] w-max items-end gap-1 px-0.5 xl:w-full xl:gap-1.5">
              <div v-for="i in 12" :key="i" class="flex h-full w-[58px] shrink-0 items-end justify-center gap-1 pb-7 xl:w-auto xl:flex-1 xl:gap-1.5">
                <Skeleton class="w-[10px] rounded-t-md xl:w-3" :style="{ height: 48 + (i % 3) * 22 + 'px' }" />
                <Skeleton class="w-[10px] rounded-t-md xl:w-3" :style="{ height: 30 + (i % 2) * 25 + 'px' }" />
              </div>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-3 border-t border-border/70 pt-3">
            <div v-for="i in 3" :key="i" class="space-y-2">
              <Skeleton class="h-3 w-16" />
              <Skeleton class="h-4 w-20" />
            </div>
          </div>
        </template>

        <template v-else-if="chartModel.bars.length">
          <figure aria-labelledby="cashflow-chart-title">
            <figcaption id="cashflow-chart-title" class="sr-only">
              Perbandingan pemasukan dan pengeluaran dua belas bulan terakhir
            </figcaption>
            <div class="relative -mx-1">
              <div
                ref="cashFlowViewport"
                class="overflow-x-auto overscroll-x-contain px-1 pb-1 outline-none [scroll-snap-type:x_proximity] focus-visible:ring-2 focus-visible:ring-emerald-700/60 focus-visible:ring-offset-2 xl:overflow-visible"
                tabindex="0"
                role="group"
                aria-label="Grafik arus kas 12 bulan. Geser horizontal untuk melihat bulan lainnya."
              >
                <div class="flex h-[166px] w-max items-stretch gap-1 pr-3 xl:w-full xl:gap-1.5 xl:pr-0">
                  <button
                    v-for="b in chartModel.bars"
                    :key="b.key"
                    type="button"
                    class="relative flex w-[58px] shrink-0 cursor-pointer snap-center flex-col items-center justify-end rounded-xl border px-0.5 pb-2 pt-5 outline-none transition-colors hover:bg-[#F7F6F0] focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 xl:w-auto xl:min-w-0 xl:flex-1 xl:px-1"
                    :class="b.isActive ? 'border-emerald-700/10 bg-[#F4F3EC]' : 'border-transparent'"
                    :aria-label="`${b.ariaLabel}. Pilih bulan ini.`"
                    :aria-pressed="b.isActive"
                    @click="selectCashFlowMonth(b.key)"
                  >
                <span
                  class="absolute whitespace-nowrap text-[9px] font-semibold tabular-nums sm:text-[10px]"
                  :class="b.status === 'surplus' ? 'text-emerald-700' : b.status === 'defisit' ? 'text-amber-700' : 'text-muted-foreground'"
                  :style="{ bottom: b.labelBottom + 28 + 'px' }"
                >
                  {{ b.netLabel }}
                </span>
                <div class="flex h-[104px] w-full items-end justify-center gap-1 sm:gap-1.5" aria-hidden="true">
                  <div
                    :title="b.inTitle"
                    class="w-[10px] cursor-default rounded-t-[5px] bg-gradient-to-t from-emerald-800 to-emerald-500 transition-all duration-500 sm:w-3.5"
                    :style="{ height: b.inH + 'px' }"
                  ></div>
                  <div
                    :title="b.outTitle"
                    class="w-[10px] cursor-default rounded-t-[5px] bg-gradient-to-t from-amber-600 to-amber-300 transition-all duration-500 sm:w-3.5"
                    :style="{ height: b.outH + 'px' }"
                  ></div>
                </div>
                <span
                  class="mt-1.5 text-[10px] font-medium capitalize sm:text-[11px]"
                  :class="b.isActive ? 'font-bold text-foreground' : 'text-muted-foreground'"
                >
                  {{ b.label }}
                    </span>
                  </button>
                </div>
              </div>
              <div class="pointer-events-none absolute inset-y-0 left-0 w-4 bg-gradient-to-r from-card to-transparent xl:hidden" aria-hidden="true"></div>
              <div class="pointer-events-none absolute inset-y-0 right-0 w-5 bg-gradient-to-l from-card to-transparent xl:hidden" aria-hidden="true"></div>
            </div>
            <p class="mt-1 text-center text-[10px] text-muted-foreground/80 xl:hidden">
              Geser untuk melihat bulan sebelumnya
            </p>
          </figure>

          <dl v-if="chartModel.selected" aria-live="polite" class="mt-2 grid grid-cols-1 gap-2 border-t border-border/70 pt-3 min-[360px]:grid-cols-3 min-[360px]:gap-3">
            <div class="min-w-0">
              <dt class="text-[10px] text-muted-foreground sm:text-[11px]">Pemasukan {{ chartModel.selected.label }}</dt>
              <dd><MoneyText :value="chartModel.selected.income" tone="income" class="text-[13px] font-bold sm:text-sm" /></dd>
            </div>
            <div class="min-w-0">
              <dt class="text-[10px] text-muted-foreground sm:text-[11px]">Pengeluaran {{ chartModel.selected.label }}</dt>
              <dd><MoneyText :value="chartModel.selected.expense" tone="expense" class="text-[13px] font-bold sm:text-sm" /></dd>
            </div>
            <div class="min-w-0">
              <dt class="text-[10px] text-muted-foreground sm:text-[11px]">
                {{ chartModel.selected.net > 0 ? 'Surplus' : chartModel.selected.net < 0 ? 'Defisit' : 'Impas' }} {{ chartModel.selected.label }}
              </dt>
              <dd>
                <MoneyText
                  :value="chartModel.selected.net"
                  :show-sign="chartModel.selected.net > 0"
                  tone="auto"
                  class="text-[13px] font-bold sm:text-sm"
                />
              </dd>
            </div>
          </dl>
        </template>

        <div v-else class="flex h-[210px] items-center justify-center text-sm text-muted-foreground">
          Belum ada data arus kas
        </div>
      </div>

      <div
        class="rise rounded-[20px] border border-border/60 bg-card p-5 shadow-xs"
        :style="{ animationDelay: '120ms' }"
      >
        <div class="mb-1 flex items-center justify-between gap-2">
          <h2 class="text-base font-bold tracking-tight text-foreground">Transaksi Terbaru</h2>
          <RouterLink
            to="/transactions"
            class="text-[12px] font-semibold text-emerald-700 hover:underline"
          >
            Lihat semua →
          </RouterLink>
        </div>

        <div v-if="txnLoading" class="mt-4 flex flex-col gap-3">
          <Skeleton v-for="i in 5" :key="i" class="h-12 w-full rounded-lg" />
        </div>
        <ul v-else-if="recentTxnRows.length > 0" class="mt-2 divide-y divide-border/70">
          <li
            v-for="t in recentTxnRows"
            :key="t.id"
            class="flex items-center gap-3 py-3 first:pt-2"
          >
            <span
              class="size-2.5 shrink-0 rotate-45 rounded-[2px]"
              :class="t.diamond"
              aria-hidden="true"
            ></span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-[13px] font-semibold text-foreground">{{ t.desc }}</p>
              <p class="truncate text-[11px] text-muted-foreground">
                {{ t.date }} · {{ t.catName }}
                <span
                  v-if="t.status && t.status !== 'posted'"
                  class="ml-1 rounded bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-800"
                >{{ t.status }}</span>
                <span
                  v-else-if="t.status === 'posted'"
                  class="ml-1 rounded bg-emerald-100 px-1.5 py-px text-[10px] font-semibold text-emerald-800"
                >posted</span>
              </p>
            </div>
            <span
              class="shrink-0 text-[13px] font-bold tabular-nums"
              :class="t.direction === 'expense' ? 'text-rose-600' : 'text-emerald-700'"
            >
              <template v-if="t.direction === 'income'">+</template>
              <template v-else-if="t.direction === 'expense'">−</template>
              <MoneyText :value="t.amount" class="inline !text-inherit" />
            </span>
          </li>
        </ul>
        <div v-else class="flex flex-col items-center gap-2 py-10 text-center">
          <span class="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
            <Receipt class="size-4" />
          </span>
          <p class="text-sm font-medium text-foreground">Belum ada transaksi</p>
          <RouterLink
            :to="{ path: '/transactions', query: { action: 'create' } }"
            class="text-xs font-semibold text-emerald-700 hover:underline"
          >
            + Catat transaksi
          </RouterLink>
        </div>
      </div>
    </section>

    <!-- ─── Agenda + Laporan cepat ───────────────────────────────────────── -->
    <section class="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
      <div
        class="rise rounded-[20px] border border-border/60 bg-card p-5 shadow-xs"
        :style="{ animationDelay: '160ms' }"
      >
        <div class="mb-4 flex items-center justify-between gap-2">
          <h2 class="text-base font-bold tracking-tight text-foreground">Agenda Terdekat</h2>
          <RouterLink to="/events" class="text-[12px] font-semibold text-emerald-700 hover:underline">
            Kelola agenda →
          </RouterLink>
        </div>

        <div v-if="contentLoading" class="grid gap-3 sm:grid-cols-2">
          <Skeleton v-for="i in 4" :key="i" class="h-[72px] w-full rounded-xl" />
        </div>
        <div v-else-if="events.length > 0" class="grid gap-3 sm:grid-cols-2">
          <RouterLink
            v-for="e in events"
            :key="e.id"
            to="/events"
            class="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/20 px-3 py-3 transition-colors hover:border-emerald-200 hover:bg-emerald-50/40"
          >
            <div
              class="grid w-11 shrink-0 place-items-center rounded-lg bg-emerald-50 py-1.5 leading-none ring-1 ring-emerald-100"
            >
              <span class="text-base font-extrabold tabular-nums text-emerald-800">
                {{ fmtEventParts(e.startsAt).day }}
              </span>
              <span class="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-600/80">
                {{ fmtEventParts(e.startsAt).mon }}
              </span>
            </div>
            <div class="min-w-0">
              <p class="truncate text-[13px] font-semibold text-foreground">{{ e.title }}</p>
              <p class="truncate text-[11px] text-muted-foreground">
                {{ fmtEventParts(e.startsAt).time }}
                <span v-if="e.location"> · {{ e.location }}</span>
              </p>
            </div>
          </RouterLink>
        </div>
        <div v-else class="flex flex-col items-center gap-2 py-10 text-center">
          <span class="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
            <CalendarClock class="size-5" />
          </span>
          <p class="text-sm font-medium text-foreground">Belum ada agenda</p>
          <p class="max-w-[16rem] text-xs text-muted-foreground">
            Jadwalkan kajian atau kegiatan agar tampil di sini.
          </p>
          <RouterLink to="/events" class="mt-1 text-xs font-semibold text-emerald-700 hover:underline">
            + Buat agenda
          </RouterLink>
        </div>
      </div>

      <div
        class="rise rounded-[20px] border border-border/60 bg-card p-5 shadow-xs"
        :style="{ animationDelay: '200ms' }"
      >
        <div class="mb-4">
          <h2 class="text-base font-bold tracking-tight text-foreground">Laporan Cepat</h2>
          <p class="mt-0.5 text-[12px] text-muted-foreground">Standar ISAK 35 · siap unduh</p>
        </div>

        <div class="flex flex-col gap-2.5">
          <RouterLink
            v-for="r in quickReports"
            :key="r.label"
            :to="r.to"
            class="group flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/60 px-4 py-3.5 text-[13px] font-semibold text-foreground transition-all hover:border-emerald-200 hover:bg-emerald-50/50 hover:text-emerald-900"
          >
            {{ r.label }}
            <ArrowRight
              class="size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-700"
            />
          </RouterLink>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.saldo-card {
  background:
    radial-gradient(120% 90% at 100% 0%, rgba(52, 211, 153, 0.18) 0%, transparent 55%),
    radial-gradient(90% 80% at 0% 100%, rgba(16, 185, 129, 0.12) 0%, transparent 50%),
    linear-gradient(155deg, #0f3d2e 0%, #0c231b 48%, #081912 100%);
  min-height: 340px;
}

/* Kartu dana — hover: angkat tipis + shadow + glow warna aksen */
.fund-card {
  box-shadow: 0 1px 2px rgba(14, 31, 24, 0.04);
  transition:
    transform 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    border-color 0.28s ease;
}

.fund-card:hover {
  transform: translateY(-3px);
  border-color: color-mix(in srgb, var(--fund-glow) 45%, #e2dfd4);
  box-shadow:
    0 1px 2px rgba(14, 31, 24, 0.04),
    0 10px 28px -8px rgba(14, 31, 24, 0.12),
    0 0 0 1px color-mix(in srgb, var(--fund-glow) 35%, transparent),
    0 0 32px -4px var(--fund-glow);
}

.fund-card:active {
  transform: translateY(-1px);
}

@media (prefers-reduced-motion: reduce) {
  .fund-card,
  .fund-card:hover,
  .fund-card:active {
    transition: none;
    transform: none;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .rise {
    opacity: 0;
    transform: translateY(10px);
    animation: rise 0.48s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }
  @keyframes rise {
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
}
</style>
