<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import FormField from '@/shared/ui/FormField.vue';
import Button from '@/shared/ui/Button.vue';
import { useAuthStore } from './store';

const router = useRouter();
const auth = useAuthStore();

const form = reactive({
  email: '',
  password: '',
  tenantSlug: 'al-uula',
});
const submitting = ref(false);
const error = ref<string | null>(null);

async function onSubmit(): Promise<void> {
  submitting.value = true;
  error.value = null;
  try {
    await auth.signIn(form.email, form.password, form.tenantSlug);
    const redirect = router.currentRoute.value.query.redirect as string | undefined;
    await router.replace(redirect ?? '/');
  } catch (err) {
    const e = err as { status?: number; body?: { message?: string } };
    error.value =
      e.status === 401
        ? 'Email atau kata sandi salah.'
        : (e.body?.message ?? 'Gagal masuk. Coba lagi.');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="min-h-full grid place-items-center bg-muted/40 px-4 py-12">
    <Card class="w-full max-w-sm shadow-md">
      <CardHeader class="flex flex-row items-center gap-3 space-y-0 pb-4">
        <div class="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground font-bold">
          H
        </div>
        <div>
          <CardTitle class="text-base">HisabMu</CardTitle>
          <CardDescription>Akuntansi & transparansi lembaga umat</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
          <FormField label="Slug masjid" html-for="tenantSlug" required>
            <Input
              id="tenantSlug"
              v-model="form.tenantSlug"
              required
              autocomplete="organization"
              placeholder="al-uula"
            />
          </FormField>

          <FormField label="Email" html-for="email" required>
            <Input
              id="email"
              v-model="form.email"
              type="email"
              required
              autocomplete="email"
              placeholder="admin@hisabmu.id"
            />
          </FormField>

          <FormField label="Kata sandi" html-for="password" required>
            <Input
              id="password"
              v-model="form.password"
              type="password"
              required
              autocomplete="current-password"
            />
          </FormField>

          <Alert v-if="error" variant="destructive">
            <AlertDescription>{{ error }}</AlertDescription>
          </Alert>

          <Button type="submit" class="w-full" :loading="submitting">
            {{ submitting ? 'Memproses…' : 'Masuk' }}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>