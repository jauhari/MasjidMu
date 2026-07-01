<script setup lang="ts">
import { computed } from 'vue';
import { Loader2 } from 'lucide-vue-next';
import { Button as UiButton } from '@/components/ui/button';
import type { ButtonVariants } from '@/components/ui/button';

const props = defineProps<{
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline' | 'link';
  type?: 'button' | 'submit';
  loading?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'icon';
  class?: string;
}>();

const mappedVariant = computed((): ButtonVariants['variant'] => {
  switch (props.variant) {
    case 'secondary':
      return 'outline';
    case 'danger':
      return 'destructive';
    case 'ghost':
      return 'ghost';
    case 'outline':
      return 'outline';
    case 'link':
      return 'link';
    default:
      return 'default';
  }
});

const mappedSize = computed((): ButtonVariants['size'] => {
  if (props.size === 'sm') return 'sm';
  if (props.size === 'lg') return 'lg';
  if (props.size === 'icon') return 'icon';
  return 'default';
});
</script>

<template>
  <UiButton
    :type="type ?? 'button'"
    :variant="mappedVariant"
    :size="mappedSize"
    :disabled="disabled || loading"
    :class="props.class"
  >
    <Loader2 v-if="loading" class="size-4 animate-spin" />
    <slot />
  </UiButton>
</template>