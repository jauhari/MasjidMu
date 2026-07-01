<script setup lang="ts">
import { RouterView } from 'vue-router';
import { Toaster } from '@/components/ui/sonner';
import { useAuthStore } from '@/features/auth/store';
import { storeToRefs } from 'pinia';

const auth = useAuthStore();
const { initialized } = storeToRefs(auth);
</script>

<template>
  <div v-if="!initialized" class="grid min-h-svh place-items-center bg-background">
    <div class="flex flex-col items-center gap-3">
      <div
        class="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
        aria-hidden="true"
      />
      <p class="text-sm text-muted-foreground">Memuat…</p>
    </div>
  </div>
  <template v-else>
    <RouterView />
    <Toaster position="top-right" rich-colors close-button />
  </template>
</template>