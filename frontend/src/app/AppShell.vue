<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { LayoutDashboard, Megaphone, LogOut, Building2, Sparkles, CalendarDays, FileBarChart2 } from 'lucide-vue-next';
import { useAuthStore } from '@/features/auth/store';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const items = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/mosque-profile', label: 'Profil Masjid', icon: Building2 },
  { to: '/programs', label: 'Program', icon: Sparkles },
  { to: '/events', label: 'Event', icon: CalendarDays },
  { to: '/announcements', label: 'Pengumuman', icon: Megaphone },
  { to: '/reports', label: 'Laporan', icon: FileBarChart2 },
];

const userInitial = computed(() =>
  (auth.user?.name ?? auth.user?.email ?? '?').slice(0, 1).toUpperCase(),
);

async function onSignOut(): Promise<void> {
  await auth.signOut();
  await router.replace('/login');
}
</script>

<template>
  <div class="min-h-full grid grid-cols-[16rem_1fr]">
    <aside class="border-r border-slate-200 bg-white">
      <div class="flex items-center gap-3 px-5 py-4 border-b border-slate-200">
        <div class="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-white font-bold">M</div>
        <div>
          <p class="text-sm font-semibold leading-tight">MasjidMu</p>
          <p class="text-xs text-slate-500 leading-tight">Pengurus</p>
        </div>
      </div>

      <nav class="px-2 py-3 space-y-1">
        <RouterLink
          v-for="item in items"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          :class="{ 'bg-brand-50 text-brand-700 font-medium': route.path === item.to }"
        >
          <component :is="item.icon" class="h-4 w-4" />
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>

    <div class="flex flex-col">
      <header class="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div class="text-sm text-slate-500">
          {{ auth.user?.email }}
        </div>
        <div class="flex items-center gap-3">
          <div class="grid h-8 w-8 place-items-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
            {{ userInitial }}
          </div>
          <button
            class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
            @click="onSignOut"
          >
            <LogOut class="h-3.5 w-3.5" /> Keluar
          </button>
        </div>
      </header>

      <main class="flex-1 overflow-y-auto p-6">
        <RouterView />
      </main>
    </div>
  </div>
</template>
