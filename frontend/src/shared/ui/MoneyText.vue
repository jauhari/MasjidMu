<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '@/lib/utils';

const props = defineProps<{
  value: string | number | null | undefined;
  currency?: string;
  class?: string;
  showSign?: boolean;
}>();

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
  if (n < 0) return `-${fmt}`;
  return fmt;
});

const tone = computed(() => {
  const n = typeof props.value === 'number' ? props.value : Number(props.value);
  if (!Number.isFinite(n) || n === 0) return 'text-foreground';
  return n > 0 ? 'text-emerald-700' : 'text-destructive';
});
</script>

<template>
  <span :class="cn('tabular-nums font-medium', tone, props.class)">{{ formatted }}</span>
</template>