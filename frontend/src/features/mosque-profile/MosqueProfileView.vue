<script setup lang="ts">
/**
 * Profil Masjid form — single-page edit. GET on mount, PATCH on save.
 *
 * The backend auto-creates the row on first GET, so callers always have a
 * stable id. No "create" flow needed.
 */
import { onMounted, reactive, ref } from 'vue';
import { api } from '@/shared/api/client';
import Button from '@/shared/ui/Button.vue';
import FormField from '@/shared/ui/FormField.vue';
import { INPUT_BASE, TEXTAREA_BASE } from '@/shared/ui/input-classes';

interface MosqueProfile {
  id: string;
  tenantId: string;
  officialName: string | null;
  shortName: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  village: string | null;
  postalCode: string | null;
  addressDetail: string | null;
  latitude: string | null;
  longitude: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  youtubeUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  logoUrl: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  history: string | null;
  vision: string | null;
  mission: string | null;
}

const loading = ref(true);
const saving = ref(false);
const error = ref<string | null>(null);
const ok = ref(false);
const form = reactive<Partial<MosqueProfile>>({});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await api.get<{ data: MosqueProfile }>('/api/v1/mosque-profile');
    Object.assign(form, res.data);
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  saving.value = true;
  error.value = null;
  ok.value = false;
  try {
    // Filter out id/tenantId — backend ignores but cleaner this way.
    const { id: _id, tenantId: _tid, ...payload } = form as MosqueProfile;
    void _id;
    void _tid;
    // Replace empty string with null so optional fields stay null.
    const cleaned = Object.fromEntries(
      Object.entries(payload).map(([k, v]) => [k, v === '' ? null : v]),
    );
    await api.patch('/api/v1/mosque-profile', cleaned);
    ok.value = true;
  } catch (err) {
    const e = err as { body?: { error?: string } };
    error.value = e.body?.error ?? (err as Error).message;
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-slate-900">Profil Masjid</h1>
        <p class="text-sm text-slate-500">Identitas masjid yang ditampilkan di portal publik</p>
      </div>
      <Button :loading="saving" :disabled="loading" @click="save">Simpan</Button>
    </header>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>
    <p v-if="ok" class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Tersimpan.</p>

    <div v-if="loading" class="h-64 animate-pulse rounded-xl bg-white border border-slate-200" />

    <form v-else class="grid grid-cols-1 gap-6 md:grid-cols-2" @submit.prevent="save">
      <section class="rounded-xl border border-slate-200 bg-white p-5">
        <h2 class="mb-3 text-sm font-semibold text-slate-900">Identitas</h2>
        <FormField label="Nama resmi">
          <input v-model="form.officialName" :class="INPUT_BASE" placeholder="Masjid …" />
        </FormField>
        <FormField label="Nama singkat">
          <input v-model="form.shortName" :class="INPUT_BASE" />
        </FormField>
        <FormField label="Logo (URL)">
          <input v-model="form.logoUrl" :class="INPUT_BASE" placeholder="https://…" />
        </FormField>
      </section>

      <section class="rounded-xl border border-slate-200 bg-white p-5">
        <h2 class="mb-3 text-sm font-semibold text-slate-900">Alamat</h2>
        <div class="grid grid-cols-2 gap-3">
          <FormField label="Provinsi"><input v-model="form.province" :class="INPUT_BASE" /></FormField>
          <FormField label="Kota / Kabupaten"><input v-model="form.city" :class="INPUT_BASE" /></FormField>
          <FormField label="Kecamatan"><input v-model="form.district" :class="INPUT_BASE" /></FormField>
          <FormField label="Kelurahan / Desa"><input v-model="form.village" :class="INPUT_BASE" /></FormField>
          <FormField label="Kode Pos"><input v-model="form.postalCode" :class="INPUT_BASE" /></FormField>
        </div>
        <FormField label="Detail alamat">
          <textarea v-model="form.addressDetail" :class="TEXTAREA_BASE" rows="2" />
        </FormField>
        <div class="grid grid-cols-2 gap-3">
          <FormField label="Latitude"><input v-model="form.latitude" :class="INPUT_BASE" /></FormField>
          <FormField label="Longitude"><input v-model="form.longitude" :class="INPUT_BASE" /></FormField>
        </div>
      </section>

      <section class="rounded-xl border border-slate-200 bg-white p-5">
        <h2 class="mb-3 text-sm font-semibold text-slate-900">Kontak & Media</h2>
        <FormField label="Telepon"><input v-model="form.phone" :class="INPUT_BASE" /></FormField>
        <FormField label="Email"><input v-model="form.email" :class="INPUT_BASE" /></FormField>
        <FormField label="Website"><input v-model="form.website" :class="INPUT_BASE" /></FormField>
        <FormField label="YouTube"><input v-model="form.youtubeUrl" :class="INPUT_BASE" /></FormField>
        <FormField label="Instagram"><input v-model="form.instagramUrl" :class="INPUT_BASE" /></FormField>
      </section>

      <section class="rounded-xl border border-slate-200 bg-white p-5">
        <h2 class="mb-3 text-sm font-semibold text-slate-900">Rekening Bank</h2>
        <FormField label="Nama bank"><input v-model="form.bankName" :class="INPUT_BASE" /></FormField>
        <FormField label="Atas nama"><input v-model="form.bankAccountName" :class="INPUT_BASE" /></FormField>
        <FormField label="Nomor rekening"><input v-model="form.bankAccountNumber" :class="INPUT_BASE" /></FormField>
      </section>

      <section class="md:col-span-2 rounded-xl border border-slate-200 bg-white p-5">
        <h2 class="mb-3 text-sm font-semibold text-slate-900">Narasi</h2>
        <FormField label="Sejarah">
          <textarea v-model="form.history" :class="TEXTAREA_BASE" rows="3" />
        </FormField>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Visi"><textarea v-model="form.vision" :class="TEXTAREA_BASE" rows="2" /></FormField>
          <FormField label="Misi"><textarea v-model="form.mission" :class="TEXTAREA_BASE" rows="2" /></FormField>
        </div>
      </section>
    </form>
  </div>
</template>
