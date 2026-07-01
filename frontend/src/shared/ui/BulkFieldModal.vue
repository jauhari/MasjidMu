<script setup lang="ts">
import AppSelect from '@/shared/ui/AppSelect.vue';
import Button from '@/shared/ui/Button.vue';
import FormField from '@/shared/ui/FormField.vue';
import Modal from '@/shared/ui/Modal.vue';
import type { SelectOption } from '@/shared/ui/AppSelect.vue';

const props = defineProps<{
  open: boolean;
  title: string;
  label: string;
  options: SelectOption[];
  modelValue: string;
  loading?: boolean;
  count: number;
}>();

const emit = defineEmits<{
  'update:open': [boolean];
  'update:modelValue': [string];
  confirm: [];
}>();
</script>

<template>
  <Modal :open="open" :title="title" size="sm" @update:open="emit('update:open', $event)">
    <p class="mb-3 text-sm text-muted-foreground">
      Terapkan ke {{ count }} item terpilih.
    </p>
    <FormField :label="label">
      <AppSelect
        :model-value="modelValue"
        :options="options"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </FormField>
    <template #footer>
      <Button variant="secondary" @click="emit('update:open', false)">Batal</Button>
      <Button :loading="loading" @click="emit('confirm')">Terapkan</Button>
    </template>
  </Modal>
</template>