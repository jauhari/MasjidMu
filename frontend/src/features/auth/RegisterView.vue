<script setup lang="ts">
/**
 * Self-service registration — create a new account and lembaga in one step.
 *
 * POST /api/register with { name, email, password, tenantName, edition }
 * → creates tenant + auth user + admin role in one atomic call.
 */
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Building2, Landmark, School, Sparkles } from 'lucide-vue-next';
import { api, setTenantSlug } from '@/shared/api/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import FormField from '@/shared/ui/FormField.vue';
import Button from '@/shared/ui/Button.vue';

type Edition = 'masjid' | 'laz' | 'pesantren' | 'yayasan';

const EDITION_OPTIONS: Array<{ value: Edition; label: string; desc: string; icon: typeof Building2 }> = [
  { value: 'masjid', label: 'Masjid / Mushola', desc: 'ISAK 35', icon: Building2 },
  { value: 'laz', label: 'LAZ / BAZNAS', desc: 'PSAK 109', icon: Landmark },
  { value: 'pesantren', label: 'Pesantren', desc: 'ISAK 35', icon: School },
  { value: 'yayasan', label: 'Yayasan / NGO', desc: 'ISAK 35', icon: Sparkles },
];

const router = useRouter();

const form = reactive({
  name: '',
  email: '',
  password: '',
  tenantName: '',
  edition: 'masjid' as Edition,
});

const submitting = ref(false);
const error = ref<string | null>(null);

async function onSubmit(): Promise<void> {
  submitting.value = true;
  error.value = null;
  try {
    const res = await api.post<{
      ok: boolean;
      tenant?: { id: string; slug: string; name: string };
      needsLogin?: boolean;
    }>('/api/register', {
      name: form.name,
      email: form.email,
      password: form.password,
      tenantName: form.tenantName,
      edition: form.edition,
    });

    if (res.tenant) {
      setTenantSlug(res.tenant.slug);
    }
    // Redirect to dashboard (session cookie already set by server)
    await router.replace('/');
  } catch (err) {
    const e = err as { status?: number; body?: { error?: string; detail?: string; message?: string } };
    if (e.status === 409) {
      error.value = e.body?.detail ?? 'Email sudah terdaftar. Silakan masuk.';
    } else {
      error.value = e.body?.detail ?? e.body?.message ?? 'Gagal mendaftar. Coba lagi.';
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="min-h-full grid place-items-center bg-muted/40 px-4 py-12">
    <Card class="w-full max-w-md shadow-md">
      <CardHeader class="flex flex-row items-center gap-3 space-y-0 pb-4">
        <div class="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground font-bold">
          M
        </div>
        <div>
          <CardTitle class="text-base">Daftar MizanMu</CardTitle>
          <CardDescription>Buat akun & lembaga baru</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
          <FormField label="Nama lengkap" html-for="reg-name" required>
            <Input
              id="reg-name"
              v-model="form.name"
              required
              minlength="2"
              placeholder="Budi Santoso"
              autocomplete="name"
            />
          </FormField>

          <FormField label="Email" html-for="reg-email" required>
            <Input
              id="reg-email"
              v-model="form.email"
              type="email"
              required
              placeholder="budi@masjid.id"
              autocomplete="email"
            />
          </FormField>

          <FormField label="Kata sandi" html-for="reg-password" required>
            <Input
              id="reg-password"
              v-model="form.password"
              type="password"
              required
              minlength="8"
              placeholder="Minimal 8 karakter"
              autocomplete="new-password"
            />
          </FormField>

          <div class="h-px bg-border" />

          <FormField label="Nama lembaga" html-for="reg-tenant" required>
            <Input
              id="reg-tenant"
              v-model="form.tenantName"
              required
              minlength="2"
              placeholder="Masjid Al-Ikhlas"
              autocomplete="organization"
            />
          </FormField>

          <FormField label="Jenis lembaga">
            <div class="grid grid-cols-2 gap-2">
              <button
                v-for="opt in EDITION_OPTIONS"
                :key="opt.value"
                type="button"
                class="flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-all"
                :class="
                  cn(
                    form.edition === opt.value
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-border hover:border-primary/40',
                  )
                "
                @click="form.edition = opt.value"
              >
                <component :is="opt.icon" class="size-3.5 shrink-0 text-primary" />
                <div>
                  <p class="font-medium text-foreground">{{ opt.label }}</p>
                  <p class="text-[10px] text-muted-foreground">{{ opt.desc }}</p>
                </div>
              </button>
            </div>
          </FormField>

          <Alert v-if="error" variant="destructive">
            <AlertDescription>{{ error }}</AlertDescription>
          </Alert>

          <Button type="submit" class="w-full" :loading="submitting">
            {{ submitting ? 'Membuat akun…' : 'Daftar & Mulai' }}
          </Button>

          <p class="text-center text-xs text-muted-foreground">
            Sudah punya akun?
            <router-link to="/login" class="font-medium text-primary hover:underline">
              Masuk
            </router-link>
          </p>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
