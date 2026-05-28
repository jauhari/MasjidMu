<script setup lang="ts">
/**
 * ConfirmDialog — destructive action confirmation.
 *
 * Caller passes `open`, `title`, `message`. Emits `confirm` / `cancel`.
 */
import Modal from './Modal.vue';
import Button from './Button.vue';

const props = defineProps<{
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  loading?: boolean;
}>();

const emit = defineEmits<{
  'update:open': [boolean];
  confirm: [];
}>();

function close(): void {
  emit('update:open', false);
}
function confirm(): void {
  emit('confirm');
}
</script>

<template>
  <Modal :open="open" :title="title ?? 'Konfirmasi'" size="sm" @update:open="emit('update:open', $event)">
    <p class="text-sm text-slate-700">{{ message }}</p>
    <template #footer>
      <Button variant="secondary" :disabled="loading" @click="close">Batal</Button>
      <Button variant="danger" :loading="loading" @click="confirm">
        {{ confirmLabel ?? 'Hapus' }}
      </Button>
    </template>
  </Modal>
</template>
