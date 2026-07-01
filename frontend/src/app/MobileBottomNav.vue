<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { Home, Wallet, CalendarDays, Menu } from 'lucide-vue-next';
import { cn } from '@/lib/utils';

defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{ more: [] }>();

const route = useRoute();

const financePaths = ['/accounts', '/transaction-categories', '/transactions', '/reports'];
const agendaPaths = ['/events'];
const morePaths = [
  '/mosque-profile',
  '/programs',
  '/posts',
  '/galleries',
  '/announcements',
  '/changelog',
];

const tabs = computed(() => [
  {
    id: 'home',
    label: 'Beranda',
    to: '/',
    icon: Home,
    active: route.path === '/',
  },
  {
    id: 'finance',
    label: 'Keuangan',
    to: '/transactions',
    icon: Wallet,
    active: financePaths.some((p) => route.path === p || route.path.startsWith(`${p}/`)),
  },
  {
    id: 'agenda',
    label: 'Agenda',
    to: '/events',
    icon: CalendarDays,
    active: agendaPaths.some((p) => route.path === p || route.path.startsWith(`${p}/`)),
  },
  {
    id: 'more',
    label: 'Lainnya',
    to: null as string | null,
    icon: Menu,
    active: morePaths.some((p) => route.path === p || route.path.startsWith(`${p}/`)),
  },
]);
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur-md transition-transform duration-300 ease-out md:hidden"
    :class="visible ? 'translate-y-0' : 'translate-y-full'"
    aria-label="Navigasi utama"
  >
    <div class="mx-auto grid h-16 max-w-lg grid-cols-4 pb-[env(safe-area-inset-bottom)]">
      <template v-for="tab in tabs" :key="tab.id">
        <button
          v-if="tab.id === 'more'"
          type="button"
          class="flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors"
          :class="tab.active ? 'text-primary' : 'text-muted-foreground'"
          @click="emit('more')"
        >
          <component :is="tab.icon" class="size-5" />
          <span>{{ tab.label }}</span>
        </button>
        <RouterLink
          v-else
          :to="tab.to!"
          class="flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors"
          :class="cn(tab.active ? 'text-primary' : 'text-muted-foreground')"
        >
          <component :is="tab.icon" class="size-5" />
          <span>{{ tab.label }}</span>
        </RouterLink>
      </template>
    </div>
  </nav>
</template>