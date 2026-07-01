<script setup lang="ts">
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

defineProps<{
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string | null;
  hint?: string | null;
  class?: string;
}>();
</script>

<template>
  <div :class="cn('flex flex-col gap-1.5 overflow-visible', $props.class)">
    <Label :for="htmlFor" class="text-sm font-medium text-foreground">
      {{ label }}
      <span v-if="required" class="text-destructive">*</span>
    </Label>
    <slot />
    <p v-if="hint && !error" class="text-xs text-muted-foreground">{{ hint }}</p>
    <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
  </div>
</template>