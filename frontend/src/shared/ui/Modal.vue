<script setup lang="ts">
/**
 * Modal — minimal accessible dialog. Closes on backdrop click + Esc.
 *
 * Use via:
 *   <Modal v-model:open="open" title="Tambah">
 *     <p>...</p>
 *     <template #footer>...</template>
 *   </Modal>
 */
import { onMounted, onUnmounted, watch } from 'vue';

const props = defineProps<{
  open: boolean;
  title?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}>();

const emit = defineEmits<{ 'update:open': [boolean] }>();

function close(): void {
  emit('update:open', false);
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open) close();
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));

watch(
  () => props.open,
  (v) => {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = v ? 'hidden' : '';
    }
  },
);

const sizeClass = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="open"
        class="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 px-4 py-6"
        @click.self="close"
      >
        <div
          class="w-full rounded-2xl bg-white shadow-xl"
          :class="sizeClass[size ?? 'md']"
          role="dialog"
          aria-modal="true"
        >
          <header v-if="title" class="border-b border-slate-200 px-5 py-3">
            <h2 class="text-sm font-semibold text-slate-900">{{ title }}</h2>
          </header>
          <div class="px-5 py-4">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 rounded-b-2xl">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from,
.fade-leave-to { opacity: 0; }
</style>
