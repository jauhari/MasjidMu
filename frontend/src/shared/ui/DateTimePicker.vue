<script setup lang="ts">
/**
 * DateTimePicker — wrapper @vuepic/vue-datepicker dgn time picker enabled.
 *
 * v-model: string ISO datetime "YYYY-MM-DDTHH:mm" (datetime-local format) atau null.
 *
 * Usage:
 *   <DateTimePicker v-model="form.startsAt" placeholder="Pilih tanggal & waktu" />
 */
import { computed } from 'vue';
import { VueDatePicker } from '@vuepic/vue-datepicker';
import { id } from 'date-fns/locale/id';
import '@vuepic/vue-datepicker/dist/main.css';

const props = defineProps<{
  modelValue: string | null | undefined;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [string | null] }>();

const internal = computed<Date | null>({
  get: () => (props.modelValue ? new Date(props.modelValue) : null),
  set: (v) => {
    if (!v) {
      emit('update:modelValue', null);
      return;
    }
    const yyyy = v.getFullYear();
    const mm = String(v.getMonth() + 1).padStart(2, '0');
    const dd = String(v.getDate()).padStart(2, '0');
    const hh = String(v.getHours()).padStart(2, '0');
    const mi = String(v.getMinutes()).padStart(2, '0');
    emit('update:modelValue', `${yyyy}-${mm}-${dd}T${hh}:${mi}`);
  },
});
</script>

<template>
  <VueDatePicker
    v-model="internal"
    :placeholder="placeholder ?? 'Pilih tanggal & waktu'"
    :disabled="disabled"
    :enable-time-picker="true"
    :auto-apply="true"
    :is-24="true"
    format="dd MMM yyyy, HH:mm"
    :locale="id"
    :clearable="!required"
    text-input
    minutes-increment="5"
    class="masjidmu-dp"
  />
</template>
