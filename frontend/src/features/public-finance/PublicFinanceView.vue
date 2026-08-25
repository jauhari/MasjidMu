<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Download, ImageDown, ShieldCheck, TrendingDown, TrendingUp, Wallet } from 'lucide-vue-next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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

interface PublicFinanceReport {
  reportType: 'finance-transparency';
  mosque: { name: string; shortName: string | null; logoUrl: string | null; bannerUrl: string | null };
  period: { startDate: string; endDate: string; label: string };
  publication: { publishedAt: string };
  generatedAt: string;
  data: { cashPosition: string; topIncome: CategoryAmount[]; topExpense: CategoryAmount[] };
}

const route = useRoute();
const now = new Date();
const loading = ref(false);
const unavailable = ref(false);
const error = ref<string | null>(null);
const report = ref<PublicFinanceReport | null>(null);
const periodMode = ref<'monthly' | 'custom'>('monthly');
const month = ref(now.getMonth() + 1);
const year = ref(now.getFullYear());
const dateFrom = ref<string | null>(null);
const dateTo = ref<string | null>(null);

const periodModeOptions = [
  { value: 'monthly', label: 'Per Bulan' },
  { value: 'custom', label: 'Custom' },
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

function buildPublicUrl(format?: 'image'): string {
  const params = new URLSearchParams();
  if (periodMode.value === 'custom') {
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
onMounted(() => { void load(); });
</script>

<template>
  <main class="min-h-svh bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.10),transparent_32rem),linear-gradient(180deg,#f8fbf9_0%,#eef4ef_100%)] px-4 py-6 text-foreground sm:px-6 lg:px-8">
    <div class="mx-auto max-w-4xl space-y-5">
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
          <a v-if="report" :href="imageUrl" target="_blank" rel="noopener">
            <Button variant="secondary"><ImageDown class="h-4 w-4" /> Unduh Gambar</Button>
          </a>
        </div>
      </header>

      <Card>
        <CardContent class="flex flex-wrap items-center gap-2.5 px-4 py-3">
          <span class="hidden shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground sm:flex"><Download class="size-4" /> Periode</span>
          <div class="w-full max-w-[120px]"><AppSelect v-model="periodMode" :options="periodModeOptions" /></div>
          <template v-if="periodMode === 'monthly'">
            <div class="w-full max-w-[150px]"><AppSelect v-model="monthStr" :options="monthOptions" /></div>
            <div class="w-full max-w-[100px]"><AppSelect v-model="yearStr" :options="yearOptions" /></div>
          </template>
          <template v-else>
            <DatePicker v-model="dateFrom" placeholder="Dari tgl" />
            <span class="text-xs text-muted-foreground">s/d</span>
            <DatePicker v-model="dateTo" placeholder="Sampai tgl" />
          </template>
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

        <p class="rounded-2xl border bg-card px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          Detail internal seperti nomor bukti, nama akun, dan catatan audit sengaja tidak dipublikasikan untuk menjaga privasi. Angka berasal dari transaksi yang sudah diposting.
        </p>
      </template>
    </div>
  </main>
</template>
