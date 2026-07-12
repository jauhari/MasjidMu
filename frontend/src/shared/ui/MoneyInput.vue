<script setup lang="ts">
/**
 * Input nominal uang — tampilan akuntansi Indonesia (1.793.000).
 * v-model = string canonical ("1793000"), display selalu terformat.
 */
import { computed, ref, watch } from 'vue';
import { cn } from '@/lib/utils';
import { formatMoneyInput, parseMoneyInput } from '@/shared/lib/money';

const props = withDefaults(
  defineProps<{
    modelValue?: string | number | null;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    /** Tampilkan prefix "Rp" di kiri input */
    showCurrency?: boolean;
    /** Izinkan 0 sebagai nilai sah */
    allowZero?: boolean;
    class?: string;
    inputClass?: string;
  }>(),
  {
    modelValue: '',
    placeholder: '0',
    showCurrency: true,
    allowZero: true,
  },
);

const emit = defineEmits<{
  'update:modelValue': [string];
  blur: [];
  focus: [];
}>();

const focused = ref(false);
/** Teks yang sedang diketik di input (bisa mid-edit). */
const draft = ref('');

const display = computed(() => {
  if (focused.value) return draft.value;
  return formatMoneyInput(props.modelValue, { allowZero: props.allowZero });
});

watch(
  () => props.modelValue,
  (v) => {
    if (!focused.value) {
      draft.value = formatMoneyInput(v, { allowZero: props.allowZero });
    }
  },
  { immediate: true },
);

function onFocus(e: FocusEvent): void {
  focused.value = true;
  const formatted = formatMoneyInput(props.modelValue, { allowZero: props.allowZero });
  draft.value = formatted;
  emit('focus');
  // Select all for quick overwrite
  const el = e.target as HTMLInputElement;
  requestAnimationFrame(() => el.select());
}

function onInput(e: Event): void {
  const el = e.target as HTMLInputElement;
  const raw = el.value;

  // Izinkan field kosong saat mengetik
  if (!raw.trim()) {
    draft.value = '';
    emit('update:modelValue', props.allowZero ? '0' : '');
    return;
  }

  // Izinkan user mengetik "+" untuk penjumlahan — jangan reformat dulu
  if (raw.includes('+') && !raw.trim().endsWith('+')) {
    const canonical = parseMoneyInput(raw, { allowZero: props.allowZero });
    if (canonical) {
      draft.value = formatMoneyInput(canonical, { allowZero: props.allowZero });
      emit('update:modelValue', canonical);
      return;
    }
    draft.value = raw;
    return;
  }
  if (raw.trim().endsWith('+')) {
    draft.value = raw;
    return;
  }

  const canonical = parseMoneyInput(raw, { allowZero: true });
  if (canonical === '' && raw.replace(/[^\d]/g, '') === '') {
    draft.value = '';
    emit('update:modelValue', props.allowZero ? '0' : '');
    return;
  }

  // Live format: 1793000 → 1.793.000
  const nextDisplay = formatMoneyInput(canonical || '0', { allowZero: true });
  draft.value = nextDisplay;
  emit('update:modelValue', canonical || (props.allowZero ? '0' : ''));

  // Jaga kursor di akhir (live reformat geser caret)
  requestAnimationFrame(() => {
    const len = el.value.length;
    el.setSelectionRange(len, len);
  });
}

function onBlur(): void {
  focused.value = false;
  const canonical = parseMoneyInput(draft.value, { allowZero: props.allowZero });
  const finalVal = canonical || (props.allowZero ? '0' : '');
  emit('update:modelValue', finalVal);
  draft.value = formatMoneyInput(finalVal, { allowZero: props.allowZero });
  emit('blur');
}

function onKeydown(e: KeyboardEvent): void {
  // Blok karakter aneh; izinkan navigasi, digit, separator, +
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const ok = [
    'Backspace',
    'Delete',
    'Tab',
    'Escape',
    'Enter',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Home',
    'End',
  ];
  if (ok.includes(e.key)) return;
  if (/^[\d.,+\s]$/.test(e.key)) return;
  e.preventDefault();
}
</script>

<template>
  <div :class="cn('relative', props.class)">
    <span
      v-if="showCurrency"
      class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs font-semibold text-muted-foreground"
    >
      Rp
    </span>
    <input
      data-slot="input"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      :disabled="disabled"
      :required="required"
      :placeholder="placeholder"
      :value="display"
      :class="
        cn(
          'dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-2 focus-visible:ring-inset h-9 w-full min-w-0 rounded-md border bg-transparent py-1 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
          'font-mono tabular-nums tracking-tight',
          showCurrency ? 'pr-3 pl-9' : 'px-2.5',
          'text-right',
          props.inputClass,
        )
      "
      @focus="onFocus"
      @blur="onBlur"
      @input="onInput"
      @keydown="onKeydown"
    />
  </div>
</template>
