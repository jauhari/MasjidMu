<script setup lang="ts">
import { computed, ref } from 'vue';
import { CalendarDate, getLocalTimeZone, parseDate, today } from '@internationalized/date';
import { format } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const props = defineProps<{
  modelValue: string | null | undefined;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [string | null] }>();

const open = ref(false);

const calendarValue = computed({
  get: () => {
    if (!props.modelValue) return undefined;
    try {
      return parseDate(props.modelValue);
    } catch {
      return undefined;
    }
  },
  set: (v: CalendarDate | undefined) => {
    if (!v) {
      emit('update:modelValue', null);
      return;
    }
    const iso = `${v.year}-${String(v.month).padStart(2, '0')}-${String(v.day).padStart(2, '0')}`;
    emit('update:modelValue', iso);
    open.value = false;
  },
});

const label = computed(() => {
  if (!props.modelValue) return props.placeholder ?? 'Pilih tanggal';
  try {
    const d = parseDate(props.modelValue).toDate(getLocalTimeZone());
    return format(d, 'dd MMM yyyy', { locale: localeId });
  } catch {
    return props.modelValue;
  }
});
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        :disabled="disabled"
        :class="cn('w-full justify-start text-left font-normal', !modelValue && 'text-muted-foreground')"
      >
        <CalendarIcon class="mr-2 size-4" />
        {{ label }}
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-auto p-0" align="start">
      <Calendar
        v-model="calendarValue"
        :default-placeholder="today(getLocalTimeZone())"
        initial-focus
      />
    </PopoverContent>
  </Popover>
</template>