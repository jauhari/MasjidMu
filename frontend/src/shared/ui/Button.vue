<script setup lang="ts">
/**
 * Button — minimal styled button with variant + loading state.
 */
defineProps<{
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  type?: 'button' | 'submit';
  loading?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md';
}>();

const base =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-60';

const variants: Record<string, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'text-slate-700 hover:bg-slate-100',
};

const sizes: Record<string, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3 py-2 text-sm',
};
</script>

<template>
  <button
    :type="type ?? 'button'"
    :disabled="disabled || loading"
    :class="[base, variants[variant ?? 'primary'], sizes[size ?? 'md']]"
  >
    <span v-if="loading" class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
    <slot />
  </button>
</template>
