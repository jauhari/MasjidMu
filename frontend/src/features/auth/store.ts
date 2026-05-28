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
import { api, getTenantSlug, setTenantSlug } from '@/shared/api/client';

interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
}

interface SessionResponse {
  user: AuthUser;
  session: { id: string; expiresAt: string };
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null);
  const tenantSlug = ref<string | null>(getTenantSlug());
  const initialized = ref(false);
  const isAuthenticated = computed(() => user.value != null);

  async function init(): Promise<void> {
    if (initialized.value) return;
    try {
      const res = await api.get<SessionResponse | null>('/api/auth/get-session');
      user.value = res?.user ?? null;
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
  }

  async function signOut(): Promise<void> {
    try {
      await api.post('/api/auth/sign-out');
    } finally {
      user.value = null;
      setTenantSlug(null);
      tenantSlug.value = null;
    }
  }

  return { user, tenantSlug, isAuthenticated, initialized, init, signIn, signOut };
});
