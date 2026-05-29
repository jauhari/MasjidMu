<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue';
import { Plus, Pencil, Trash2, Sprout } from 'lucide-vue-next';
import { api } from '@/shared/api/client';
import Button from '@/shared/ui/Button.vue';
import Modal from '@/shared/ui/Modal.vue';
import FormField from '@/shared/ui/FormField.vue';
import ConfirmDialog from '@/shared/ui/ConfirmDialog.vue';
import { INPUT_BASE, TEXTAREA_BASE } from '@/shared/ui/input-classes';

type AccountType =
  | 'asset'
  | 'liability'
  | 'equity'
  | 'income'
  | 'expense'
  | 'contra_asset'
  | 'contra_liability';
type NormalBalance = 'debit' | 'credit';

interface Account {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  description: string | null;
  isActive: boolean;
  isSystem: boolean;
}

const items = ref<Account[]>([]);
const loading = ref(true);
const saving = ref(false);
const deleting = ref(false);
const seeding = ref(false);
const error = ref<string | null>(null);

const filterType = ref<'' | AccountType>('');

const editing = ref<Account | null>(null);
const modalOpen = ref(false);
const confirmOpen = ref(false);
const toDelete = ref<Account | null>(null);

const form = reactive({
  parentId: '' as string,
  code: '',
  name: '',
  accountType: 'asset' as AccountType,
  normalBalance: 'debit' as NormalBalance,
  description: '',
  isActive: true,
});

const TYPE_LABEL: Record<AccountType, string> = {
  asset: 'Aset',
  liability: 'Kewajiban',
  equity: 'Aset Neto',
  income: 'Pendapatan',
  expense: 'Beban',
  contra_asset: 'Kontra Aset',
  contra_liability: 'Kontra Kewajiban',
};

const TYPE_BADGE: Record<AccountType, string> = {
  asset: 'bg-blue-50 text-blue-700',
  liability: 'bg-amber-50 text-amber-700',
  equity: 'bg-purple-50 text-purple-700',
  income: 'bg-emerald-50 text-emerald-700',
  expense: 'bg-rose-50 text-rose-700',
  contra_asset: 'bg-slate-100 text-slate-700',
  contra_liability: 'bg-slate-100 text-slate-700',
};

const TYPE_DEFAULT_BALANCE: Record<AccountType, NormalBalance> = {
  asset: 'debit',
  expense: 'debit',
  contra_liability: 'debit',
  liability: 'credit',
  equity: 'credit',
  income: 'credit',
  contra_asset: 'credit',
};

const filtered = computed(() =>
  filterType.value
    ? items.value.filter((a) => a.accountType === filterType.value)
    : items.value,
);

