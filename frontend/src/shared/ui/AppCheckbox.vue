<script setup lang="ts">
import { computed } from 'vue';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

const props = defineProps<{
  modelValue: boolean;
  label?: string;
  disabled?: boolean;
  id?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [boolean] }>();

const checkboxId = computed(() => props.id ?? `cb-${Math.random().toString(36).slice(2, 9)}`);

function onCheckedChange(v: boolean | 'indeterminate'): void {
  emit('update:modelValue', v === true);
}
</script>

<template>
  <div class="flex items-center gap-2">
    <Checkbox
      :id="checkboxId"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="onCheckedChange"
    />
    <Label v-if="label" :for="checkboxId" class="text-sm font-normal cursor-pointer">
      {{ label }}
    </Label>
  </div>
</template>