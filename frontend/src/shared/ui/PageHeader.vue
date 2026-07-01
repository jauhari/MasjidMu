<script setup lang="ts">
import Breadcrumb, { type Crumb } from './Breadcrumb.vue';

defineProps<{
  title: string;
  description?: string;
  crumbs?: Crumb[];
}>();
</script>

<template>
  <header class="flex flex-col gap-1.5">
    <Breadcrumb v-if="crumbs?.length" :items="crumbs" />
    <div class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div class="flex flex-col gap-1">
        <h1 class="text-xl font-semibold tracking-tight text-foreground">{{ title }}</h1>
        <p v-if="description" class="text-sm text-muted-foreground">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>
