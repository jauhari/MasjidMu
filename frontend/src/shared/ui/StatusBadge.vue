<script setup lang="ts">
import { computed } from 'vue';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const props = defineProps<{
  status: string;
}>();

const config = computed(() => {
  const map: Record<string, { label: string; class: string; dot: string }> = {
    draft: { label: 'Draft', class: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/50' },
    submitted: { label: 'Diajukan', class: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
    approved: { label: 'Disetujui', class: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
    rejected: { label: 'Ditolak', class: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },
    posted: { label: 'Posted', class: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
    published: { label: 'Terbit', class: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
    active: { label: 'Aktif', class: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
    inactive: { label: 'Nonaktif', class: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/50' },
  };
  return map[props.status] ?? { label: props.status, class: '', dot: 'bg-muted-foreground/50' };
});
</script>

<template>
  <Badge variant="outline" :class="cn('gap-1.5 font-semibold', config.class)">
    <span :class="cn('size-1.5 shrink-0 rounded-full', config.dot)" aria-hidden="true" />
    {{ config.label }}
  </Badge>
</template>