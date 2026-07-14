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
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  code?: string;
  name?: string;
  depth?: number;
  muted?: boolean;
}

/** reka-ui SelectItem forbids empty string values. Map '' to a sentinel internally. */
const EMPTY_SENTINEL = '__mm_empty__';

const props = defineProps<{
  modelValue: string | null | undefined;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  variant?: 'default' | 'coa';
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

const selectedOption = computed(() =>
  normalizedOptions.value.find((opt) => opt.value === internal.value) ?? null,
);

const isCoa = computed(() => props.variant === 'coa');

function depthBars(depth: number | undefined): number[] {
  return Array.from({ length: Math.min(depth ?? 0, 4) }, (_, i) => i);
}
</script>

<template>
  <Select v-model="internal" :disabled="disabled" :required="required">
    <SelectTrigger
      :class="cn('w-full', isCoa && 'h-10 bg-card px-3 shadow-sm hover:bg-muted/30')"
    >
      <span
        v-if="isCoa && selectedOption"
        data-slot="select-value"
        class="flex min-w-0 flex-1 items-center justify-between gap-3"
      >
        <span
          class="shrink-0 rounded-md border bg-muted/60 px-2 py-1 font-mono text-[11px] leading-none text-muted-foreground"
          :class="selectedOption.muted && 'font-sans'"
        >
          {{ selectedOption.code ?? 'Root' }}
        </span>
        <span
          class="min-w-0 flex-1 truncate text-right text-sm"
          :class="selectedOption.muted ? 'text-muted-foreground' : 'font-medium text-foreground'"
        >
          {{ selectedOption.name ?? selectedOption.label }}
        </span>
      </span>
      <SelectValue v-else :placeholder="placeholder ?? 'Pilih'" />
    </SelectTrigger>
    <SelectContent :class="isCoa && 'w-[var(--reka-select-trigger-width)] rounded-xl p-1 shadow-xl'">
      <SelectGroup>
        <SelectItem
          v-for="opt in normalizedOptions"
          :key="opt.value"
          :value="opt.value"
          :disabled="opt.disabled"
          :class="cn(
            isCoa && 'my-0.5 rounded-lg py-2 pr-8 pl-2 focus:bg-emerald-50 data-[state=checked]:bg-emerald-50/80 *:[span]:last:min-w-0 *:[span]:last:flex-1 *:[span]:last:w-full',
            isCoa && !opt.muted && (opt.depth ?? 0) === 0 && 'bg-muted/35 font-semibold',
          )"
        >
          <span v-if="isCoa" class="flex min-w-0 flex-1 items-center gap-3">
            <span
              class="w-[4.75rem] shrink-0 rounded-md border bg-background px-2 py-1 text-left font-mono text-[11px] leading-none tabular-nums text-slate-600"
              :class="opt.muted && 'border-emerald-200 bg-emerald-50 font-sans text-emerald-700'"
            >
              {{ opt.code ?? 'Root' }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="flex min-w-0 items-center justify-end gap-1.5">
                <span
                  v-if="!opt.muted && (opt.depth ?? 0) > 0"
                  class="hidden shrink-0 items-center gap-1 sm:inline-flex"
                  aria-hidden="true"
                >
                  <span
                    v-for="bar in depthBars(opt.depth)"
                    :key="bar"
                    class="h-px w-2 rounded-full bg-border"
                  />
                </span>
                <span
                  class="min-w-0 truncate text-right"
                  :class="opt.muted ? 'text-emerald-700' : 'text-foreground'"
                >
                  {{ opt.name ?? opt.label }}
                </span>
              </span>
            </span>
          </span>
          <template v-else>
            {{ opt.label }}
          </template>
        </SelectItem>
      </SelectGroup>
    </SelectContent>
  </Select>
</template>
