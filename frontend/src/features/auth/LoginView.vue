<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from './store';

const router = useRouter();
const auth = useAuthStore();

const form = reactive({
  email: '',
  password: '',
  tenantSlug: 'admin',
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
  <div class="min-h-full grid place-items-center bg-slate-50 px-4 py-12">
    <form
      class="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      @submit.prevent="onSubmit"
    >
      <div class="mb-6 flex items-center gap-3">
        <div class="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white font-bold">M</div>
        <div>
          <h1 class="text-base font-semibold">MasjidMu</h1>
          <p class="text-xs text-slate-500">Masuk ke dashboard pengurus</p>
        </div>
      </div>

      <label class="block text-sm font-medium text-slate-700" for="tenantSlug">Slug masjid</label>
      <input
        id="tenantSlug"
        v-model="form.tenantSlug"
        type="text"
        required
        autocomplete="organization"
        class="mt-1 mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
        placeholder="admin"
      />

      <label class="block text-sm font-medium text-slate-700" for="email">Email</label>
      <input
        id="email"
        v-model="form.email"
        type="email"
        required
        autocomplete="email"
        class="mt-1 mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
        placeholder="admin@masjidmu.id"
      />

      <label class="block text-sm font-medium text-slate-700" for="password">Kata sandi</label>
      <input
        id="password"
        v-model="form.password"
        type="password"
        required
        autocomplete="current-password"
        class="mt-1 mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
      />

      <p v-if="error" class="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {{ error }}
      </p>

      <button
        type="submit"
        :disabled="submitting"
        class="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {{ submitting ? 'Memproses…' : 'Masuk' }}
      </button>
    </form>
  </div>
</template>
