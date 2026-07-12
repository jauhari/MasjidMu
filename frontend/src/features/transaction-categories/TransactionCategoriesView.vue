<script setup lang="ts">
import { onMounted, reactive, ref, computed, watch } from 'vue';
import { Plus, Pencil, Trash2 } from 'lucide-vue-next';
import { api } from '@/shared/api/client';
import { useDelayedLoading } from '@/shared/composables/useDelayedLoading';
import { useReferenceDataStore } from '@/shared/stores/reference-data';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Button from '@/shared/ui/Button.vue';
import Modal from '@/shared/ui/Modal.vue';
import FormField from '@/shared/ui/FormField.vue';
import ConfirmDialog from '@/shared/ui/ConfirmDialog.vue';
import SortableHeader from '@/shared/ui/SortableHeader.vue';
import AccountSelect from '@/shared/ui/AccountSelect.vue';
import PageHeader from '@/shared/ui/PageHeader.vue';
import AppSelect from '@/shared/ui/AppSelect.vue';
import AppCheckbox from '@/shared/ui/AppCheckbox.vue';
import StatusBadge from '@/shared/ui/StatusBadge.vue';
import { generateCategoryCode } from '@/shared/lib/category-code';

type Direction = 'income' | 'expense';

interface Account {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  accountType: string;
  isActive: boolean;
}

interface Category {
  id: string;
  code: string;
  name: string;
  direction: Direction;
  debitAccountId: string | null;
  creditAccountId: string | null;
  defaultFundId?: string | null;
  isActive: boolean;
}

interface FundLite {
  id: string;
  code: string;
  name: string;
  isRestricted: boolean;
  isActive: boolean;
}

const refData = useReferenceDataStore();
const pageLoading = useDelayedLoading(120);
const items = ref<Category[]>([]);
const accounts = ref<Account[]>([]);
const fundsList = ref<FundLite[]>([]);
const saving = ref(false);
const deleting = ref(false);
const error = ref<string | null>(null);
const modalError = ref<string | null>(null);

const filterDirection = ref<'' | Direction>('');

const filterDirectionOptions = [
  { value: '', label: 'Semua arah' },
  { value: 'income', label: 'Pemasukan' },
  { value: 'expense', label: 'Pengeluaran' },
];

const directionOptions = [
  { value: 'income', label: 'Pemasukan' },
  { value: 'expense', label: 'Pengeluaran' },
];

type SortField = 'code' | 'name' | 'direction' | 'debit' | 'credit' | 'isActive';
const sort = ref<{ field: SortField; dir: 'asc' | 'desc' } | null>({
  field: 'code',
  dir: 'asc',
});
function setSort(field: SortField, dir: 'asc' | 'desc' | null): void {
  sort.value = dir ? { field, dir } : null;
}

const editing = ref<Category | null>(null);
const modalOpen = ref(false);
const confirmOpen = ref(false);
const toDelete = ref<Category | null>(null);

const form = reactive({
  code: '',
  name: '',
  direction: 'income' as Direction,
  debitAccountId: '' as string,
  creditAccountId: '' as string,
  defaultFundId: '' as string,
  isActive: true,
});

const fundOptions = computed(() => [
  { value: '', label: '— Tanpa default dana —' },
  ...fundsList.value.map((f) => ({
    value: f.id,
    label: f.isRestricted ? `${f.name} *` : f.name,
  })),
]);

// Track whether the user has manually edited the code field. Once true, we
// stop overwriting it from name/direction changes.
const codeManuallyEdited = ref(false);

// Auto-fill code from name + direction (only when user hasn't touched code,
// and we're creating a new category — editing a code is disabled anyway).
watch(
  () => [form.name, form.direction] as const,
  ([newName, newDir]) => {
    if (editing.value) return;
    if (codeManuallyEdited.value) return;
    form.code = generateCategoryCode(newName, newDir);
  },
);

function onCodeInput(): void {
  // First time the user types in the code field, treat it as manual override.
  codeManuallyEdited.value = true;
}

