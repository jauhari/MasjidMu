<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '@/shared/api/client';

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

const loading = ref(true);
const error = ref<string | null>(null);
const balance = ref<BalanceSheet | null>(null);
const activity = ref<ActivitySummary | null>(null);
const announcements = ref<Announcement[]>([]);

function formatIDR(s: string | undefined): string {
  if (!s) return '-';
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}

const now = new Date();
const month = now.getUTCMonth() + 1;
const year = now.getUTCFullYear();

onMounted(async () => {
  try {
    const [bs, act, ann] = await Promise.all([
      api.get<BalanceSheet>('/api/v1/reports/posisi-keuangan', { query: { month, year } }),
      api.get<ActivitySummary>('/api/v1/reports/aktivitas', { query: { month, year } }),
      api.get<{ data: Announcement[] }>('/api/v1/announcements', { query: { status: 'published', limit: 5 } }),
    ]);
    balance.value = bs;
    activity.value = act;
    announcements.value = ann.data;
  } catch (err) {
    const e = err as { body?: { error?: string }; message?: string };
    error.value = e.body?.error ?? e.message ?? 'Gagal memuat dashboard';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="space-y-6">
    <header>
      <h1 class="text-xl font-semibold text-slate-900">Dashboard</h1>
      <p class="text-sm text-slate-500">Periode: {{ balance?.period.label ?? `${month}/${year}` }}</p>
    </header>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

    <section v-if="loading" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div v-for="i in 4" :key="i" class="h-24 animate-pulse rounded-xl bg-white border border-slate-200" />
    </section>

    <section v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div class="rounded-xl border border-slate-200 bg-white p-4">
        <p class="text-xs uppercase tracking-wide text-slate-500">Total Aset</p>
        <p class="mt-1 text-xl font-semibold">{{ formatIDR(balance?.data.assets.total) }}</p>
      </div>
      <div class="rounded-xl border border-slate-200 bg-white p-4">
        <p class="text-xs uppercase tracking-wide text-slate-500">Pendapatan</p>
        <p class="mt-1 text-xl font-semibold text-emerald-700">{{ formatIDR(activity?.data.income.total) }}</p>
      </div>
      <div class="rounded-xl border border-slate-200 bg-white p-4">
        <p class="text-xs uppercase tracking-wide text-slate-500">Beban</p>
        <p class="mt-1 text-xl font-semibold text-rose-700">{{ formatIDR(activity?.data.expense.total) }}</p>
      </div>
      <div class="rounded-xl border border-slate-200 bg-white p-4">
        <p class="text-xs uppercase tracking-wide text-slate-500">Surplus / Defisit</p>
        <p class="mt-1 text-xl font-semibold">{{ formatIDR(activity?.data.surplusDeficit) }}</p>
      </div>
    </section>

    <section class="rounded-xl border border-slate-200 bg-white p-5">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-slate-900">Pengumuman terbaru</h2>
      </div>
      <ul v-if="announcements.length > 0" class="divide-y divide-slate-100">
        <li v-for="a in announcements" :key="a.id" class="py-2.5">
          <p class="text-sm font-medium text-slate-900">{{ a.title }}</p>
          <p class="text-xs text-slate-500">
            {{ a.scope }} · {{ a.publishedAt ? new Date(a.publishedAt).toLocaleString('id-ID') : 'belum dipublikasikan' }}
          </p>
        </li>
      </ul>
      <p v-else class="text-sm text-slate-500">Belum ada pengumuman dipublikasikan.</p>
    </section>
  </div>
</template>
