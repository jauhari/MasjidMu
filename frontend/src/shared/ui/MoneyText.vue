<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<{
    value: string | number | null | undefined;
    currency?: string;
    class?: string;
    showSign?: boolean;
    /**
     * Warna nominal:
     * - auto: hijau jika > 0, destructive jika < 0 (default)
     * - income: hijau pemasukan (mock)
     * - expense: terracotta pengeluaran (mock)
     * - none: ikut class luar / foreground
     */
    tone?: 'auto' | 'income' | 'expense' | 'none';
  }>(),
  { tone: 'auto' },
);

const formatted = computed(() => {
  if (props.value === null || props.value === undefined || props.value === '') return '—';
  const n = typeof props.value === 'number' ? props.value : Number(props.value);
  if (!Number.isFinite(n)) return String(props.value);
  const fmt = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: props.currency ?? 'IDR',
    maximumFractionDigits: 0,
  }).format(Math.abs(n));
  if (props.showSign && n > 0) return `+${fmt}`;
  if (n < 0) return `−${fmt}`;
  return fmt;
});

const toneClass = computed(() => {
  if (props.tone === 'none') return '';
  if (props.tone === 'income') return 'text-[#15803d]';
  if (props.tone === 'expense') return 'text-[#b45309]';
  const n = typeof props.value === 'number' ? props.value : Number(props.value);
  if (!Number.isFinite(n) || n === 0) return 'text-foreground';
  return n > 0 ? 'text-[#15803d]' : 'text-[#b45309]';
});
</script>

<template>
  <span :class="cn('tabular-nums font-medium', toneClass, props.class)">{{ formatted }}</span>
</template>
