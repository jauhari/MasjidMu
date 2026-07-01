<script setup lang="ts">
/**
 * Pagination — Prev/Next + page size aware. Caller controls offset/limit.
 */
import Button from './Button.vue';

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
  <div class="flex items-center justify-between border-t bg-card px-4 py-3 text-sm text-muted-foreground">
    <p>
      Menampilkan {{ Math.min(total, offset + 1) }}–{{ Math.min(total, offset + limit) }} dari {{ total }}
    </p>
    <div class="flex items-center gap-2">
      <Button variant="outline" size="sm" :disabled="offset === 0 || loading" @click="$emit('prev')">
        Sebelumnya
      </Button>
      <Button variant="outline" size="sm" :disabled="offset + limit >= total || loading" @click="$emit('next')">
        Selanjutnya
      </Button>
    </div>
  </div>
</template>
