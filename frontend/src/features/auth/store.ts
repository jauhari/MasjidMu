/**
 * Auth store — wraps better-auth's session endpoint.
 *
 * Login: POST /api/auth/sign-in/email (or Google redirect); cookie set by
 * server either way — no tenant slug needed from the client at all. The
 * backend resolves which lembaga a user belongs to on its own (see
 * `resolveHomeTenantSlug` in backend/src/middleware/tenant.ts); `fetchMe()`
 * just picks up whatever slug the server reports and caches it locally so
 * later requests carry it as `X-Tenant-Slug` (superseded once the app moves
 * to real subdomains — see that file's comments).
 * Resume: GET /api/auth/get-session on app boot to hydrate the user.
 * Logout: POST /api/auth/sign-out.
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, clearApiGetCache, getTenantSlug, setTenantSlug } from '@/shared/api/client';
import { authClient } from '@/shared/api/auth-client';

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
    tenant?: {
      id: string;
      slug: string;
      name: string;
      edition: string;
    } | null;
  };
}

/** "lazismu-ponjong" → "Lazismu Ponjong" — fallback terakhir jika name kosong. */
export function humanizeSlug(slug: string | null | undefined): string {
  if (!slug) return '';
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null);
  const tenantSlug = ref<string | null>(getTenantSlug());
  /** Nama cantik lembaga dari DB (bukan slug). */
  const tenantName = ref<string | null>(null);
  const tenantEdition = ref<string | null>(null);
  const initialized = ref(false);
  const isAuthenticated = computed(() => user.value != null);
  const isSuperAdmin = ref(false);
  const permissions = ref<Set<string>>(new Set());

  /** Label tampilan: tenantName → title-case slug → HisabMu */
  const tenantDisplayName = computed(() => {
    if (tenantName.value?.trim()) return tenantName.value.trim();
    return humanizeSlug(tenantSlug.value) || 'HisabMu';
  });

  function hasPermission(code: string): boolean {
    return isSuperAdmin.value || permissions.value.has(code);
  }

  async function fetchMe(): Promise<void> {
    try {
      const res = await api.get<MeResponse>('/api/v1/me');
      isSuperAdmin.value = res.data.isSuperAdmin;
      permissions.value = new Set(res.data.permissions);
      if (res.data.tenant) {
        tenantName.value = res.data.tenant.name || null;
        tenantEdition.value = res.data.tenant.edition || null;
        // Keep slug in sync if server resolved a different one
        if (res.data.tenant.slug && res.data.tenant.slug !== tenantSlug.value) {
          setTenantSlug(res.data.tenant.slug);
          tenantSlug.value = res.data.tenant.slug;
        }
      }
    } catch {
      isSuperAdmin.value = false;
      permissions.value = new Set();
      tenantName.value = null;
      tenantEdition.value = null;
    }
  }

  async function init(): Promise<void> {
    if (initialized.value) return;
    try {
      const res = await api.get<SessionResponse | null>('/api/auth/get-session');
      user.value = res?.user ?? null;
      // Always resolve — the server figures out the tenant on its own now,
      // not gated on already having a cached slug (fresh login, cleared
      // localStorage, or a Google-redirect session all start with none).
      if (user.value) await fetchMe();
    } catch {
      user.value = null;
    } finally {
      initialized.value = true;
    }
  }

  async function signIn(email: string, password: string): Promise<void> {
    const res = await api.post<SessionResponse>('/api/auth/sign-in/email', {
      email,
      password,
    });
    user.value = res.user;
    await fetchMe();
  }

  /** Redirects to Google's consent screen; resumes via init() on return. */
  async function signInWithGoogle(): Promise<void> {
    await authClient.signIn.social({ provider: 'google', callbackURL: '/' });
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
      // better-auth requires a real JSON body on POST — an empty call sends
      // no Content-Type at all and 415s, silently leaving the session
      // cookie alive server-side while the UI already looks signed out.
      await api.post('/api/auth/sign-out', {});
    } finally {
      user.value = null;
      isSuperAdmin.value = false;
      permissions.value = new Set();
      setTenantSlug(null);
      tenantSlug.value = null;
      tenantName.value = null;
      tenantEdition.value = null;
    }
  }

  return {
    user,
    tenantSlug,
    tenantName,
    tenantEdition,
    tenantDisplayName,
    isAuthenticated,
    isSuperAdmin,
    permissions,
    initialized,
    hasPermission,
    init,
    fetchMe,
    signIn,
    signInWithGoogle,
    switchTenant,
    signOut,
  };
});
