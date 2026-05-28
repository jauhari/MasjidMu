<script setup lang="ts">
import { RouterView } from 'vue-router';
import { Toaster } from 'vue-sonner';
import 'vue-sonner/style.css';
</script>

<template>
  <RouterView />
  <Toaster
    position="top-right"
    rich-colors
    close-button
    :toast-options="{
      class: 'rounded-lg border border-slate-200 shadow-lg',
    }"
  />
</template>
