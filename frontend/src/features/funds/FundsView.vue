<script setup lang="ts">
/**
 * Dana (Fund) — CRUD dana PSAK 109/112 + dana program/kampanye kustom.
 *
 * Dana sistem (isSystem=true, dari seed) tidak bisa dihapus — hanya bisa
 * diarsipkan lewat nonaktifkan. Dana kustom (mis. "Program Ambulans") bebas
 * dibuat kapan saja; jenis dana (fundType) dipilih dari PSAK 109 yang sudah
 * ada — dana kustom biasanya "Infak/Sedekah" + terikat.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { Plus, Pencil, Archive } from 'lucide-vue-next';
import { api, formatApiError } from '@/shared/api/client';
import { ensureUniqueFundCode, generateFundCode } from '@/shared/lib/fund-code';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import Button from '@/shared/ui/Button.vue';
import Modal from '@/shared/ui/Modal.vue';
import FormField from '@/shared/ui/FormField.vue';
import AppSelect from '@/shared/ui/AppSelect.vue';
import AppCheckbox from '@/shared/ui/AppCheckbox.vue';
import ConfirmDialog from '@/shared/ui/ConfirmDialog.vue';
import StatusBadge from '@/shared/ui/StatusBadge.vue';
import PageHeader from '@/shared/ui/PageHeader.vue';

type FundType = 'zakat' | 'infaq_sedekah' | 'amil' | 'nonhalal' | 'wakaf' | 'umum';

interface Fund {
  id: string;
  code: string;
  name: string;
  fundType: FundType;
  isRestricted: boolean;
  description: string | null;
  isActive: boolean;
  isSystem: boolean;
  sortOrder: number;
}

const FUND_TYPE_LABEL: Record<FundType, string> = {
  zakat: 'Zakat',
  infaq_sedekah: 'Infak / Sedekah',
  amil: 'Amil',
  nonhalal: 'Non-halal',
  wakaf: 'Wakaf',
  umum: 'Umum',
};

const fundTypeOptions = (Object.keys(FUND_TYPE_LABEL) as FundType[]).map((v) => ({
  value: v,
  label: FUND_TYPE_LABEL[v],
}));

const items = ref<Fund[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const saving = ref(false);
const modalError = ref<string | null>(null);

const modalOpen = ref(false);
const editing = ref<Fund | null>(null);
const confirmOpen = ref(false);
const toArchive = ref<Fund | null>(null);
const archiving = ref(false);

const form = reactive({
  code: '',
  name: '',
  fundType: 'infaq_sedekah' as FundType,
  isRestricted: true,
  description: '',
  isActive: true,
});

const sortedItems = computed(() => [...items.value].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)));

/** Preview kode otomatis (create only) — prefix PSAK + slug nama. */
const autoCode = computed(() => {
  if (editing.value) return form.code;
  const base = generateFundCode(form.name, form.fundType);
  if (!base) return '—';
  return ensureUniqueFundCode(
    base,
    items.value.map((f) => f.code),
  );
});

// Sync form.code from auto generator while creating.
watch(
  () => [form.name, form.fundType, modalOpen.value, editing.value] as const,
  () => {
    if (!modalOpen.value || editing.value) return;
    form.code = autoCode.value === '—' ? '' : autoCode.value;
  },
);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await api.get<{ data: Fund[] }>('/api/v1/funds');
    items.value = res.data;
  } catch (err) {
    error.value = formatApiError(err);
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  editing.value = null;
  form.code = '';
  form.name = '';
  form.fundType = 'infaq_sedekah';
  form.isRestricted = true;
  form.description = '';
  form.isActive = true;
  modalError.value = null;
  modalOpen.value = true;
}

function openEdit(f: Fund): void {
  editing.value = f;
  form.code = f.code;
  form.name = f.name;
  form.fundType = f.fundType;
  form.isRestricted = f.isRestricted;
  form.description = f.description ?? '';
  form.isActive = f.isActive;
  modalError.value = null;
  modalOpen.value = true;
}

