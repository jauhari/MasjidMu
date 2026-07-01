/**
 * Auth store — wraps better-auth's session endpoint.
 *
 * Login: POST /api/auth/sign-in/email; cookie set by server.
 * Resume: GET /api/auth/get-session on app boot to hydrate the user.
 * Logout: POST /api/auth/sign-out.
 *
 * Tenant slug is also tracked here for dev (set by login form / tenant picker)
 * — the API client picks it up via `setTenantSlug` so every request carries
 * the `X-Tenant-Slug` header backend tenantResolver expects in dev.
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, clearApiGetCache, getTenantSlug, setTenantSlug } from '@/shared/api/client';

interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
}

interface SessionResponse {
  user: AuthUser;
  session: { id: string; expiresAt: string };
}

interface MeResponse {
  data: {
    id: string;
    email: string;
    name: string | null;
    isSuperAdmin: boolean;
    permissions: string[];
  };
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null);
  const tenantSlug = ref<string | null>(getTenantSlug());
  const initialized = ref(false);
  const isAuthenticated = computed(() => user.value != null);
  const isSuperAdmin = ref(false);
  const permissions = ref<Set<string>>(new Set());

  function hasPermission(code: string): boolean {
    return isSuperAdmin.value || permissions.value.has(code);
  }

  async function fetchMe(): Promise<void> {
    try {
      const res = await api.get<MeResponse>('/api/v1/me');
      isSuperAdmin.value = res.data.isSuperAdmin;
      permissions.value = new Set(res.data.permissions);
    } catch {
      isSuperAdmin.value = false;
      permissions.value = new Set();
    }
  }

  async function init(): Promise<void> {
    if (initialized.value) return;
    try {
      const res = await api.get<SessionResponse | null>('/api/auth/get-session');
      user.value = res?.user ?? null;
      if (user.value && tenantSlug.value) await fetchMe();
    } catch {
      user.value = null;
    } finally {
      initialized.value = true;
    }
  }

  async function signIn(email: string, password: string, slug: string): Promise<void> {
    setTenantSlug(slug);
    tenantSlug.value = slug;
    const res = await api.post<SessionResponse>('/api/auth/sign-in/email', {
      email,
      password,
    });
    user.value = res.user;
    await fetchMe();
  }

  /**
   * GOD mode: switch acting tenant without signing out. Only meaningful for
   * super_admin — regular users only ever have one tenant slug (set at
   * login) and have no reason to call this. Caller is responsible for
   * reloading the page afterwards so every per-page cached ref starts fresh
   * for the new tenant (simplest correct option — this is a rare admin
   * action, not worth a reactive cross-store cache-invalidation system).
   */
  async function switchTenant(slug: string): Promise<void> {
    setTenantSlug(slug);
    tenantSlug.value = slug;
    clearApiGetCache();
    await fetchMe();
  }

  async function signOut(): Promise<void> {
    try {
      await api.post('/api/auth/sign-out');
    } finally {
      user.value = null;
      isSuperAdmin.value = false;
      permissions.value = new Set();
      setTenantSlug(null);
      tenantSlug.value = null;
    }
  }

  return {
    user,
    tenantSlug,
    isAuthenticated,
    isSuperAdmin,
    permissions,
    initialized,
    hasPermission,
    init,
    signIn,
    switchTenant,
    signOut,
  };
});
