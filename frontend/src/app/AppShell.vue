<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import MobileBottomNav from './MobileBottomNav.vue';
import MobileFab from './MobileFab.vue';
import MobileMoreSheet from './MobileMoreSheet.vue';
import TenantSwitcher from './TenantSwitcher.vue';
import {
  LayoutDashboard,
  Megaphone,
  LogOut,
  Building2,
  Sparkles,
  CalendarDays,
  FileBarChart2,
  Newspaper,
  Images,
  ChevronRight,
  BookOpen,
  Tags,
  ArrowLeftRight,
  HandCoins,
  ScrollText,
  LayoutGrid,
  User,
} from 'lucide-vue-next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useAuthStore } from '@/features/auth/store';
import { useReferenceDataStore } from '@/shared/stores/reference-data';

const ROUTE_CHUNKS = [
  () => import('@/features/dashboard/DashboardView.vue'),
  () => import('@/features/transactions/TransactionsView.vue'),
  () => import('@/features/accounts/AccountsView.vue'),
  () => import('@/features/transaction-categories/TransactionCategoriesView.vue'),
  () => import('@/features/reports/ReportsView.vue'),
  () => import('@/features/announcements/AnnouncementsView.vue'),
  () => import('@/features/events/EventsView.vue'),
  () => import('@/features/programs/ProgramsView.vue'),
  () => import('@/features/mosque-profile/MosqueProfileView.vue'),
];

function prefetchRoutes(): void {
  const run = () => ROUTE_CHUNKS.forEach((load) => void load());
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run);
  else setTimeout(run, 200);
}

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const refData = useReferenceDataStore();

onMounted(() => {
  prefetchRoutes();
  void refData.ensureAccounts();
  void refData.ensureCategories();
});

interface NavItem {
  to: string;
  label: string;
  icon: unknown;
}

const mainItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
];

const financeItems: NavItem[] = [
  { to: '/accounts', label: 'Bagan Akun', icon: BookOpen },
  { to: '/transaction-categories', label: 'Kategori', icon: Tags },
  { to: '/funds', label: 'Dana', icon: HandCoins },
  { to: '/transactions', label: 'Transaksi', icon: ArrowLeftRight },
  { to: '/reports', label: 'Laporan', icon: FileBarChart2 },
];

const otherItems: NavItem[] = [
  { to: '/mosque-profile', label: 'Profil Masjid', icon: Building2 },
  { to: '/programs', label: 'Program', icon: Sparkles },
  { to: '/events', label: 'Event', icon: CalendarDays },
  { to: '/posts', label: 'Berita', icon: Newspaper },
  { to: '/galleries', label: 'Galeri', icon: Images },
  { to: '/announcements', label: 'Pengumuman', icon: Megaphone },
];

const adminItems: NavItem[] = [
  { to: '/tenants', label: 'Lembaga', icon: Building2 },
];

const otherPaths = otherItems.map((i) => i.to);
const othersOpen = ref(otherPaths.some((p) => route.path.startsWith(p)));

const moreSheetOpen = ref(false);
const bottomNavVisible = ref(true);
let lastScrollY = 0;

function onMainScroll(e: Event): void {
  const el = e.target as HTMLElement;
  const y = el.scrollTop;
  const delta = y - lastScrollY;
  if (Math.abs(delta) < 8) return;
  bottomNavVisible.value = delta < 0 || y < 48;
  lastScrollY = y;
}

const userInitial = computed(() =>
  (auth.user?.name ?? auth.user?.email ?? '?').slice(0, 1).toUpperCase(),
);

function isActive(path: string): boolean {
  if (path === '/') return route.path === '/';
  return route.path === path || route.path.startsWith(`${path}/`);
}

async function onSignOut(): Promise<void> {
  await auth.signOut();
  await router.replace('/login');
}
</script>

