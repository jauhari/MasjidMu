<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

const props = defineProps<{
  open: boolean;
  title?: string;
  description?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}>();

const emit = defineEmits<{ 'update:open': [boolean] }>();

const sizeClass: Record<string, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
};

function onOpenChange(v: boolean): void {
  emit('update:open', v);
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent
      :class="
        cn(
          sizeClass[size ?? 'md'],
          'flex max-h-[min(calc(100dvh-2rem),52rem)] flex-col gap-0 overflow-hidden p-0',
        )
      "
    >
      <DialogHeader
        v-if="title"
        class="shrink-0 space-y-1 border-b border-border/60 px-6 py-5 pr-14"
      >
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription v-if="description">{{ description }}</DialogDescription>
      </DialogHeader>

      <div class="relative min-h-0 flex-1">
        <ScrollArea type="hover" class="absolute inset-0">
          <div class="px-6 py-5">
            <slot />
          </div>
        </ScrollArea>
      </div>

      <DialogFooter
        v-if="$slots.footer"
        class="shrink-0 gap-2 border-t border-border/60 bg-popover px-6 py-4"
      >
        <slot name="footer" />
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>