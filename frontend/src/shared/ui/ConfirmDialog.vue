<script setup lang="ts">
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import Button from './Button.vue';

defineProps<{
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

function onOpenChange(v: boolean): void {
  emit('update:open', v);
}
</script>

<template>
  <AlertDialog :open="open" @update:open="onOpenChange">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ title ?? 'Konfirmasi' }}</AlertDialogTitle>
        <AlertDialogDescription>{{ message }}</AlertDialogDescription>
        <slot />
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="loading">Batal</AlertDialogCancel>
        <AlertDialogAction as-child>
          <Button variant="danger" :loading="loading" @click="emit('confirm')">
            {{ confirmLabel ?? 'Hapus' }}
          </Button>
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>