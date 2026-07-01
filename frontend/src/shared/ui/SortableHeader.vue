<script setup lang="ts" generic="T extends string">
/**
 * SortableHeader — clickable `<th>` content for sortable table columns.
 *
 * Two modes:
 *   - `single` (default): clicking cycles asc → desc → null (clear). Active
 *     column shows arrow; inactive shows neutral indicator on hover.
 *   - `toggle`: cycles asc → desc → asc (no clear state). Use when at least
 *     one sort field is always required.
 *
 * Usage:
 *   <SortableHeader field="code" :active="sort" @sort="setSort">Kode</SortableHeader>
 *
 *   const sort = ref<{ field: 'code' | 'name' | 'balance'; dir: 'asc' | 'desc' } | null>(null);
 *   function setSort(field: string, dir: 'asc' | 'desc' | null) {
 *     sort.value = dir ? { field: field as any, dir } : null;
 *   }
 */
import { computed } from 'vue';
import { ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-vue-next';

const props = defineProps<{
  field: T;
  active: { field: T; dir: 'asc' | 'desc' } | null;
  /** When true, never clears — cycles asc ↔ desc only. Default false. */
  required?: boolean;
  /** Tailwind alignment for the cell content. Default 'start' (left). */
  align?: 'start' | 'end';
}>();

const emit = defineEmits<{
  sort: [field: T, dir: 'asc' | 'desc' | null];
}>();

const isActive = computed(() => props.active?.field === props.field);
const dir = computed(() => (isActive.value ? props.active!.dir : null));

function onClick(): void {
  if (!isActive.value) {
    emit('sort', props.field, 'asc');
    return;
  }
  if (dir.value === 'asc') {
    emit('sort', props.field, 'desc');
    return;
  }
  // currently desc
  if (props.required) {
    emit('sort', props.field, 'asc');
  } else {
    emit('sort', props.field, null);
  }
}
</script>

<template>
  <button
    type="button"
    class="group inline-flex items-center gap-1 select-none text-inherit hover:text-foreground"
    :class="align === 'end' ? 'flex-row-reverse' : ''"
    @click="onClick"
  >
    <span><slot /></span>
    <span class="inline-flex h-3.5 w-3.5 items-center justify-center">
      <ArrowUp v-if="dir === 'asc'" class="h-3.5 w-3.5 text-foreground" />
      <ArrowDown v-else-if="dir === 'desc'" class="h-3.5 w-3.5 text-foreground" />
      <ChevronsUpDown
        v-else
        class="h-3.5 w-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100"
      />
    </span>
  </button>
</template>
