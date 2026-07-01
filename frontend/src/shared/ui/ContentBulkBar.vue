<script setup lang="ts">
import { Alert, AlertDescription } from '@/components/ui/alert';
import AppCheckbox from '@/shared/ui/AppCheckbox.vue';
import Button from '@/shared/ui/Button.vue';

defineProps<{
  selectedCount: number;
  allSelected: boolean;
  acting?: boolean;
  error?: string | null;
}>();

const emit = defineEmits<{
  'toggle-all': [];
  clear: [];
}>();
</script>

<template>
  <div v-if="selectedCount > 0" class="flex flex-col gap-2">
    <div
      class="flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3"
    >
      <AppCheckbox
        :model-value="allSelected"
        label="Pilih semua"
        @update:model-value="emit('toggle-all')"
      />
      <span class="text-sm font-medium text-foreground">{{ selectedCount }} dipilih</span>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <slot />
        <Button variant="ghost" size="sm" :disabled="acting" @click="emit('clear')">
          Batal
        </Button>
      </div>
    </div>
    <Alert v-if="error" variant="destructive">
      <AlertDescription class="text-xs">{{ error }}</AlertDescription>
    </Alert>
  </div>
</template>