<template>
  <SidebarProvider>
    <Sidebar collapsible="icon" class="border-r border-sidebar-border">
      <SidebarHeader class="border-b border-sidebar-border px-3 py-3">
        <div class="flex items-center gap-2.5">
          <div class="grid size-8 shrink-0 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground text-sm font-bold">
            H
          </div>
          <div class="flex flex-col group-data-[collapsible=icon]:hidden">
            <span class="text-sm font-semibold text-sidebar-foreground">HisabMu</span>
            <span class="text-xs text-sidebar-foreground/60">Keuangan Nirlaba</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Utama</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in mainItems" :key="item.to">
                <SidebarMenuButton as-child :is-active="isActive(item.to)" :tooltip="item.label">
                  <RouterLink :to="item.to">
                    <component :is="item.icon" />
                    <span>{{ item.label }}</span>
                  </RouterLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Keuangan</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in financeItems" :key="item.to">
                <SidebarMenuButton as-child :is-active="isActive(item.to)" :tooltip="item.label">
                  <RouterLink :to="item.to">
                    <component :is="item.icon" />
                    <span>{{ item.label }}</span>
                  </RouterLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Konten</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <Collapsible v-model:open="othersOpen" class="group/collapsible">
                <SidebarMenuItem>
                  <CollapsibleTrigger as-child>
                    <SidebarMenuButton tooltip="Lainnya">
                      <LayoutGrid />
                      <span>Lainnya</span>
                      <ChevronRight class="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem v-for="item in otherItems" :key="item.to">
                        <SidebarMenuSubButton as-child :is-active="isActive(item.to)">
                          <RouterLink :to="item.to">
                            <component :is="item.icon" />
                            <span>{{ item.label }}</span>
                          </RouterLink>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup v-if="auth.isSuperAdmin">
          <SidebarGroupLabel>Admin</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in adminItems" :key="item.to">
                <SidebarMenuButton as-child :is-active="isActive(item.to)" :tooltip="item.label">
                  <RouterLink :to="item.to">
                    <component :is="item.icon" />
                    <span>{{ item.label }}</span>
                  </RouterLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter class="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton as-child :is-active="isActive('/changelog')" tooltip="Changelog">
              <RouterLink to="/changelog">
                <ScrollText />
                <span>Changelog</span>
              </RouterLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>

    <SidebarInset>
      <header class="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur-md">
        <SidebarTrigger class="-ml-1" />
        <Separator orientation="vertical" class="mr-2 h-4" />
        <div class="flex-1 truncate">
          <p class="text-sm font-semibold text-foreground md:hidden">HisabMu</p>
          <div v-if="auth.isSuperAdmin" class="hidden md:flex">
            <TenantSwitcher />
          </div>
          <p v-else class="hidden text-sm text-muted-foreground md:block">{{ auth.user?.email }}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button
              type="button"
              class="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground hover:bg-accent transition-colors"
            >
              {{ userInitial }}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-48">
            <DropdownMenuLabel class="font-normal">
              <div class="flex flex-col gap-0.5">
                <span class="text-sm font-medium">{{ auth.user?.name ?? 'Pengurus' }}</span>
                <span class="text-xs text-muted-foreground truncate">{{ auth.user?.email }}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              <User class="mr-2 size-4" />
              Profil (segera)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem class="text-destructive focus:text-destructive" @click="onSignOut">
              <LogOut class="mr-2 size-4" />
              Keluar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <main
        class="flex-1 overflow-y-auto p-4 pb-28 md:pb-6 md:p-6"
        @scroll="onMainScroll"
      >
        <RouterView v-slot="{ Component }">
          <KeepAlive :max="12">
            <component :is="Component" :key="route.name ?? route.path" />
          </KeepAlive>
        </RouterView>
      </main>

      <MobileFab />
      <MobileBottomNav :visible="bottomNavVisible" @more="moreSheetOpen = true" />
      <MobileMoreSheet v-model:open="moreSheetOpen" />
    </SidebarInset>
  </SidebarProvider>
</template>