const parentOptions = computed(() =>
  items.value
    .filter((a) => a.id !== editing.value?.id)
    .map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` })),
);

function resetForm(a?: Account | null): void {
  form.parentId = a?.parentId ?? '';
  form.code = a?.code ?? '';
  form.name = a?.name ?? '';
  form.accountType = a?.accountType ?? 'asset';
  form.normalBalance = a?.normalBalance ?? 'debit';
  form.description = a?.description ?? '';
  form.isActive = a?.isActive ?? true;
}

function onTypeChange(): void {
  form.normalBalance = TYPE_DEFAULT_BALANCE[form.accountType];
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await api.get<{ data: Account[] }>('/api/v1/accounts');
    items.value = res.data;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  editing.value = null;
  resetForm(null);
  modalOpen.value = true;
}

function openEdit(a: Account): void {
  editing.value = a;
  resetForm(a);
  modalOpen.value = true;
}

async function save(): Promise<void> {
  saving.value = true;
  error.value = null;
  try {
    const payload = {
      parentId: form.parentId || null,
      code: form.code,
      name: form.name,
      accountType: form.accountType,
      normalBalance: form.normalBalance,
      description: form.description || null,
      isActive: form.isActive,
    };
    if (editing.value) {
      const { code: _omit, ...patch } = payload;
      void _omit;
      await api.patch(`/api/v1/accounts/${editing.value.id}`, patch);
    } else {
      await api.post('/api/v1/accounts', payload);
    }
    modalOpen.value = false;
    await load();
  } catch (err) {
    const e = err as { body?: { error?: string } };
    error.value = e.body?.error ?? (err as Error).message;
  } finally {
    saving.value = false;
  }
}

function askDelete(a: Account): void {
  toDelete.value = a;
  confirmOpen.value = true;
}

async function doDelete(): Promise<void> {
  if (!toDelete.value) return;
  deleting.value = true;
  try {
    await api.delete(`/api/v1/accounts/${toDelete.value.id}`);
    confirmOpen.value = false;
    toDelete.value = null;
    await load();
  } catch (err) {
    const e = err as { body?: { error?: string } };
    error.value = e.body?.error ?? (err as Error).message;
  } finally {
    deleting.value = false;
  }
}

async function seed(): Promise<void> {
  seeding.value = true;
  error.value = null;
  try {
    await api.post('/api/v1/accounts/_seed', {});
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    seeding.value = false;
  }
}

function indent(code: string): number {
  return Math.max(0, Math.min(4, code.length - 4));
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-slate-900">Bagan Akun</h1>
        <p class="text-sm text-slate-500">Chart of Accounts berdasarkan PSAK 45</p>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="secondary" :loading="seeding" @click="seed">
          <Sprout class="h-4 w-4" /> Seed default
        </Button>
        <Button @click="openCreate"><Plus class="h-4 w-4" /> Tambah</Button>
      </div>
    </header>

    <div class="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <select v-model="filterType" :class="INPUT_BASE" style="max-width:200px">
        <option value="">Semua tipe</option>
        <option v-for="(label, k) in TYPE_LABEL" :key="k" :value="k">{{ label }}</option>
      </select>
      <span class="ml-auto text-xs text-slate-500">{{ filtered.length }} akun</span>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

    <div v-if="loading" class="space-y-2">
      <div v-for="i in 6" :key="i" class="h-10 animate-pulse rounded-lg border border-slate-200 bg-white" />
    </div>

    <div v-else-if="filtered.length > 0" class="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-2 font-medium">Kode</th>
            <th class="px-4 py-2 font-medium">Nama</th>
            <th class="px-4 py-2 font-medium">Tipe</th>
            <th class="px-4 py-2 font-medium">Saldo Normal</th>
            <th class="px-4 py-2 font-medium">Status</th>
            <th class="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="a in filtered" :key="a.id" class="hover:bg-slate-50">
            <td class="px-4 py-2 font-mono text-xs text-slate-700">{{ a.code }}</td>
            <td class="px-4 py-2">
              <span :style="{ paddingLeft: `${indent(a.code) * 12}px` }" class="inline-block">
                {{ a.name }}
              </span>
              <span v-if="a.isSystem" class="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">sistem</span>
            </td>
            <td class="px-4 py-2">
              <span class="rounded-full px-2 py-0.5 text-[11px] font-medium" :class="TYPE_BADGE[a.accountType]">
                {{ TYPE_LABEL[a.accountType] }}
              </span>
            </td>
            <td class="px-4 py-2 text-xs text-slate-600">{{ a.normalBalance === 'debit' ? 'Debit' : 'Kredit' }}</td>
            <td class="px-4 py-2">
              <span class="text-xs" :class="a.isActive ? 'text-emerald-700' : 'text-slate-400'">
                {{ a.isActive ? 'Aktif' : 'Nonaktif' }}
              </span>
            </td>
            <td class="px-4 py-2 text-right">
              <Button variant="ghost" size="sm" @click="openEdit(a)"><Pencil class="h-3.5 w-3.5" /></Button>
              <Button v-if="!a.isSystem" variant="ghost" size="sm" @click="askDelete(a)">
                <Trash2 class="h-3.5 w-3.5 text-red-600" />
              </Button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else class="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">
      Belum ada akun. Klik "Seed default" untuk memuat bagan akun PSAK 45.
    </p>

    <Modal v-model:open="modalOpen" :title="editing ? 'Edit Akun' : 'Akun Baru'" size="lg">
      <form class="space-y-3" @submit.prevent="save">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Kode" required>
            <input
              v-model="form.code"
              :class="INPUT_BASE"
              :disabled="!!editing"
              required
              maxlength="20"
              placeholder="1110"
            />
          </FormField>
          <FormField label="Akun induk">
            <select v-model="form.parentId" :class="INPUT_BASE">
              <option value="">— Tidak ada —</option>
              <option v-for="p in parentOptions" :key="p.id" :value="p.id">{{ p.label }}</option>
            </select>
          </FormField>
        </div>
        <FormField label="Nama" required>
          <input v-model="form.name" :class="INPUT_BASE" required minlength="2" />
        </FormField>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Tipe akun" required>
            <select v-model="form.accountType" :class="INPUT_BASE" @change="onTypeChange">
              <option v-for="(label, k) in TYPE_LABEL" :key="k" :value="k">{{ label }}</option>
            </select>
          </FormField>
          <FormField label="Saldo normal" required>
            <select v-model="form.normalBalance" :class="INPUT_BASE">
              <option value="debit">Debit</option>
              <option value="credit">Kredit</option>
            </select>
          </FormField>
        </div>
        <FormField label="Deskripsi">
          <textarea v-model="form.description" :class="TEXTAREA_BASE" rows="2" />
        </FormField>
        <FormField label="Status">
          <label class="inline-flex items-center gap-2 text-sm">
            <input v-model="form.isActive" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
            <span>Aktif</span>
          </label>
        </FormField>
      </form>
      <template #footer>
        <Button variant="secondary" @click="modalOpen = false">Batal</Button>
        <Button :loading="saving" @click="save">{{ editing ? 'Simpan' : 'Buat' }}</Button>
      </template>
    </Modal>

    <ConfirmDialog
      v-model:open="confirmOpen"
      title="Hapus akun"
      :message="`Akun “${toDelete?.code} — ${toDelete?.name}” akan dihapus (soft-delete).`"
      :loading="deleting"
      @confirm="doDelete"
    />
  </div>
</template>
