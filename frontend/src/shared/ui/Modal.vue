<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const props = defineProps<{
  open: boolean;
  title?: string;
  description?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
}>();

const emit = defineEmits<{ 'update:open': [boolean] }>();

const sizeClass: Record<string, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
  '2xl': 'sm:max-w-6xl',
};

function onOpenChange(v: boolean): void {
  emit('update:open', v);
}

/** Teleport panel (pilih akun, dll.) dianggap di luar dialog — jangan dismiss / blok interaksi. */
function isFloatingOverlayTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    '[data-account-select-panel], [data-radix-popper-content-wrapper], [data-reka-popper-content-wrapper]',
  );
}

function onPointerDownOutside(event: Event): void {
  const e = event as CustomEvent<{ originalEvent: Event }>;
  const t = e.detail?.originalEvent?.target ?? (event as { target?: EventTarget }).target;
  if (isFloatingOverlayTarget(t as EventTarget)) {
    event.preventDefault();
  }
}

function onFocusOutside(event: Event): void {
  const e = event as CustomEvent<{ originalEvent: Event }>;
  const t = e.detail?.originalEvent?.target ?? (event as { target?: EventTarget }).target;
  if (isFloatingOverlayTarget(t as EventTarget)) {
    event.preventDefault();
  }
}

function onInteractOutside(event: Event): void {
  const e = event as CustomEvent<{ originalEvent: Event }>;
  const t = e.detail?.originalEvent?.target ?? (event as { target?: EventTarget }).target;
  if (isFloatingOverlayTarget(t as EventTarget)) {
    event.preventDefault();
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent
      :class="
        cn(
          sizeClass[size ?? 'md'],
          // Jangan pakai absolute ScrollArea — merusak posisi Popover/Select di dalam form.
          'flex max-h-[min(calc(100dvh-1.5rem),56rem)] flex-col gap-0 overflow-hidden p-0',
        )
      "
      @pointer-down-outside="onPointerDownOutside"
      @focus-outside="onFocusOutside"
      @interact-outside="onInteractOutside"
    >
      <DialogHeader
        v-if="title"
        class="shrink-0 space-y-1 border-b border-border/60 px-6 py-4 pr-14"
      >
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription v-if="description">{{ description }}</DialogDescription>
      </DialogHeader>

      <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 py-5">
        <slot />
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
