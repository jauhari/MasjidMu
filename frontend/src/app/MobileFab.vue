<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { Plus, ArrowLeftRight, CalendarDays, Megaphone } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const router = useRouter();
const open = ref(false);

const actions = [
  { label: 'Tambah transaksi', icon: ArrowLeftRight, to: { path: '/transactions', query: { action: 'create' } } },
  { label: 'Tambah agenda', icon: CalendarDays, to: '/events' },
  { label: 'Tambah pengumuman', icon: Megaphone, to: '/announcements' },
];

async function go(to: string | { path: string; query?: Record<string, string> }): Promise<void> {
  open.value = false;
  await router.push(to);
}
</script>

<template>
  <div class="fixed right-4 z-50 md:hidden" style="bottom: calc(4rem + 1.875rem + env(safe-area-inset-bottom))">
    <DropdownMenu v-model:open="open">
      <DropdownMenuTrigger as-child>
        <Button
          size="icon"
          class="size-14 rounded-full shadow-lg"
          aria-label="Aksi cepat"
        >
          <Plus class="size-6" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" class="w-52">
        <DropdownMenuLabel>Aksi cepat</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          v-for="action in actions"
          :key="action.label"
          class="gap-2"
          @click="go(action.to)"
        >
          <component :is="action.icon" class="size-4" />
          {{ action.label }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>