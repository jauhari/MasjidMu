<script setup lang="ts">
/**
 * TenantSwitcher — GOD mode: pindah lembaga tanpa logout.
 *
 * Hanya dirender untuk super_admin (lihat AppShell). Daftar lembaga dari
 * GET /api/v1/tenants (endpoint yang sama dipakai TenantsView, super_admin
 * only). Pindah tenant = ganti X-Tenant-Slug lalu reload halaman penuh —
 * paling sederhana & aman, bukan aksi yang sering dipakai.
 */
import { computed, ref } from 'vue';
import { Building2, Check, ChevronsUpDown } from 'lucide-vue-next';
import { api, formatApiError } from '@/shared/api/client';
import { useAuthStore } from '@/features/auth/store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Tenant {
  id: string;
  slug: string;
  name: string;
  edition: string;
  isActive: boolean;
}

const auth = useAuthStore();
const tenants = ref<Tenant[]>([]);
const loading = ref(false);
const switching = ref<string | null>(null);
const error = ref<string | null>(null);

const currentLabel = computed(
  () => tenants.value.find((t) => t.slug === auth.tenantSlug)?.name ?? auth.tenantSlug ?? '—',
);

async function loadTenants(open: boolean): Promise<void> {
  if (!open || tenants.value.length || loading.value) return;
  loading.value = true;
  error.value = null;
  try {
    const res = await api.get<{ data: Tenant[] }>('/api/v1/tenants');
    tenants.value = res.data;
  } catch (err) {
    error.value = formatApiError(err);
  } finally {
    loading.value = false;
  }
}

async function switchTo(slug: string): Promise<void> {
  if (slug === auth.tenantSlug || switching.value) return;
  switching.value = slug;
  try {
    await auth.switchTenant(slug);
    window.location.href = '/';
  } catch (err) {
    error.value = formatApiError(err);
    switching.value = null;
  }
}
</script>

<template>
  <DropdownMenu @update:open="loadTenants">
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        class="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Pindah lembaga (GOD mode)"
      >
        <Building2 class="size-3.5 shrink-0 text-primary" />
        <span class="truncate font-medium text-foreground">{{ currentLabel }}</span>
        <ChevronsUpDown class="size-3 shrink-0 opacity-50" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="w-64">
      <DropdownMenuLabel class="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
        <Building2 class="size-3.5" /> Pindah Lembaga (GOD mode)
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <div v-if="loading" class="px-2 py-3 text-center text-xs text-muted-foreground">Memuat…</div>
      <div v-else-if="error" class="px-2 py-2 text-xs text-destructive">{{ error }}</div>
      <DropdownMenuItem
        v-for="t in tenants"
        :key="t.id"
        :disabled="!!switching"
        class="flex items-center gap-2"
        @click="switchTo(t.slug)"
      >
        <Check v-if="t.slug === auth.tenantSlug" class="size-3.5 shrink-0 text-primary" />
        <span v-else class="size-3.5 shrink-0" />
        <span class="min-w-0 flex-1 truncate">{{ t.name }}</span>
        <span class="shrink-0 text-[10px] text-muted-foreground">{{ t.slug }}</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
