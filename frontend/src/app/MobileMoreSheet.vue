<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import {
  Building2,
  Sparkles,
  Newspaper,
  Images,
  Megaphone,
  ScrollText,
  BookOpen,
  Tags,
  FileBarChart2,
  Landmark,
} from 'lucide-vue-next';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useAuthStore } from '@/features/auth/store';
import TenantSwitcher from './TenantSwitcher.vue';

defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{ 'update:open': [boolean] }>();

const auth = useAuthStore();

const sections = computed(() => [
  {
    label: 'Konten',
    items: [
      { to: '/mosque-profile', label: 'Profil Masjid', icon: Building2 },
      { to: '/programs', label: 'Program', icon: Sparkles },
      { to: '/posts', label: 'Berita', icon: Newspaper },
      { to: '/galleries', label: 'Galeri', icon: Images },
      { to: '/announcements', label: 'Pengumuman', icon: Megaphone },
    ],
  },
  {
    label: 'Keuangan',
    items: [
      { to: '/accounts', label: 'Bagan Akun', icon: BookOpen },
      { to: '/transaction-categories', label: 'Kategori', icon: Tags },
      { to: '/reports', label: 'Laporan', icon: FileBarChart2 },
    ],
  },
  {
    label: 'Lainnya',
    items: [{ to: '/changelog', label: 'Changelog', icon: ScrollText }],
  },
  ...(auth.isSuperAdmin
    ? [
        {
          label: 'Admin',
          items: [{ to: '/tenants', label: 'Lembaga', icon: Landmark }],
        },
      ]
    : []),
]);
</script>

<template>
  <Sheet :open="open" @update:open="emit('update:open', $event)">
    <SheetContent side="bottom" class="max-h-[85vh] rounded-t-2xl px-0 pb-[env(safe-area-inset-bottom)]">
      <SheetHeader class="px-5 text-left">
        <SheetTitle>Menu lainnya</SheetTitle>
        <SheetDescription>Profil, konten, dan pengaturan tambahan</SheetDescription>
      </SheetHeader>
      <div class="mt-2 overflow-y-auto px-3 pb-4">
        <section v-if="auth.isSuperAdmin" class="mb-4">
          <p class="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Lembaga aktif
          </p>
          <div class="px-2">
            <TenantSwitcher />
          </div>
        </section>
        <section v-for="section in sections" :key="section.label" class="mb-4">
          <p class="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {{ section.label }}
          </p>
          <ul class="flex flex-col gap-0.5">
            <li v-for="item in section.items" :key="item.to">
              <RouterLink
                :to="item.to"
                class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
                @click="emit('update:open', false)"
              >
                <component :is="item.icon" class="size-4 text-muted-foreground" />
                {{ item.label }}
              </RouterLink>
            </li>
          </ul>
        </section>
      </div>
    </SheetContent>
  </Sheet>
</template>