const filtered = computed(() => {
  const base = filterDirection.value
    ? items.value.filter((c) => c.direction === filterDirection.value)
    : items.value;
  const s = sort.value;
  if (!s) return base;
  const arr = [...base];
  const mul = s.dir === 'asc' ? 1 : -1;
  arr.sort((a, b) => {
    switch (s.field) {
      case 'code':
        return mul * a.code.localeCompare(b.code, undefined, { numeric: true });
      case 'name':
        return mul * a.name.localeCompare(b.name);
      case 'direction':
        return mul * a.direction.localeCompare(b.direction);
      case 'debit':
        return mul * fmtAccount(a.debitAccountId).localeCompare(fmtAccount(b.debitAccountId));
      case 'credit':
        return mul * fmtAccount(a.creditAccountId).localeCompare(fmtAccount(b.creditAccountId));
      case 'isActive':
        return mul * (Number(b.isActive) - Number(a.isActive));
    }
  });
  return arr;
});

const accountById = computed(() => {
  const m = new Map<string, Account>();
  accounts.value.forEach((a) => m.set(a.id, a));
  return m;
});

function fmtAccount(id: string | null): string {
  if (!id) return '\u2014';
  const a = accountById.value.get(id);
  return a ? `${a.code} — ${a.name}` : id;
}

function fmtFund(id: string | null | undefined): string {
  if (!id) return '\u2014';
  const f = fundsList.value.find((x) => x.id === id);
  return f ? f.name : '\u2014';
}

function resetForm(c?: Category | null): void {
  form.code = c?.code ?? '';
  form.name = c?.name ?? '';
  form.direction = c?.direction ?? 'income';
  form.debitAccountId = c?.debitAccountId ?? '';
  form.creditAccountId = c?.creditAccountId ?? '';
  form.defaultFundId = c?.defaultFundId ?? '';
  form.isActive = c?.isActive ?? true;
  // Reset manual-edit flag so that creating after an edit still auto-fills.
  // For edits we treat the existing code as "user-controlled" (cannot be
  // changed via API anyway).
  codeManuallyEdited.value = !!c;
}

async function load(): Promise<void> {
  if (items.value.length === 0) pageLoading.start();
  error.value = null;
  try {
    const [cRes, accs, fundRows] = await Promise.all([
      api.get<{ data: Category[] }>('/api/v1/transaction-categories'),
      refData.ensureAccounts(),
      refData.ensureFunds(),
    ]);
    items.value = cRes.data;
    accounts.value = accs;
    fundsList.value = fundRows;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    pageLoading.stop();
  }
}

function openCreate(): void {
  editing.value = null;
  resetForm(null);
  modalError.value = null;
  modalOpen.value = true;
}

function openEdit(c: Category): void {
  editing.value = c;
  resetForm(c);
  modalError.value = null;
  modalOpen.value = true;
}

/**
 * Direction-based requirement (mirror dari CHECK constraint di DB):
 *   - Pemasukan : credit_account = WAJIB
 *   - Pengeluaran: debit_account  = WAJIB
 */
function validateForm(): string | null {
  if (!form.code) return 'Kode wajib diisi';
  if (!form.name) return 'Nama wajib diisi';
  if (form.direction === 'income' && !form.creditAccountId) {
    return 'Akun kredit wajib untuk kategori pemasukan';
  }
  if (form.direction === 'expense' && !form.debitAccountId) {
    return 'Akun debit wajib untuk kategori pengeluaran';
  }
  return null;
}

function friendlyBackendError(code: string | undefined, missing?: string[]): string {
  switch (code) {
    case 'credit_required_for_income':
      return 'Akun kredit wajib untuk kategori pemasukan';
    case 'debit_required_for_expense':
      return 'Akun debit wajib untuk kategori pengeluaran';
    case 'invalid_accounts':
      return `Akun tidak valid${missing?.length ? ` (${missing.join(', ')})` : ''}`;
    case 'invalid_fund':
      return 'Dana default tidak valid';
    case 'code_taken':
      return 'Kode kategori sudah dipakai';
    default:
      return code ?? 'Gagal menyimpan kategori';
  }
}

