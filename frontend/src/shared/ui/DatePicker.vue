<script setup lang="ts">
/**
 * DatePicker — wrapper @vuepic/vue-datepicker dgn brand teal.
 *
 * v-model: string ISO date "YYYY-MM-DD" atau null.
 *
 * Usage:
 *   <DatePicker v-model="form.startDate" placeholder="Pilih tanggal" />
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
    emit('update:modelValue', `${yyyy}-${mm}-${dd}`);
  },
});
</script>

<template>
  <VueDatePicker
    v-model="internal"
    :placeholder="placeholder ?? 'Pilih tanggal'"
    :disabled="disabled"
    :enable-time-picker="false"
    :auto-apply="true"
    format="dd MMM yyyy"
    :locale="id"
    :clearable="!required"
    text-input
    class="masjidmu-dp"
  />
</template>

<style>
.masjidmu-dp {
  --dp-font-family: inherit;
  --dp-border-radius: 0.5rem;
  --dp-input-padding: 0.5rem 0.75rem;
  --dp-font-size: 0.875rem;
  --dp-border-color: rgb(226 232 240);
  --dp-border-color-hover: rgb(13 148 136);
  --dp-primary-color: rgb(13 148 136);
  --dp-primary-text-color: white;
  --dp-text-color: rgb(15 23 42);
  --dp-icon-color: rgb(100 116 139);
  --dp-success-color: rgb(13 148 136);
  --dp-input-icon-padding: 2.25rem;
}
.masjidmu-dp .dp__input {
  border-color: rgb(226 232 240);
  font-size: 0.875rem;
}
.masjidmu-dp .dp__input:focus {
  border-color: rgb(13 148 136);
  box-shadow: 0 0 0 3px rgb(13 148 136 / 0.15);
}
</style>
