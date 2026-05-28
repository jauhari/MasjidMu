<script setup lang="ts">
/**
 * Laporan Keuangan — periode picker + render salah satu dari 7 laporan.
 *
 * Periode default = bulan berjalan. Tipe laporan via dropdown. Tabel di-render
 * generik: ambil shape dari response, mapping ke tabel HTML. Export PDF/XLSX
 * = trigger window.open ke URL backend dgn query yang sama.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { Download } from 'lucide-vue-next';
import { api, getTenantSlug } from '@/shared/api/client';
import Button from '@/shared/ui/Button.vue';
import { INPUT_BASE } from '@/shared/ui/input-classes';

type ReportType =
  | 'posisi-keuangan'
  | 'aktivitas'
  | 'perubahan-aset-neto'
  | 'arus-kas'
  | 'general-ledger'
  | 'trial-balance'
  | 'jurnal-umum';

const REPORTS: { value: ReportType; label: string }[] = [
  { value: 'posisi-keuangan', label: 'Posisi Keuangan' },
  { value: 'aktivitas', label: 'Aktivitas' },
  { value: 'perubahan-aset-neto', label: 'Perubahan Aset Neto' },
  { value: 'arus-kas', label: 'Arus Kas' },
  { value: 'general-ledger', label: 'Buku Besar' },
  { value: 'trial-balance', label: 'Neraca Saldo' },
  { value: 'jurnal-umum', label: 'Jurnal Umum' },
];

const now = new Date();
const reportType = ref<ReportType>('posisi-keuangan');
const month = ref(now.getMonth() + 1);
const year = ref(now.getFullYear());
const loading = ref(false);
const error = ref<string | null>(null);
const data = ref<any>(null);
const periodLabel = ref<string>('');

function fmtIDR(s: string | number | null | undefined): string {
  if (s == null || s === '') return '-';
  const n = Number(s);
  if (!Number.isFinite(n)) return String(s);
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await api.get<any>(`/api/v1/reports/${reportType.value}`, {
      query: { month: month.value, year: year.value },
    });
    data.value = res.data;
    periodLabel.value = res.period?.label ?? `${month.value}/${year.value}`;
  } catch (err) {
    const e = err as { body?: { error?: string } };
    error.value = e.body?.error ?? (err as Error).message;
    data.value = null;
  } finally {
    loading.value = false;
  }
}

function downloadUrl(format: 'pdf' | 'xlsx'): string {
  const tenant = getTenantSlug();
  const params = new URLSearchParams({
    month: String(month.value),
    year: String(year.value),
    format,
  });
  // Backend expects X-Tenant-Slug header in dev, but window.open can't set
  // headers — use a query fallback. Backend reads `?tenant_slug=` if header
  // missing (we'll add this on backend if needed). For now, document this.
  if (tenant) params.set('tenant_slug', tenant);
  return `/api/v1/reports/${reportType.value}?${params.toString()}`;
}

const months = computed(() =>
  Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: new Date(2000, i, 1).toLocaleDateString('id-ID', { month: 'long' }),
  })),
);

const years = computed(() => {
  const y = now.getFullYear();
  return Array.from({ length: 6 }, (_, i) => y - i);
});

watch([reportType, month, year], () => load());
onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-slate-900">Laporan Keuangan</h1>
        <p class="text-sm text-slate-500">Periode: {{ periodLabel || `${month}/${year}` }}</p>
      </div>
      <div class="flex items-center gap-2">
        <a :href="downloadUrl('pdf')" target="_blank" rel="noopener">
          <Button variant="secondary" size="sm"><Download class="h-3.5 w-3.5" /> PDF</Button>
        </a>
        <a :href="downloadUrl('xlsx')" target="_blank" rel="noopener">
          <Button variant="secondary" size="sm"><Download class="h-3.5 w-3.5" /> XLSX</Button>
        </a>
      </div>
    </header>

    <div class="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <select v-model="reportType" :class="INPUT_BASE" style="max-width:240px">
        <option v-for="r in REPORTS" :key="r.value" :value="r.value">{{ r.label }}</option>
      </select>
      <select v-model.number="month" :class="INPUT_BASE" style="max-width:140px">
        <option v-for="m in months" :key="m.value" :value="m.value">{{ m.label }}</option>
      </select>
      <select v-model.number="year" :class="INPUT_BASE" style="max-width:100px">
        <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
      </select>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

    <div v-if="loading" class="h-64 animate-pulse rounded-xl bg-white border border-slate-200" />

    <section v-else-if="data" class="rounded-xl border border-slate-200 bg-white p-5">
      <!-- Posisi Keuangan -->
      <template v-if="reportType === 'posisi-keuangan'">
        <table class="w-full text-sm">
          <thead><tr class="border-b border-slate-200">
            <th class="py-2 text-left">Kode</th>
            <th class="py-2 text-left">Akun</th>
            <th class="py-2 text-right">Saldo</th>
          </tr></thead>
          <tbody>
            <template v-for="section in [data.assets, data.liabilities, data.netAssets]" :key="section.label">
              <tr><td colspan="3" class="pt-3 pb-1 font-semibold">{{ section.label }}</td></tr>
              <tr v-for="l in section.lines" :key="l.accountCode" class="border-b border-slate-100">
                <td class="py-1.5">{{ l.accountCode }}</td>
                <td class="py-1.5">{{ l.accountName }}</td>
                <td class="py-1.5 text-right">{{ fmtIDR(l.amount) }}</td>
              </tr>
              <tr class="font-semibold border-b-2 border-slate-300">
                <td colspan="2" class="py-1.5">Total {{ section.label }}</td>
                <td class="py-1.5 text-right">{{ fmtIDR(section.total) }}</td>
              </tr>
            </template>
            <tr class="font-bold">
              <td colspan="2" class="pt-3">Total Liabilitas + Aset Neto</td>
              <td class="pt-3 text-right">{{ fmtIDR(data.totalLiabilitiesAndNetAssets) }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <!-- Aktivitas -->
      <template v-else-if="reportType === 'aktivitas'">
        <table class="w-full text-sm">
          <thead><tr class="border-b border-slate-200">
            <th class="py-2 text-left">Kode</th>
            <th class="py-2 text-left">Akun</th>
            <th class="py-2 text-right">Jumlah</th>
          </tr></thead>
          <tbody>
            <template v-for="section in [data.income, data.expense]" :key="section.label">
              <tr><td colspan="3" class="pt-3 pb-1 font-semibold">{{ section.label }}</td></tr>
              <tr v-for="l in section.lines" :key="l.accountCode" class="border-b border-slate-100">
                <td class="py-1.5">{{ l.accountCode }}</td>
                <td class="py-1.5">{{ l.accountName }}</td>
                <td class="py-1.5 text-right">{{ fmtIDR(l.amount) }}</td>
              </tr>
              <tr class="font-semibold border-b-2 border-slate-300">
                <td colspan="2" class="py-1.5">Total {{ section.label }}</td>
                <td class="py-1.5 text-right">{{ fmtIDR(section.total) }}</td>
              </tr>
            </template>
            <tr class="font-bold">
              <td colspan="2" class="pt-3">Surplus / Defisit</td>
              <td class="pt-3 text-right">{{ fmtIDR(data.surplusDeficit) }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <!-- Trial Balance -->
      <template v-else-if="reportType === 'trial-balance'">
        <table class="w-full text-sm">
          <thead><tr class="border-b border-slate-200">
            <th class="py-2 text-left">Kode</th>
            <th class="py-2 text-left">Akun</th>
            <th class="py-2 text-left">Tipe</th>
            <th class="py-2 text-right">Debit</th>
            <th class="py-2 text-right">Kredit</th>
          </tr></thead>
          <tbody>
            <tr v-for="l in data.lines" :key="l.accountCode" class="border-b border-slate-100">
              <td class="py-1.5">{{ l.accountCode }}</td>
              <td class="py-1.5">{{ l.accountName }}</td>
              <td class="py-1.5">{{ l.accountType }}</td>
              <td class="py-1.5 text-right">{{ fmtIDR(l.debit) }}</td>
              <td class="py-1.5 text-right">{{ fmtIDR(l.credit) }}</td>
            </tr>
            <tr class="font-bold border-t-2 border-slate-300">
              <td colspan="3" class="pt-2">Total</td>
              <td class="pt-2 text-right">{{ fmtIDR(data.totalDebit) }}</td>
              <td class="pt-2 text-right">{{ fmtIDR(data.totalCredit) }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <!-- Jurnal Umum -->
      <template v-else-if="reportType === 'jurnal-umum'">
        <table class="w-full text-sm">
          <thead><tr class="border-b border-slate-200">
            <th class="py-2 text-left">Tanggal</th>
            <th class="py-2 text-left">No</th>
            <th class="py-2 text-left">Akun</th>
            <th class="py-2 text-right">Debit</th>
            <th class="py-2 text-right">Kredit</th>
          </tr></thead>
          <tbody>
            <tr v-for="(l, i) in data.lines" :key="i" class="border-b border-slate-100">
              <td class="py-1.5">{{ l.journalDate }}</td>
              <td class="py-1.5">{{ l.journalNo }}</td>
              <td class="py-1.5">{{ l.accountCode }} {{ l.accountName }}</td>
              <td class="py-1.5 text-right">{{ fmtIDR(l.debit) }}</td>
              <td class="py-1.5 text-right">{{ fmtIDR(l.credit) }}</td>
            </tr>
            <tr class="font-bold border-t-2 border-slate-300">
              <td colspan="3" class="pt-2">Total</td>
              <td class="pt-2 text-right">{{ fmtIDR(data.totalDebit) }}</td>
              <td class="pt-2 text-right">{{ fmtIDR(data.totalCredit) }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <!-- General Ledger -->
      <template v-else-if="reportType === 'general-ledger'">
        <div v-for="acc in data.accounts" :key="acc.accountCode" class="mb-6">
          <h3 class="mb-1 text-sm font-semibold">{{ acc.accountCode }} — {{ acc.accountName }}</h3>
          <table class="w-full text-sm">
            <thead><tr class="border-b border-slate-200">
              <th class="py-1.5 text-left">Tanggal</th>
              <th class="py-1.5 text-left">No</th>
              <th class="py-1.5 text-right">Debit</th>
              <th class="py-1.5 text-right">Kredit</th>
              <th class="py-1.5 text-right">Saldo</th>
            </tr></thead>
            <tbody>
              <tr class="border-b border-slate-100 bg-slate-50">
                <td colspan="4" class="py-1.5 italic">Saldo Awal</td>
                <td class="py-1.5 text-right">{{ fmtIDR(acc.openingBalance) }}</td>
              </tr>
              <tr v-for="(l, i) in acc.lines" :key="i" class="border-b border-slate-100">
                <td class="py-1.5">{{ l.journalDate }}</td>
                <td class="py-1.5">{{ l.journalNo }}</td>
                <td class="py-1.5 text-right">{{ fmtIDR(l.debit) }}</td>
                <td class="py-1.5 text-right">{{ fmtIDR(l.credit) }}</td>
                <td class="py-1.5 text-right">{{ fmtIDR(l.runningBalance) }}</td>
              </tr>
              <tr class="font-semibold border-t border-slate-300">
                <td colspan="4" class="py-1.5">Saldo Akhir</td>
                <td class="py-1.5 text-right">{{ fmtIDR(acc.closingBalance) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- Perubahan Aset Neto + Arus Kas: simple kv table -->
      <template v-else>
        <pre class="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{{ JSON.stringify(data, null, 2) }}</pre>
      </template>
    </section>
  </div>
</template>
