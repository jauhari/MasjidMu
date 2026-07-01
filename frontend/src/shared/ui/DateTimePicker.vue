<script setup lang="ts">
import { computed, ref } from 'vue';
import { CalendarDate, getLocalTimeZone, parseDate, today } from '@internationalized/date';
import { format } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { CalendarIcon, Clock } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import AppSelect from '@/shared/ui/AppSelect.vue';
import { cn } from '@/lib/utils';

const props = defineProps<{
  modelValue: string | null | undefined;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [string | null] }>();

const open = ref(false);

const hourOptions = Array.from({ length: 24 }, (_, i) => ({
  value: String(i).padStart(2, '0'),
  label: String(i).padStart(2, '0'),
}));
const minuteOptions = Array.from({ length: 60 }, (_, i) => ({
  value: String(i).padStart(2, '0'),
  label: String(i).padStart(2, '0'),
}));

const parts = computed(() => {
  if (!props.modelValue) return { date: null as string | null, hour: '00', minute: '00' };
  const [datePart, timePart] = props.modelValue.split('T');
  const [hour = '00', minute = '00'] = (timePart ?? '').split(':');
  return { date: datePart ?? null, hour: hour.slice(0, 2), minute: minute.slice(0, 2) };
});

const calendarValue = computed({
  get: () => {
    if (!parts.value.date) return undefined;
    try {
      return parseDate(parts.value.date);
    } catch {
      return undefined;
    }
  },
  set: (v: CalendarDate | undefined) => {
    emitCombined(v, parts.value.hour, parts.value.minute);
  },
});

function emitCombined(date: CalendarDate | undefined, hour: string, minute: string): void {
  if (!date) {
    emit('update:modelValue', null);
    return;
  }
  const isoDate = `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
  emit('update:modelValue', `${isoDate}T${hour}:${minute}:00`);
}

function setHour(h: string): void {
  const cv = calendarValue.value;
  if (!cv) return;
  emitCombined(cv, h, parts.value.minute);
}

function setMinute(m: string): void {
  const cv = calendarValue.value;
  if (!cv) return;
  emitCombined(cv, parts.value.hour, m);
}

const label = computed(() => {
  if (!props.modelValue) return props.placeholder ?? 'Pilih tanggal & waktu';
  try {
    const d = new Date(props.modelValue);
    return format(d, 'dd MMM yyyy, HH:mm', { locale: localeId });
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
      <div class="flex items-center gap-2 border-t border-border px-3 py-3">
        <Clock class="size-4 text-muted-foreground shrink-0" />
        <AppSelect
          :model-value="parts.hour"
          :options="hourOptions"
          placeholder="Jam"
          class="flex-1"
          @update:model-value="setHour"
        />
        <span class="text-muted-foreground">:</span>
        <AppSelect
          :model-value="parts.minute"
          :options="minuteOptions"
          placeholder="Menit"
          class="flex-1"
          @update:model-value="setMinute"
        />
      </div>
    </PopoverContent>
  </Popover>
</template>