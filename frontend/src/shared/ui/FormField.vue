<script setup lang="ts">
/**
 * FormField — label + slot for input + optional error message.
 *
 * Usage:
 *   <FormField label="Nama" :error="errors.name">
 *     <input v-model="form.name" class="..." />
 *   </FormField>
 */
defineProps<{
  label: string;
  required?: boolean;
  error?: string | null;
  hint?: string | null;
}>();
</script>

<template>
  <div class="mb-3">
    <label class="block text-sm font-medium text-slate-700">
      {{ label }} <span v-if="required" class="text-red-500">*</span>
    </label>
    <div class="mt-1"><slot /></div>
    <p v-if="hint && !error" class="mt-1 text-xs text-slate-500">{{ hint }}</p>
    <p v-if="error" class="mt-1 text-xs text-red-600">{{ error }}</p>
  </div>
</template>
