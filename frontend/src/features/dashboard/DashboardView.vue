<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import {
  Activity,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  CalendarDays,
  FileBarChart2,
  Megaphone,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-vue-next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api, formatApiError } from '@/shared/api/client';
import { useAuthStore } from '@/features/auth/store';
import MoneyText from '@/shared/ui/MoneyText.vue';
import { cn } from '@/lib/utils';

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

interface Announcement {
  id: string;
  title: string;
  scope: string;
  publishedAt: string | null;
  status: 'draft' | 'published';
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

interface ProgramItem {
  id: string;
  status: string;
}

const auth = useAuthStore();
const kpiLoading = ref(true);
const contentLoading = ref(true);
const error = ref<string | null>(null);
const balance = ref<BalanceSheet | null>(null);
const activity = ref<ActivitySummary | null>(null);
const announcements = ref<Announcement[]>([]);
const events = ref<EventItem[]>([]);
const activePrograms = ref(0);
const mosqueName = ref('HisabMu');

const now = new Date();
const month = now.getUTCMonth() + 1;
const year = now.getUTCFullYear();

const periodLabel = computed(() => balance.value?.period.label ?? `${month}/${year}`);
const visibleAnnouncements = computed(() => announcements.value.slice(0, 3));

// ─── Derived figures for lightweight data-viz (no chart lib) ───────────────
const incomeNum = computed(() => Number(activity.value?.data.income.total ?? 0));
const expenseNum = computed(() => Number(activity.value?.data.expense.total ?? 0));
const surplusNum = computed(() => Number(activity.value?.data.surplusDeficit ?? 0));
const surplusPositive = computed(() => surplusNum.value >= 0);
const flowMax = computed(() => Math.max(incomeNum.value, expenseNum.value, 1));
const incomePct = computed(() => Math.round((incomeNum.value / flowMax.value) * 100));
const expensePct = computed(() => Math.round((expenseNum.value / flowMax.value) * 100));

const assetNum = computed(() => Number(balance.value?.data.assets.total ?? 0));
const liabilityNum = computed(() => Number(balance.value?.data.liabilities.total ?? 0));
const netNum = computed(() => Number(balance.value?.data.netAssets.total ?? 0));
const posBase = computed(() => Math.max(assetNum.value, 1));
const netPct = computed(() => Math.min(100, Math.max(0, Math.round((netNum.value / posBase.value) * 100))));
const liabilityPct = computed(() =>
  Math.min(100, Math.max(0, Math.round((liabilityNum.value / posBase.value) * 100))),
);

const quickActions = [
  {
    to: { path: '/transactions', query: { action: 'create' } },
    label: 'Transaksi',
    desc: 'Catat pemasukan / pengeluaran',
    icon: ArrowLeftRight,
    chip: 'bg-primary/10 text-primary',
  },
  { to: '/events', label: 'Agenda', desc: 'Jadwal kegiatan', icon: CalendarDays, chip: 'bg-amber-100 text-amber-700' },
  { to: '/announcements', label: 'Pengumuman', desc: 'Info untuk jamaah', icon: Megaphone, chip: 'bg-blue-100 text-blue-700' },
  { to: '/reports', label: 'Laporan', desc: 'Keuangan & dana', icon: FileBarChart2, chip: 'bg-emerald-100 text-emerald-700' },
];

const kpiCards = computed(() => [
  {
    key: 'kas',
    label: 'Saldo Kas',
    hint: 'Total aset neto',
    value: balance.value?.data.netAssets.total,
    icon: Wallet,
    chip: 'bg-primary/10 text-primary',
    line: 'from-primary/70 to-primary/0',
    isCount: false,
  },
  {
    key: 'in',
    label: 'Pemasukan',
    hint: 'Bulan ini',
    value: activity.value?.data.income.total,
    icon: TrendingUp,
    chip: 'bg-emerald-100 text-emerald-700',
    line: 'from-emerald-400/70 to-emerald-400/0',
    isCount: false,
  },
  {
    key: 'out',
    label: 'Pengeluaran',
    hint: 'Bulan ini',
    value: activity.value?.data.expense.total,
    icon: TrendingDown,
    chip: 'bg-rose-100 text-rose-700',
    line: 'from-rose-400/70 to-rose-400/0',
    isCount: false,
  },
  {
    key: 'prog',
    label: 'Program Aktif',
    hint: 'Sedang berjalan',
    value: String(activePrograms.value),
    icon: Activity,
    chip: 'bg-blue-100 text-blue-700',
    line: 'from-blue-400/70 to-blue-400/0',
    isCount: true,
  },
]);

function fmtEventParts(s: string): { day: string; mon: string; time: string } {
  const d = new Date(s);
  return {
    day: d.toLocaleDateString('id-ID', { day: '2-digit' }),
    mon: d.toLocaleDateString('id-ID', { month: 'short' }),
    time: d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
  };
}

onMounted(() => {
  const fromIso = new Date().toISOString();
  mosqueName.value = auth.tenantSlug ?? 'HisabMu';

  void (async () => {
    try {
      const [ann, ev, profile] = await Promise.all([
        api.get<{ data: Announcement[] }>('/api/v1/announcements', {
          query: { status: 'published', limit: 5 },
        }),
        api.get<{ data: EventItem[] }>('/api/v1/events', {
          query: { status: 'published', from: fromIso, limit: 5 },
        }),
        api.get<{ data: MosqueProfile }>('/api/v1/mosque-profile').catch(() => null),
      ]);
      announcements.value = ann.data;
      events.value = [...ev.data].sort(
        (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
      );
      if (profile?.data) {
        mosqueName.value =
          profile.data.officialName ?? profile.data.shortName ?? auth.tenantSlug ?? 'HisabMu';
      }
    } catch (err) {
      error.value = formatApiError(err, 'Gagal memuat konten dashboard');
    } finally {
      contentLoading.value = false;
    }
  })();

  void (async () => {
    try {
      const [bs, act, prog] = await Promise.all([
        api.get<BalanceSheet>('/api/v1/reports/posisi-keuangan', { query: { month, year } }),
        api.get<ActivitySummary>('/api/v1/reports/aktivitas', { query: { month, year } }),
        api.get<{ data: ProgramItem[]; meta: { total: number } }>('/api/v1/programs', {
          query: { status: 'active', limit: 1 },
        }),
      ]);
      balance.value = bs;
      activity.value = act;
      activePrograms.value = prog.meta.total;
    } catch (err) {
      if (!error.value) {
        error.value = formatApiError(err, 'Gagal memuat ringkasan keuangan');
      }
    } finally {
      kpiLoading.value = false;
    }
  })();
});
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- ─── Hero — greeting + surplus + cashflow ─────────────────────────── -->
    <Card class="rise relative overflow-hidden border-primary/15">
      <!-- decorative aura -->
      <div aria-hidden="true" class="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-primary/15 blur-3xl"></div>
      <div aria-hidden="true" class="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-transparent"></div>

      <div class="relative grid gap-6 p-5 md:p-6 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <!-- left -->
        <div>
          <div class="flex items-center gap-2">
            <span class="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary/80">Selamat datang</span>
            <span class="relative flex size-2">
              <span class="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60"></span>
              <span class="relative inline-flex size-2 rounded-full bg-emerald-500"></span>
            </span>
            <span class="text-[11px] font-medium text-emerald-600">Aktif</span>
          </div>
          <h1 class="mt-1.5 text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
            {{ mosqueName }}
          </h1>
          <p class="mt-1 text-sm text-muted-foreground">
            Ringkasan keuangan · <span class="font-medium text-foreground/80">{{ periodLabel }}</span>
          </p>

          <!-- surplus headline -->
          <div v-if="!kpiLoading && activity" class="mt-5 flex items-end gap-3">
            <div>
              <p class="text-xs font-medium text-muted-foreground">Surplus / Defisit bulan ini</p>
              <div class="mt-0.5 flex items-center gap-2">
                <MoneyText
                  :value="activity.data.surplusDeficit"
                  show-sign
                  class="text-2xl font-extrabold tracking-tight md:text-[28px]"
                  :class="surplusPositive ? 'text-emerald-600' : 'text-rose-600'"
                />
                <span
                  class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  :class="surplusPositive ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'"
                >
                  <component :is="surplusPositive ? ArrowUpRight : ArrowDownRight" class="size-3" />
                  {{ surplusPositive ? 'Surplus' : 'Defisit' }}
                </span>
              </div>
            </div>
          </div>
          <Skeleton v-else class="mt-5 h-9 w-48" />
        </div>

        <!-- right — cashflow mini panel -->
        <div class="rounded-2xl border border-border/70 bg-card/70 p-4 backdrop-blur-sm">
          <div class="mb-3 flex items-center justify-between">
            <p class="text-xs font-semibold text-foreground">Arus Kas Bulan Ini</p>
            <RouterLink to="/reports" class="text-[11px] font-medium text-primary hover:underline">Detail</RouterLink>
          </div>
          <template v-if="!kpiLoading && activity">
            <div class="space-y-3">
              <div>
                <div class="mb-1 flex items-center justify-between text-xs">
                  <span class="flex items-center gap-1.5 text-muted-foreground"><span class="size-2 rounded-full bg-emerald-500"></span>Pemasukan</span>
                  <MoneyText :value="activity.data.income.total" class="font-semibold text-foreground" />
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-muted">
                  <div class="h-full rounded-full bg-emerald-500 transition-[width] duration-700 ease-out" :style="{ width: incomePct + '%' }"></div>
                </div>
              </div>
              <div>
                <div class="mb-1 flex items-center justify-between text-xs">
                  <span class="flex items-center gap-1.5 text-muted-foreground"><span class="size-2 rounded-full bg-rose-400"></span>Pengeluaran</span>
                  <MoneyText :value="activity.data.expense.total" class="font-semibold text-foreground" />
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-muted">
                  <div class="h-full rounded-full bg-rose-400 transition-[width] duration-700 ease-out" :style="{ width: expensePct + '%' }"></div>
                </div>
              </div>
            </div>
          </template>
          <div v-else class="space-y-3">
            <Skeleton class="h-8 w-full" />
            <Skeleton class="h-8 w-full" />
          </div>
        </div>
      </div>
    </Card>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <!-- ─── KPI bento ────────────────────────────────────────────────────── -->
    <section class="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
      <template v-if="kpiLoading">
        <Card v-for="i in 4" :key="i" class="p-4">
          <Skeleton class="mb-3 size-9 rounded-xl" />
          <Skeleton class="mb-2 h-3 w-20" />
          <Skeleton class="h-7 w-28" />
        </Card>
      </template>
      <template v-else>
        <Card
          v-for="(kpi, i) in kpiCards"
          :key="kpi.key"
          class="rise group relative overflow-hidden p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/5"
          :style="{ animationDelay: 60 + i * 50 + 'ms' }"
        >
          <div :class="cn('absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r', kpi.line)" aria-hidden="true"></div>
          <div class="flex items-start justify-between">
            <span :class="cn('grid size-9 place-items-center rounded-xl', kpi.chip)">
              <component :is="kpi.icon" class="size-[18px]" />
            </span>
          </div>
          <p class="mt-3 text-xs font-medium text-muted-foreground">{{ kpi.label }}</p>
          <div class="mt-0.5 text-[26px] font-extrabold leading-tight tracking-tight text-foreground">
            <span v-if="kpi.isCount" class="tabular-nums">{{ kpi.value }}</span>
            <MoneyText v-else :value="kpi.value" class="font-bold text-foreground" />
          </div>
          <p class="mt-1 text-[11px] text-muted-foreground">{{ kpi.hint }}</p>
        </Card>
      </template>
    </section>

    <!-- ─── Main grid: agenda (2/3) + side (1/3) ─────────────────────────── -->
    <section class="grid gap-4 lg:grid-cols-3">
      <!-- Agenda -->
      <Card class="rise lg:col-span-2" :style="{ animationDelay: '120ms' }">
        <CardHeader class="flex-row items-center justify-between space-y-0">
          <div class="flex items-center gap-2.5">
            <span class="grid size-8 place-items-center rounded-lg bg-amber-100 text-amber-700">
              <CalendarClock class="size-4" />
            </span>
            <div>
              <CardTitle class="text-base">Agenda Terdekat</CardTitle>
              <CardDescription>Kegiatan mendatang</CardDescription>
            </div>
          </div>
          <RouterLink to="/events" class="group inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            Lihat semua <ArrowRight class="size-3 transition-transform group-hover:translate-x-0.5" />
          </RouterLink>
        </CardHeader>
        <CardContent>
          <div v-if="contentLoading" class="flex flex-col gap-2">
            <Skeleton v-for="i in 3" :key="i" class="h-14 w-full" />
          </div>
          <ul v-else-if="events.length > 0" class="flex flex-col gap-1.5">
            <li v-for="e in events" :key="e.id">
              <RouterLink
                to="/events"
                class="flex items-center gap-3 rounded-xl border border-transparent p-2 transition-colors hover:border-border hover:bg-muted/40"
              >
                <div class="grid w-12 shrink-0 place-items-center rounded-lg border border-primary/15 bg-primary/5 py-1.5 leading-none">
                  <span class="text-base font-extrabold tabular-nums text-primary">{{ fmtEventParts(e.startsAt).day }}</span>
                  <span class="mt-0.5 text-[10px] font-medium uppercase text-primary/70">{{ fmtEventParts(e.startsAt).mon }}</span>
                </div>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-foreground">{{ e.title }}</p>
                  <p class="truncate text-xs text-muted-foreground">
                    {{ fmtEventParts(e.startsAt).time }}<span v-if="e.location"> · {{ e.location }}</span>
                  </p>
                </div>
                <ArrowRight class="size-4 shrink-0 text-muted-foreground/40" />
              </RouterLink>
            </li>
          </ul>
          <div v-else class="flex flex-col items-center gap-2 py-8 text-center">
            <span class="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
              <CalendarClock class="size-5" />
            </span>
            <p class="text-sm font-medium text-foreground">Belum ada agenda</p>
            <p class="max-w-[15rem] text-xs text-muted-foreground">Jadwalkan kajian atau kegiatan agar tampil di sini.</p>
            <RouterLink to="/events" class="mt-1 text-xs font-semibold text-primary hover:underline">+ Buat agenda</RouterLink>
          </div>
        </CardContent>
      </Card>

      <!-- Side column -->
      <div class="flex flex-col gap-4">
        <!-- Posisi keuangan ringkas -->
        <Card class="rise" :style="{ animationDelay: '160ms' }">
          <CardHeader class="pb-2">
            <CardTitle class="flex items-center gap-2 text-base">
              <Sparkles class="size-4 text-primary" /> Posisi Keuangan
            </CardTitle>
            <CardDescription>Komposisi per {{ periodLabel }}</CardDescription>
          </CardHeader>
          <CardContent>
            <template v-if="!kpiLoading && balance">
              <div class="flex items-baseline justify-between">
                <span class="text-xs text-muted-foreground">Total Aset</span>
                <MoneyText :value="balance.data.assets.total" class="font-semibold text-foreground" />
              </div>
              <!-- stacked proportion bar: aset neto vs kewajiban -->
              <div class="mt-2 flex h-2.5 overflow-hidden rounded-full bg-muted">
                <div class="h-full bg-primary transition-[width] duration-700 ease-out" :style="{ width: netPct + '%' }"></div>
                <div class="h-full bg-rose-300 transition-[width] duration-700 ease-out" :style="{ width: liabilityPct + '%' }"></div>
              </div>
              <div class="mt-3 space-y-1.5">
                <div class="flex items-center justify-between text-xs">
                  <span class="flex items-center gap-1.5 text-muted-foreground"><span class="size-2 rounded-full bg-primary"></span>Aset Neto</span>
                  <MoneyText :value="balance.data.netAssets.total" class="font-medium text-foreground" />
                </div>
                <div class="flex items-center justify-between text-xs">
                  <span class="flex items-center gap-1.5 text-muted-foreground"><span class="size-2 rounded-full bg-rose-300"></span>Kewajiban</span>
                  <MoneyText :value="balance.data.liabilities.total" class="font-medium text-foreground" />
                </div>
              </div>
            </template>
            <div v-else class="space-y-2">
              <Skeleton class="h-4 w-full" />
              <Skeleton class="h-2.5 w-full" />
              <Skeleton class="h-4 w-2/3" />
            </div>
          </CardContent>
        </Card>

        <!-- Pengumuman -->
        <Card class="rise flex-1" :style="{ animationDelay: '200ms' }">
          <CardHeader class="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle class="flex items-center gap-2 text-base">
              <Megaphone class="size-4 text-blue-600" /> Pengumuman
            </CardTitle>
            <RouterLink to="/announcements" class="text-xs font-medium text-primary hover:underline">Semua</RouterLink>
          </CardHeader>
          <CardContent>
            <div v-if="contentLoading" class="flex flex-col gap-2">
              <Skeleton v-for="i in 2" :key="i" class="h-9 w-full" />
            </div>
            <ul v-else-if="visibleAnnouncements.length > 0" class="flex flex-col divide-y divide-border">
              <li v-for="a in visibleAnnouncements" :key="a.id" class="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <span class="truncate text-sm font-medium text-foreground">{{ a.title }}</span>
                <Badge variant="outline" class="shrink-0 text-[10px] capitalize">{{ a.scope }}</Badge>
              </li>
            </ul>
            <div v-else class="flex flex-col items-center gap-1.5 py-6 text-center">
              <span class="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
                <Megaphone class="size-4" />
              </span>
              <p class="text-sm font-medium text-foreground">Belum ada pengumuman</p>
              <RouterLink to="/announcements" class="text-xs font-semibold text-primary hover:underline">+ Buat pengumuman</RouterLink>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>

    <!-- ─── Quick actions ────────────────────────────────────────────────── -->
    <section class="rise" :style="{ animationDelay: '240ms' }">
      <h2 class="mb-3 text-sm font-semibold text-foreground">Aksi Cepat</h2>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <RouterLink
          v-for="action in quickActions"
          :key="action.label"
          :to="action.to"
          class="group relative flex items-center gap-3 overflow-hidden rounded-2xl border bg-card p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md hover:shadow-primary/5"
        >
          <span :class="cn('grid size-10 shrink-0 place-items-center rounded-xl transition-transform duration-200 group-hover:scale-105', action.chip)">
            <component :is="action.icon" class="size-[18px]" />
          </span>
          <span class="min-w-0">
            <span class="block text-sm font-semibold text-foreground">{{ action.label }}</span>
            <span class="block truncate text-[11px] text-muted-foreground">{{ action.desc }}</span>
          </span>
          <ArrowRight class="ml-auto size-4 shrink-0 text-muted-foreground/30 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-primary" />
        </RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
@media (prefers-reduced-motion: no-preference) {
  .rise {
    opacity: 0;
    transform: translateY(12px);
    animation: rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }
  @keyframes rise {
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
}
</style>
