<script setup lang="ts">
/**
 * Pagination — Prev/Next + page size aware. Caller controls offset/limit.
 */
defineProps<{
  total: number;
  offset: number;
  limit: number;
  loading?: boolean;
}>();

defineEmits<{
  prev: [];
  next: [];
}>();
</script>

<template>
  <div class="flex items-center justify-between border-t border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
    <p>
      Menampilkan {{ Math.min(total, offset + 1) }}–{{ Math.min(total, offset + limit) }} dari {{ total }}
    </p>
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="rounded-md border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
        :disabled="offset === 0 || loading"
        @click="$emit('prev')"
      >
        Sebelumnya
      </button>
      <button
        type="button"
        class="rounded-md border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
        :disabled="offset + limit >= total || loading"
        @click="$emit('next')"
      >
        Selanjutnya
      </button>
    </div>
  </div>
</template>
