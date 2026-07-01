<script setup lang="ts">
import { computed } from 'vue';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** reka-ui SelectItem forbids empty string values — map '' ↔ sentinel internally. */
const EMPTY_SENTINEL = '__mm_empty__';

const props = defineProps<{
  modelValue: string | null | undefined;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [string] }>();

function toInternal(value: string): string {
  return value === '' ? EMPTY_SENTINEL : value;
}

function fromInternal(value: string | undefined): string {
  if (value === undefined || value === EMPTY_SENTINEL) return '';
  return value;
}

const normalizedOptions = computed(() =>
  props.options.map((opt) => ({
    ...opt,
    value: toInternal(opt.value),
  })),
);

const internal = computed({
  get: () => {
    const v = props.modelValue;
    if (v === '' || v === null || v === undefined) return EMPTY_SENTINEL;
    return v;
  },
  set: (v: string | undefined) => emit('update:modelValue', fromInternal(v)),
});
</script>

<template>
  <Select v-model="internal" :disabled="disabled" :required="required">
    <SelectTrigger class="w-full">
      <SelectValue :placeholder="placeholder ?? '— Pilih —'" />
    </SelectTrigger>
    <SelectContent>
      <SelectGroup>
        <SelectItem
          v-for="opt in normalizedOptions"
          :key="opt.value"
          :value="opt.value"
          :disabled="opt.disabled"
        >
          {{ opt.label }}
        </SelectItem>
      </SelectGroup>
    </SelectContent>
  </Select>
</template>