function validate(): string | null {
  if (form.name.trim().length < 2) return 'Nama dana minimal 2 karakter';
  if (!editing.value) {
    const code = autoCode.value;
    if (!code || code === '—' || !/^[A-Za-z0-9._-]+$/.test(code)) {
      return 'Kode otomatis belum valid — lengkapi nama dana';
    }
  }
  return null;
}

async function save(): Promise<void> {
  const v = validate();
  if (v) {
    modalError.value = v;
    return;
  }
  saving.value = true;
  modalError.value = null;
  try {
    if (editing.value) {
      await api.patch(`/api/v1/funds/${editing.value.id}`, {
        name: form.name.trim(),
        fundType: form.fundType,
        isRestricted: form.isRestricted,
        description: form.description.trim() || null,
        isActive: form.isActive,
      });
    } else {
      // Recompute at submit so uniqueness is fresh against current list.
      const code = ensureUniqueFundCode(
        generateFundCode(form.name, form.fundType),
        items.value.map((f) => f.code),
      );
      await api.post('/api/v1/funds', {
        code,
        name: form.name.trim(),
        fundType: form.fundType,
        isRestricted: form.isRestricted,
        description: form.description.trim() || null,
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

function askArchive(f: Fund): void {
  toArchive.value = f;
  confirmOpen.value = true;
}

async function doArchive(): Promise<void> {
  if (!toArchive.value) return;
  archiving.value = true;
  try {
    await api.delete(`/api/v1/funds/${toArchive.value.id}`);
    confirmOpen.value = false;
    await load();
  } catch (err) {
    error.value = formatApiError(err);
  } finally {
    archiving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <PageHeader
      title="Dana"
      description="Kantong uang terpisah (PSAK 109/112 + program kustom). Bukan tempat catat transaksi."
      :crumbs="[{ label: 'Dashboard', to: '/' }, { label: 'Keuangan' }, { label: 'Dana' }]"
    >
      <template #actions>
        <Button size="sm" @click="openCreate">
          <Plus class="h-4 w-4" /> Dana Baru
        </Button>
      </template>
    </PageHeader>

    <Card class="border-emerald-200/80 bg-emerald-50/40">
      <CardContent class="space-y-2 p-4 text-sm text-emerald-950/90">
        <p class="font-semibold text-emerald-950">Cara pakai Dana (contoh: Infaq Rutin PAP)</p>
        <ol class="list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-emerald-950/80">
          <li>
            <strong>Buat dana</strong> di sini — isi nama (mis. <em>Infaq Rutin PAP</em>);
            kode dibuat otomatis (mis. <code class="rounded bg-white/80 px-1">INF-PAP</code>),
            pilih jenis <em>Infak / Sedekah</em>, centang terikat jika perlu.
          </li>
          <li>
            <strong>Catat transaksi</strong> di menu Transaksi → pilih kategori + nominal → di form jurnal
            pilih <strong>Dana = Infaq Rutin PAP</strong> (header hijau). Tanpa pilih dana, uang
            <em>tidak</em> masuk laporan per dana.
          </li>
          <li>
            <strong>Laporan khusus</strong> → Laporan → <em>Buku Dana</em> → pilih dana PAP + periode.
            Lihat daftar masuk, keluar, dan saldo. Ringkasan semua dana: <em>Sumber &amp; Penggunaan Dana</em>.
          </li>
        </ol>
      </CardContent>
    </Card>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <Skeleton v-if="loading" class="h-64 w-full" />

    <Card v-else>
      <CardContent class="p-4">
        <Table>
          <TableHeader class="bg-muted/50">
            <TableRow class="hover:bg-transparent">
              <TableHead class="px-3 text-xs uppercase tracking-wide text-muted-foreground">Kode</TableHead>
              <TableHead class="px-3 text-xs uppercase tracking-wide text-muted-foreground">Nama</TableHead>
              <TableHead class="px-3 text-xs uppercase tracking-wide text-muted-foreground">Jenis</TableHead>
              <TableHead class="px-3 text-center text-xs uppercase tracking-wide text-muted-foreground">Terikat</TableHead>
              <TableHead class="px-3 text-xs uppercase tracking-wide text-muted-foreground">Status</TableHead>
              <TableHead class="px-3 text-right text-xs uppercase tracking-wide text-muted-foreground">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-if="!sortedItems.length">
              <TableCell colspan="6" class="py-8 text-center text-sm text-muted-foreground">
                Belum ada dana. Klik "Dana Baru" atau seed dana default PSAK 109 dulu.
              </TableCell>
            </TableRow>
            <TableRow v-for="f in sortedItems" :key="f.id">
              <TableCell class="px-3 py-2 font-mono text-xs text-foreground/80">{{ f.code }}</TableCell>
              <TableCell class="px-3 py-2">
                <p class="text-sm font-medium text-foreground">{{ f.name }}</p>
                <p v-if="f.description" class="line-clamp-1 text-xs text-muted-foreground">{{ f.description }}</p>
              </TableCell>
              <TableCell class="px-3 py-2 text-sm text-muted-foreground">{{ FUND_TYPE_LABEL[f.fundType] }}</TableCell>
              <TableCell class="px-3 py-2 text-center">
                <span v-if="f.isRestricted" class="text-amber-600" title="Dana terikat syariah">●</span>
                <span v-else class="text-muted-foreground/40">—</span>
              </TableCell>
              <TableCell class="px-3 py-2"><StatusBadge :status="f.isActive ? 'active' : 'inactive'" /></TableCell>
              <TableCell class="px-3 py-2 text-right">
                <div class="flex items-center justify-end gap-1">
                  <Button variant="ghost" size="sm" title="Edit" @click="openEdit(f)">
                    <Pencil class="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    v-if="!f.isSystem"
                    variant="ghost"
                    size="sm"
                    title="Arsipkan"
                    @click="askArchive(f)"
                  >
                    <Archive class="h-3.5 w-3.5 text-rose-600" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <Modal v-model:open="modalOpen" :title="editing ? 'Edit Dana' : 'Dana Baru'" size="lg">
      <Alert v-if="modalError" variant="destructive" class="mb-3">
        <AlertDescription>{{ modalError }}</AlertDescription>
      </Alert>
      <form class="space-y-3" @submit.prevent="save">
        <FormField label="Nama dana" required hint="Mis. 'Program Ambulans', 'Infaq Rutin PAP'">
          <Input v-model="form.name" required minlength="2" placeholder="Program Ambulans" />
        </FormField>
        <FormField label="Jenis dana (PSAK 109)" required hint="Program/kampanye biasanya masuk Infak/Sedekah">
          <AppSelect v-model="form.fundType" :options="fundTypeOptions" />
        </FormField>
        <FormField
          label="Kode"
          :hint="editing ? 'Kode sistem, tidak bisa diubah' : 'Otomatis dari jenis PSAK + nama (standar HisabMu)'"
        >
          <div
            class="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 font-mono text-sm tracking-wide text-foreground"
            aria-live="polite"
          >
            <span :class="autoCode === '—' ? 'text-muted-foreground' : 'font-semibold'">
              {{ autoCode }}
            </span>
          </div>
        </FormField>
        <FormField label="Sifat">
          <AppCheckbox v-model="form.isRestricted" label="Dana terikat (penggunaan dibatasi sesuai tujuan donasi)" />
        </FormField>
        <FormField label="Deskripsi" hint="Opsional">
          <Textarea v-model="form.description" rows="2" placeholder="Konteks singkat dana ini" />
        </FormField>
        <FormField v-if="editing" label="Status">
          <AppCheckbox v-model="form.isActive" label="Aktif (tampil di pilihan dana saat input transaksi)" />
        </FormField>
      </form>
      <template #footer>
        <Button variant="secondary" @click="modalOpen = false">Batal</Button>
        <Button :loading="saving" @click="save">{{ editing ? 'Simpan' : 'Buat' }}</Button>
      </template>
    </Modal>

    <ConfirmDialog
      v-model:open="confirmOpen"
      title="Arsipkan dana"
      :message="`Dana '${toArchive?.name}' akan diarsipkan dan tidak tampil lagi di pilihan dana untuk transaksi baru. Riwayat transaksi & laporan tetap tersimpan.`"
      :loading="archiving"
      @confirm="doArchive"
    />
  </div>
</template>
