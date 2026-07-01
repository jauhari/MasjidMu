<script setup lang="ts">
/**
 * Breadcrumb — jejak navigasi hierarki (Utama / Bagian / Halaman).
 * Item terakhir selalu teks statis (halaman aktif), item sebelumnya jadi
 * RouterLink kalau punya `to`.
 */
import { RouterLink } from 'vue-router';
import { ChevronRight } from 'lucide-vue-next';

export interface Crumb {
  label: string;
  to?: string;
}

defineProps<{
  items: Crumb[];
}>();
</script>

<template>
  <nav aria-label="Breadcrumb" class="flex items-center gap-1 text-xs text-muted-foreground">
    <template v-for="(item, i) in items" :key="i">
      <RouterLink
        v-if="item.to && i < items.length - 1"
        :to="item.to"
        class="transition-colors hover:text-foreground hover:underline"
      >
        {{ item.label }}
      </RouterLink>
      <span v-else :class="i === items.length - 1 ? 'font-medium text-foreground' : ''">
        {{ item.label }}
      </span>
      <ChevronRight v-if="i < items.length - 1" class="size-3 shrink-0 text-muted-foreground/50" />
    </template>
  </nav>
</template>
