<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { format } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
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
  void refData.ensureFunds();
});

interface NavItem {
  to: string;
  label: string;
  icon: unknown;
}

const mainItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
];

// Dana relevan cuma buat tenant yang punya dana (mis. edisi LAZ/PSAK 109) —
// masjid biasa tidak di-seed dana apa pun, jadi menunya disembunyikan
// daripada tampil kosong dan membingungkan.
const hasFunds = computed(() => refData.funds.length > 0);

const financeItems = computed<NavItem[]>(() => {
  const items: (NavItem | null)[] = [
    { to: '/accounts', label: 'Bagan Akun', icon: BookOpen },
    { to: '/transaction-categories', label: 'Kategori', icon: Tags },
    hasFunds.value ? { to: '/funds', label: 'Dana', icon: HandCoins } : null,
    { to: '/transactions', label: 'Transaksi', icon: ArrowLeftRight },
    { to: '/reports', label: 'Laporan', icon: FileBarChart2 },
  ];
  return items.filter((i): i is NavItem => i !== null);
});

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

const todayLabel = format(new Date(), 'EEEE, d MMM yyyy', { locale: localeId });

const pageTitle = computed(() => {
  if (route.path.startsWith('/transactions/import')) return 'Impor Transaksi';
  const all: NavItem[] = [
    ...mainItems,
    ...financeItems.value,
    ...otherItems,
    ...adminItems,
    { to: '/changelog', label: 'Changelog', icon: ScrollText },
  ];
  return all.find((i) => isActive(i.to))?.label ?? 'Dashboard';
});

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
      <SidebarHeader class="relative flex h-14 shrink-0 flex-row items-center overflow-hidden border-b border-sidebar-border p-0 px-3">
        <div aria-hidden="true" class="pointer-events-none absolute -left-14 -top-16 size-52 rounded-full bg-sidebar-primary/25 blur-3xl"></div>
        <div class="relative flex items-center gap-2.5">
          <div class="relative size-8 shrink-0">
            <div class="absolute inset-1 rounded-md bg-sidebar-primary"></div>
            <div class="absolute inset-1 rotate-45 rounded-md bg-amber-400 opacity-90"></div>
            <div class="absolute inset-[9px] rotate-45 rounded-sm bg-sidebar"></div>
          </div>
          <div class="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span class="text-sm font-semibold text-sidebar-foreground">HisabMu</span>
            <span class="text-[11px] text-sidebar-foreground/60">Keuangan Nirlaba</span>
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
      <header class="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2.5 border-b border-border/70 bg-background/80 px-4 backdrop-blur-xl">
        <SidebarTrigger class="-ml-1" />
        <Separator orientation="vertical" class="h-4" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-bold tracking-tight text-foreground">{{ pageTitle }}</p>
        </div>
        <span class="hidden items-center gap-1.5 rounded-full border border-border/70 bg-card px-3 py-1 text-[11px] font-medium capitalize text-muted-foreground shadow-xs lg:inline-flex">
          <CalendarDays class="size-3 text-primary" /> {{ todayLabel }}
        </span>
        <div v-if="auth.isSuperAdmin" class="hidden md:block">
          <TenantSwitcher />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button
              type="button"
              class="flex size-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#D9A93F] to-[#B8862A] text-xs font-extrabold text-[#0C231B] shadow-sm ring-1 ring-black/5 transition-transform hover:scale-105"
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