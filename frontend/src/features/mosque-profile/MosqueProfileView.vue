<script setup lang="ts">
/**
 * Profil Masjid — baca (GET) & ubah (PATCH). Baris dibuat otomatis saat pertama kali dibuka.
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api, formatApiError } from '@/shared/api/client';
import { useAuthStore } from '@/features/auth/store';
import Button from '@/shared/ui/Button.vue';
import FormField from '@/shared/ui/FormField.vue';
import PageHeader from '@/shared/ui/PageHeader.vue';

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
  bannerUrl: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  history: string | null;
  vision: string | null;
  mission: string | null;
}

type MosqueProfileForm = {
  [K in keyof Omit<MosqueProfile, 'id' | 'tenantId'>]: string;
};

const auth = useAuthStore();
const canEdit = computed(() => auth.hasPermission('profile.update'));

const loading = ref(true);
const saving = ref(false);
const error = ref<string | null>(null);
const ok = ref(false);
const form = reactive<MosqueProfileForm>({
  officialName: '',
  shortName: '',
  province: '',
  city: '',
  district: '',
  village: '',
  postalCode: '',
  addressDetail: '',
  latitude: '',
  longitude: '',
  phone: '',
  email: '',
  website: '',
  youtubeUrl: '',
  facebookUrl: '',
  instagramUrl: '',
  tiktokUrl: '',
  logoUrl: '',
  bannerUrl: '',
  bankName: '',
  bankAccountName: '',
  bankAccountNumber: '',
  history: '',
  vision: '',
  mission: '',
});

function applyProfile(data: MosqueProfile): void {
  const { id: _id, tenantId: _tid, ...rest } = data;
  void _id;
  void _tid;
  for (const key of Object.keys(form) as (keyof MosqueProfileForm)[]) {
    form[key] = rest[key] ?? '';
  }
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await api.get<{ data: MosqueProfile }>('/api/v1/mosque-profile');
    applyProfile(res.data);
  } catch (err) {
    error.value = formatApiError(err, 'Gagal memuat profil masjid');
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  if (!canEdit.value) return;
  saving.value = true;
  error.value = null;
  ok.value = false;
  try {
    const cleaned = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]),
    );
    const res = await api.patch<{ data: MosqueProfile }>('/api/v1/mosque-profile', cleaned);
    applyProfile(res.data);
    ok.value = true;
  } catch (err) {
    error.value = formatApiError(err, 'Gagal menyimpan profil');
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader
      title="Profil Masjid"
      :crumbs="[{ label: 'Dashboard', to: '/' }, { label: 'Konten' }, { label: 'Profil Masjid' }]"
      :description="
        auth.tenantSlug
          ? `Data masjid untuk ${auth.tenantSlug}.hisabmu.id — tampil di portal publik.`
          : 'Identitas masjid yang ditampilkan di portal publik'
      "
    >
      <template #actions>
        <Button v-if="canEdit" :loading="saving" :disabled="loading" @click="save">Simpan</Button>
      </template>
    </PageHeader>

    <Alert v-if="!canEdit && !loading">
      <AlertDescription>Anda hanya bisa melihat profil. Hubungi admin untuk mengubah data.</AlertDescription>
    </Alert>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>
    <Alert v-if="ok">
      <AlertDescription>Profil masjid tersimpan.</AlertDescription>
    </Alert>

    <Card v-if="loading">
      <CardContent class="pt-6">
        <Skeleton class="h-64 w-full" />
      </CardContent>
    </Card>

    <fieldset v-else :disabled="!canEdit" class="grid grid-cols-1 gap-6 border-0 p-0 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle class="text-sm">Identitas</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-3">
          <FormField label="Nama resmi" required>
            <Input v-model="form.officialName" placeholder="Masjid Al-Uula" />
          </FormField>
          <FormField label="Nama singkat">
            <Input v-model="form.shortName" placeholder="Al-Uula" />
          </FormField>
          <FormField label="Logo (URL)">
            <Input v-model="form.logoUrl" placeholder="https://…" type="url" />
          </FormField>
          <FormField label="Banner (URL)">
            <Input v-model="form.bannerUrl" placeholder="https://…" type="url" />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-sm">Alamat</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-3">
          <div class="grid grid-cols-2 gap-3">
            <FormField label="Provinsi"><Input v-model="form.province" /></FormField>
            <FormField label="Kota / Kabupaten"><Input v-model="form.city" /></FormField>
            <FormField label="Kecamatan"><Input v-model="form.district" /></FormField>
            <FormField label="Kelurahan / Desa"><Input v-model="form.village" /></FormField>
            <FormField label="Kode Pos"><Input v-model="form.postalCode" /></FormField>
          </div>
          <FormField label="Detail alamat">
            <Textarea v-model="form.addressDetail" rows="2" />
          </FormField>
          <div class="grid grid-cols-2 gap-3">
            <FormField label="Latitude"><Input v-model="form.latitude" /></FormField>
            <FormField label="Longitude"><Input v-model="form.longitude" /></FormField>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-sm">Kontak & Media Sosial</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-3">
          <FormField label="Telepon"><Input v-model="form.phone" /></FormField>
          <FormField label="Email"><Input v-model="form.email" type="email" /></FormField>
          <FormField label="Website"><Input v-model="form.website" type="url" placeholder="https://…" /></FormField>
          <FormField label="YouTube"><Input v-model="form.youtubeUrl" type="url" placeholder="https://…" /></FormField>
          <FormField label="Facebook"><Input v-model="form.facebookUrl" type="url" placeholder="https://…" /></FormField>
          <FormField label="Instagram"><Input v-model="form.instagramUrl" type="url" placeholder="https://…" /></FormField>
          <FormField label="TikTok"><Input v-model="form.tiktokUrl" type="url" placeholder="https://…" /></FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-sm">Rekening Bank</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-3">
          <FormField label="Nama bank"><Input v-model="form.bankName" /></FormField>
          <FormField label="Atas nama"><Input v-model="form.bankAccountName" /></FormField>
          <FormField label="Nomor rekening"><Input v-model="form.bankAccountNumber" /></FormField>
        </CardContent>
      </Card>

      <Card class="md:col-span-2">
        <CardHeader>
          <CardTitle class="text-sm">Narasi</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-3">
          <FormField label="Sejarah">
            <Textarea v-model="form.history" rows="3" />
          </FormField>
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label="Visi"><Textarea v-model="form.vision" rows="2" /></FormField>
            <FormField label="Misi"><Textarea v-model="form.mission" rows="2" /></FormField>
          </div>
        </CardContent>
      </Card>
    </fieldset>
  </div>
</template>