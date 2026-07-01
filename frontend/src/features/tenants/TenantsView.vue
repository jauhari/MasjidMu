<script setup lang="ts">
/**
 * Manajemen Lembaga (tenant) — super_admin only.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  Building2,
  Globe,
  GitBranch,
  Landmark,
  Layers,
  Pencil,
  Plus,
  School,
  Sparkles,
} from 'lucide-vue-next';
import { api, formatApiError } from '@/shared/api/client';
import { useAuthStore } from '@/features/auth/store';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import Button from '@/shared/ui/Button.vue';
import Modal from '@/shared/ui/Modal.vue';
import FormField from '@/shared/ui/FormField.vue';
import AppSelect from '@/shared/ui/AppSelect.vue';
import PageHeader from '@/shared/ui/PageHeader.vue';
import { cn } from '@/lib/utils';

type Edition = 'masjid' | 'laz' | 'pesantren' | 'yayasan';

interface Tenant {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  edition: Edition;
  parentTenantId: string | null;
  isActive: boolean;
}

interface FieldErrors {
  name?: string;
  slug?: string;
}

const auth = useAuthStore();
const tenants = ref<Tenant[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const modalOpen = ref(false);
const editing = ref<Tenant | null>(null);
const saving = ref(false);
const modalError = ref<string | null>(null);
const fieldErrors = ref<FieldErrors>({});
const slugTouched = ref(false);
const originalSlug = ref('');

const form = reactive<{
  name: string;
  slug: string;
  edition: Edition;
  parentTenantId: string;
  isActive: boolean;
}>({ name: '', slug: '', edition: 'masjid', parentTenantId: '', isActive: true });

const EDITION_META: Record<
  Edition,
  { label: string; short: string; hint: string; icon: typeof Building2 }
> = {
  masjid: {
    label: 'Masjid / Mushola',
    short: 'ISAK 35',
    hint: 'COA & dana umum untuk masjid',
    icon: Building2,
  },
  laz: {
    label: 'LAZ / BAZNAS',
    short: 'PSAK 109',
    hint: 'Dana zakat, infak, sedekah terpisah',
    icon: Landmark,
  },
  pesantren: {
    label: 'Pesantren',
    short: 'ISAK 35',
    hint: 'Akuntansi pondok & unit usaha',
    icon: School,
  },
  yayasan: {
    label: 'Yayasan / NGO',
    short: 'ISAK 35',
    hint: 'Lembaga nirlaba multi-program',
    icon: Sparkles,
  },
};

const subdomainPreview = computed(() =>
  form.slug.trim() ? `${form.slug.trim()}.hisabmu.id` : 'slug.hisabmu.id',
);

const slugChanged = computed(
  () => !!editing.value && form.slug.trim() !== originalSlug.value,
);

const nameById = computed(() => new Map(tenants.value.map((t) => [t.id, t.name])));

const parentOptions = computed(() => [
  { value: '', label: 'Mandiri — tidak punya induk' },
  ...tenants.value
    .filter((t) => t.id !== editing.value?.id)
    .map((t) => ({ value: t.id, label: t.name })),
]);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

watch(
  () => form.name,
  (name) => {
    if (editing.value || slugTouched.value) return;
    form.slug = slugify(name);
  },
);

function clearFieldErrors(): void {
  fieldErrors.value = {};
  modalError.value = null;
}

async function load(): Promise<void> {
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

function openCreate(): void {
  editing.value = null;
  originalSlug.value = '';
  slugTouched.value = false;
  form.name = '';
  form.slug = '';
  form.edition = 'masjid';
  form.parentTenantId = '';
  form.isActive = true;
  clearFieldErrors();
  modalOpen.value = true;
}

function openEdit(t: Tenant): void {
  editing.value = t;
  originalSlug.value = t.slug;
  slugTouched.value = true;
  form.name = t.name;
  form.slug = t.slug;
  form.edition = t.edition;
  form.parentTenantId = t.parentTenantId ?? '';
  form.isActive = t.isActive;
  clearFieldErrors();
  modalOpen.value = true;
}

function onSlugInput(): void {
  slugTouched.value = true;
  fieldErrors.value.slug = undefined;
}

function validate(): boolean {
  const errs: FieldErrors = {};
  const name = form.name.trim();
  const slug = form.slug.trim();

  if (name.length < 2) errs.name = 'Minimal 2 karakter';
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    errs.slug = 'Huruf kecil, angka, hubung; tidak boleh diawali hubung';
  } else if (['api', 'admin', 'www'].includes(slug)) {
    errs.slug = 'Slug reserved — pilih nama lain';
  }

  fieldErrors.value = errs;
  return Object.keys(errs).length === 0;
}

async function save(): Promise<void> {
  if (!validate()) return;
  saving.value = true;
  modalError.value = null;
  try {
    if (editing.value) {
      await api.patch(`/api/v1/tenants/${editing.value.id}`, {
        slug: form.slug.trim(),
        name: form.name.trim(),
        edition: form.edition,
        parentTenantId: form.parentTenantId || null,
        isActive: form.isActive,
      });
    } else {
      await api.post('/api/v1/tenants', {
        slug: form.slug.trim(),
        name: form.name.trim(),
        edition: form.edition,
        parentTenantId: form.parentTenantId || null,
      });
    }
    modalOpen.value = false;
    await load();
  } catch (err) {
    modalError.value = formatApiError(err);
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  if (auth.isSuperAdmin) void load();
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Manajemen Lembaga"
      description="Kelola institusi, subdomain, dan edisi akuntansi. Lembaga baru otomatis mendapat bagan akun & dana."
      :crumbs="[{ label: 'Dashboard', to: '/' }, { label: 'Admin' }, { label: 'Lembaga' }]"
    >
      <template #actions>
        <Button v-if="auth.isSuperAdmin" size="sm" @click="openCreate">
          <Plus class="h-4 w-4" />
          Tambah Lembaga
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="!auth.isSuperAdmin" variant="destructive">
      <AlertDescription>Halaman ini khusus super admin platform.</AlertDescription>
    </Alert>

    <template v-else>
      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div v-if="loading" class="grid gap-4 sm:grid-cols-2">
        <Skeleton v-for="i in 2" :key="i" class="h-36 w-full rounded-xl" />
      </div>

      <Card
        v-else-if="!tenants.length"
        class="border-dashed"
      >
        <CardContent class="flex flex-col items-center gap-3 py-14 text-center">
          <div class="grid size-12 place-items-center rounded-xl bg-muted">
            <Building2 class="size-6 text-muted-foreground" />
          </div>
          <div>
            <p class="font-medium text-foreground">Belum ada lembaga</p>
            <p class="mt-1 max-w-sm text-sm text-muted-foreground">
              Tambahkan masjid, LAZ, atau yayasan pertama untuk mulai mengelola data keuangan.
            </p>
          </div>
          <Button size="sm" @click="openCreate">
            <Plus class="h-4 w-4" />
            Tambah Lembaga
          </Button>
        </CardContent>
      </Card>

      <div v-else class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card
          v-for="t in tenants"
          :key="t.id"
          class="group overflow-hidden transition-shadow duration-200 hover:shadow-md"
        >
          <CardContent class="flex flex-col gap-4 p-5">
            <div class="flex items-start justify-between gap-3">
              <div class="flex min-w-0 items-start gap-3">
                <div
                  class="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
                >
                  <component :is="EDITION_META[t.edition].icon" class="size-5" />
                </div>
                <div class="min-w-0">
                  <p class="truncate font-semibold text-foreground">{{ t.name }}</p>
                  <p class="mt-0.5 font-mono text-xs text-muted-foreground">
                    {{ t.slug }}.hisabmu.id
                  </p>
                </div>
              </div>
              <Badge
                :variant="t.isActive ? 'default' : 'secondary'"
                class="shrink-0"
              >
                {{ t.isActive ? 'Aktif' : 'Nonaktif' }}
              </Badge>
            </div>

            <div class="flex flex-wrap gap-2">
              <Badge variant="outline">{{ EDITION_META[t.edition].label }}</Badge>
              <Badge v-if="t.parentTenantId" variant="outline" class="gap-1">
                <GitBranch class="size-3" />
                {{ nameById.get(t.parentTenantId) ?? 'Cabang' }}
              </Badge>
            </div>

            <div class="flex justify-end border-t border-border/60 pt-3">
              <Button variant="ghost" size="sm" @click="openEdit(t)">
                <Pencil class="h-4 w-4" />
                Kelola
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </template>

    <Modal
      v-model:open="modalOpen"
      :title="editing ? 'Edit Lembaga' : 'Lembaga Baru'"
      :description="
        editing
          ? 'Perbarui identitas dan konfigurasi lembaga. Perubahan slug memengaruhi login pengguna.'
          : 'Buat institusi baru. Sistem akan menyiapkan bagan akun dan dana sesuai edisi.'
      "
      size="lg"
    >
      <Alert v-if="modalError" variant="destructive" class="mb-4">
        <AlertDescription>{{ modalError }}</AlertDescription>
      </Alert>

      <Alert
        v-if="slugChanged"
        class="mb-4 border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
      >
        <AlertDescription>
          Slug berubah dari <strong>{{ originalSlug }}</strong> → <strong>{{ form.slug }}</strong>.
          Pengguna harus login dengan slug baru.
        </AlertDescription>
      </Alert>

      <form class="space-y-6" @submit.prevent="save">
        <section class="space-y-4">
          <div class="flex items-center gap-2 text-sm font-medium text-foreground">
            <Building2 class="size-4 text-primary" />
            Identitas
          </div>

          <FormField
            label="Nama lembaga"
            html-for="tenant-name"
            required
            :error="fieldErrors.name"
          >
            <Input
              id="tenant-name"
              v-model="form.name"
              required
              minlength="2"
              placeholder="Masjid Al-Uula"
              autocomplete="organization"
              @input="fieldErrors.name = undefined"
            />
          </FormField>

          <FormField
            label="Slug subdomain"
            html-for="tenant-slug"
            required
            :error="fieldErrors.slug"
            hint="Dipakai saat login dan alamat subdomain publik"
          >
            <div class="space-y-2">
              <div class="relative">
                <Globe
                  class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="tenant-slug"
                  v-model="form.slug"
                  required
                  class="pl-9 font-mono text-sm"
                  placeholder="al-uula"
                  spellcheck="false"
                  @input="onSlugInput"
                />
              </div>
              <div
                class="flex items-center gap-2 rounded-lg border border-border/80 bg-muted/40 px-3 py-2"
              >
                <span class="text-xs text-muted-foreground">Akses:</span>
                <code class="text-xs font-medium text-foreground">{{ subdomainPreview }}</code>
              </div>
            </div>
          </FormField>
        </section>

        <Separator />

        <section class="space-y-3">
          <div class="flex items-center gap-2 text-sm font-medium text-foreground">
            <Layers class="size-4 text-primary" />
            Edisi akuntansi
          </div>
          <p class="text-xs text-muted-foreground">
            Menentukan struktur dana & laporan yang di-seed otomatis.
          </p>

          <div class="grid gap-2 sm:grid-cols-2">
            <button
              v-for="(meta, key) in EDITION_META"
              :key="key"
              type="button"
              class="flex items-start gap-3 rounded-xl border p-3 text-left transition-all duration-200 hover:border-primary/40 hover:bg-muted/30"
              :class="
                cn(
                  form.edition === key
                    ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                    : 'border-border',
                )
              "
              @click="form.edition = key"
            >
              <div
                class="grid size-9 shrink-0 place-items-center rounded-lg"
                :class="form.edition === key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'"
              >
                <component :is="meta.icon" class="size-4" />
              </div>
              <div class="min-w-0">
                <p class="text-sm font-medium text-foreground">{{ meta.label }}</p>
                <p class="text-xs text-muted-foreground">{{ meta.short }} · {{ meta.hint }}</p>
              </div>
            </button>
          </div>
        </section>

        <Separator />

        <section class="space-y-4">
          <div class="flex items-center gap-2 text-sm font-medium text-foreground">
            <GitBranch class="size-4 text-primary" />
            Struktur organisasi
          </div>

          <FormField
            label="Lembaga induk"
            hint="Kosongkan jika lembaga ini mandiri atau merupakan pusat"
          >
            <AppSelect v-model="form.parentTenantId" :options="parentOptions" />
          </FormField>

          <div
            v-if="editing"
            class="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-4 py-3"
          >
            <div>
              <Label class="text-sm font-medium">Status lembaga</Label>
              <p class="text-xs text-muted-foreground">
                Nonaktif = pengguna tidak bisa mengakses tenant ini
              </p>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-medium" :class="form.isActive ? 'text-emerald-600' : 'text-muted-foreground'">
                {{ form.isActive ? 'Aktif' : 'Nonaktif' }}
              </span>
              <Switch v-model:checked="form.isActive" aria-label="Status lembaga aktif" />
            </div>
          </div>
        </section>
      </form>

      <template #footer>
        <Button variant="secondary" :disabled="saving" @click="modalOpen = false">
          Batal
        </Button>
        <Button :loading="saving" @click="save">
          {{ editing ? 'Simpan Perubahan' : 'Buat Lembaga' }}
        </Button>
      </template>
    </Modal>
  </div>
</template>