async function save(): Promise<void> {
  const v = validateForm();
  if (v) {
    modalError.value = v;
    return;
  }
  saving.value = true;
  modalError.value = null;
  try {
    const payload = {
      code: form.code,
      name: form.name,
      direction: form.direction,
      debitAccountId: form.debitAccountId || null,
      creditAccountId: form.creditAccountId || null,
      defaultFundId: form.defaultFundId || null,
      isActive: form.isActive,
    };
    if (editing.value) {
      const { code: _omit, ...patch } = payload;
      void _omit;
      await api.patch(`/api/v1/transaction-categories/${editing.value.id}`, patch);
    } else {
      await api.post('/api/v1/transaction-categories', payload);
    }
    modalOpen.value = false;
    refData.invalidate();
    await load();
  } catch (err) {
    const e = err as { body?: { error?: string; missing?: string[] } };
    modalError.value = e.body?.error
      ? friendlyBackendError(e.body.error, e.body.missing)
      : (err as Error).message;
  } finally {
    saving.value = false;
  }
}

function askDelete(c: Category): void {
  toDelete.value = c;
  confirmOpen.value = true;
}

async function doDelete(): Promise<void> {
  if (!toDelete.value) return;
  deleting.value = true;
  try {
    await api.delete(`/api/v1/transaction-categories/${toDelete.value.id}`);
    confirmOpen.value = false;
    toDelete.value = null;
    refData.invalidate();
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    deleting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <PageHeader
      title="Kategori Transaksi"
      description="Template cepat: akun debit/kredit + dana default (untuk program seperti PAP)"
      :crumbs="[{ label: 'Dashboard', to: '/' }, { label: 'Keuangan' }, { label: 'Kategori' }]"
    >
      <template #actions>
        <Button @click="openCreate"><Plus class="h-4 w-4" /> Tambah</Button>
      </template>
    </PageHeader>

    <Card>
      <CardContent class="flex flex-wrap items-center gap-2 px-4 py-3">
        <div class="w-full max-w-[200px]">
          <AppSelect v-model="filterDirection" :options="filterDirectionOptions" />
        </div>
        <span class="ml-auto text-xs text-muted-foreground">{{ filtered.length }} kategori</span>
      </CardContent>
    </Card>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div v-if="pageLoading.visible" class="space-y-2">
      <Skeleton v-for="i in 4" :key="i" class="h-12 w-full" />
    </div>

    <div v-else-if="filtered.length > 0" class="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader class="bg-muted/50">
          <TableRow class="hover:bg-transparent">
            <TableHead class="px-4 text-xs uppercase tracking-wide text-muted-foreground">
              <SortableHeader field="code" :active="sort" @sort="setSort">Kode</SortableHeader>
            </TableHead>
            <TableHead class="px-4 text-xs uppercase tracking-wide text-muted-foreground">
              <SortableHeader field="name" :active="sort" @sort="setSort">Nama</SortableHeader>
            </TableHead>
            <TableHead class="px-4 text-xs uppercase tracking-wide text-muted-foreground">
              <SortableHeader field="direction" :active="sort" @sort="setSort">Arah</SortableHeader>
            </TableHead>
            <TableHead class="px-4 text-xs uppercase tracking-wide text-muted-foreground">
              <SortableHeader field="debit" :active="sort" @sort="setSort">Debit</SortableHeader>
            </TableHead>
            <TableHead class="px-4 text-xs uppercase tracking-wide text-muted-foreground">
              <SortableHeader field="credit" :active="sort" @sort="setSort">Kredit</SortableHeader>
            </TableHead>
            <TableHead class="px-4 text-xs uppercase tracking-wide text-muted-foreground">Dana default</TableHead>
            <TableHead class="px-4 text-xs uppercase tracking-wide text-muted-foreground">
              <SortableHeader field="isActive" :active="sort" @sort="setSort">Status</SortableHeader>
            </TableHead>
            <TableHead class="px-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="c in filtered" :key="c.id">
            <TableCell class="px-4 py-2 font-mono text-xs">{{ c.code }}</TableCell>
            <TableCell class="px-4 py-2">{{ c.name }}</TableCell>
            <TableCell class="px-4 py-2">
              <Badge
                variant="outline"
                class="text-[11px] font-medium"
                :class="c.direction === 'income' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'"
              >
                {{ c.direction === 'income' ? 'Pemasukan' : 'Pengeluaran' }}
              </Badge>
            </TableCell>
            <TableCell class="px-4 py-2 text-xs text-muted-foreground">{{ fmtAccount(c.debitAccountId) }}</TableCell>
            <TableCell class="px-4 py-2 text-xs text-muted-foreground">{{ fmtAccount(c.creditAccountId) }}</TableCell>
            <TableCell class="px-4 py-2 text-xs text-muted-foreground">{{ fmtFund(c.defaultFundId) }}</TableCell>
            <TableCell class="px-4 py-2">
              <StatusBadge :status="c.isActive ? 'active' : 'inactive'" />
            </TableCell>
            <TableCell class="px-4 py-2 text-right">
              <Button variant="ghost" size="sm" @click="openEdit(c)"><Pencil class="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="sm" @click="askDelete(c)">
                <Trash2 class="h-3.5 w-3.5 text-red-600" />
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <p v-else class="rounded-xl border border-dashed bg-card px-5 py-10 text-center text-sm text-muted-foreground">
      Belum ada kategori.
    </p>

    <Modal v-model:open="modalOpen" :title="editing ? 'Edit Kategori' : 'Kategori Baru'" size="lg">
      <Alert v-if="modalError" variant="destructive" class="mb-3">
        <AlertDescription>{{ modalError }}</AlertDescription>
      </Alert>
      <form class="space-y-3" @submit.prevent="save">
        <FormField label="Nama" required>
          <Input
            v-model="form.name"
            required
            minlength="2"
            placeholder="Mis. ATK, Infaq Jumat, Listrik"
          />
        </FormField>
        <FormField label="Arah" required>
          <AppSelect v-model="form.direction" :options="directionOptions" />
        </FormField>
        <FormField
          label="Kode"
          required
          :hint="!editing && !codeManuallyEdited ? 'Otomatis dari nama + arah \u2014 ubah manual jika perlu' : null"
        >
          <Input
            v-model="form.code"
            :disabled="!!editing"
            required
            maxlength="50"
            placeholder="EXP_ATK"
            @input="onCodeInput"
          />
        </FormField>
        <FormField
          label="Akun debit"
          :required="form.direction === 'expense'"
          :hint="form.direction === 'income' ? 'Opsional \u2014 biasanya kas/bank, bisa dipilih saat input transaksi' : null"
        >
          <AccountSelect
            v-model="form.debitAccountId"
            :accounts="accounts"
            :required="form.direction === 'expense'"
          />
        </FormField>
        <FormField
          label="Akun kredit"
          :required="form.direction === 'income'"
          :hint="form.direction === 'expense' ? 'Opsional \u2014 biasanya kas/bank, bisa dipilih saat input transaksi' : null"
        >
          <AccountSelect
            v-model="form.creditAccountId"
            :accounts="accounts"
            :required="form.direction === 'income'"
          />
        </FormField>
        <FormField
          v-if="fundsList.length > 0"
          label="Dana default"
          hint="Untuk program (PAP, ambulans, dll.) — otomatis terisi saat kategori dipilih di form transaksi"
        >
          <AppSelect v-model="form.defaultFundId" :options="fundOptions" />
        </FormField>
        <FormField label="Status">
          <AppCheckbox v-model="form.isActive" label="Aktif" />
        </FormField>
        <p class="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <strong>Template cepat</strong>: pilih kategori di form transaksi → akun (+ dana default) terisi.<br />
          Contoh <strong>Infaq PAP</strong>: debit Kas PAP, kredit Infaq &amp; Sedekah, dana PAP 2026.
        </p>
      </form>
      <template #footer>
        <Button variant="secondary" @click="modalOpen = false">Batal</Button>
        <Button :loading="saving" @click="save">{{ editing ? 'Simpan' : 'Buat' }}</Button>
      </template>
    </Modal>

    <ConfirmDialog
      v-model:open="confirmOpen"
      title="Hapus kategori"
      :message="`Kategori “${toDelete?.code} — ${toDelete?.name}” akan dihapus.`"
      :loading="deleting"
      @confirm="doDelete"
    />
  </div>
</template>
