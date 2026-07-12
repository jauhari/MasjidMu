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
});
const submitting = ref(false);
const googleSubmitting = ref(false);
const error = ref<string | null>(null);

async function onSubmit(): Promise<void> {
  submitting.value = true;
  error.value = null;
  try {
    await auth.signIn(form.email, form.password);
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

async function onGoogleSignIn(): Promise<void> {
  googleSubmitting.value = true;
  error.value = null;
  try {
    // Redirects the whole page to Google — only returns early on failure
    // (e.g. provider not configured on the server yet).
    await auth.signInWithGoogle();
  } catch {
    error.value = 'Login dengan Google belum tersedia. Coba email & kata sandi.';
    googleSubmitting.value = false;
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
        <div class="flex flex-col gap-4">
          <Button
            type="button"
            variant="outline"
            class="w-full"
            :loading="googleSubmitting"
            @click="onGoogleSignIn"
          >
            <svg v-if="!googleSubmitting" viewBox="0 0 24 24" class="mr-2 size-4">
              <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.44a5.5 5.5 0 0 1-2.39 3.6v3h3.86c2.26-2.08 3.58-5.15 3.58-8.63Z" />
              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.28v3.1A12 12 0 0 0 12 24Z" />
              <path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28v-3.1H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.38l3.99-3.1Z" />
              <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.94 1.19 15.23 0 12 0 7.31 0 3.26 2.69 1.28 6.62l3.99 3.1C6.22 6.86 8.87 4.75 12 4.75Z" />
            </svg>
            {{ googleSubmitting ? 'Mengalihkan…' : 'Lanjutkan dengan Google' }}
          </Button>

          <div class="flex items-center gap-3">
            <div class="h-px flex-1 bg-border" />
            <span class="text-xs text-muted-foreground">atau</span>
            <div class="h-px flex-1 bg-border" />
          </div>

          <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
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
        </div>
      </CardContent>
    </Card>
  </div>
</template>
