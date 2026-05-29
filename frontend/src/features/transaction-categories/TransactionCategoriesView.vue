<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue';
import { Plus, Pencil, Trash2 } from 'lucide-vue-next';
import { api } from '@/shared/api/client';
import Button from '@/shared/ui/Button.vue';
import Modal from '@/shared/ui/Modal.vue';
import FormField from '@/shared/ui/FormField.vue';
import ConfirmDialog from '@/shared/ui/ConfirmDialog.vue';
import { INPUT_BASE } from '@/shared/ui/input-classes';

type Direction = 'income' | 'expense';

interface Account {
  id: string;
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
  debitAccountId: string;
  creditAccountId: string;
  isActive: boolean;
}

const items = ref<Category[]>([]);
const accounts = ref<Account[]>([]);
const loading = ref(true);
const saving = ref(false);
const deleting = ref(false);
const error = ref<string | null>(null);

const filterDirection = ref<'' | Direction>('');

const editing = ref<Category | null>(null);
const modalOpen = ref(false);
const confirmOpen = ref(false);
const toDelete = ref<Category | null>(null);

const form = reactive({
  code: '',
  name: '',
  direction: 'income' as Direction,
  debitAccountId: '',
  creditAccountId: '',
  isActive: true,
});

const filtered = computed(() =>
  filterDirection.value
    ? items.value.filter((c) => c.direction === filterDirection.value)
    : items.value,
);

const accountById = computed(() => {
  const m = new Map<string, Account>();
  accounts.value.forEach((a) => m.set(a.id, a));
  return m;
});

function fmtAccount(id: string): string {
  const a = accountById.value.get(id);
  return a ? `${a.code} — ${a.name}` : id;
}

function resetForm(c?: Category | null): void {
  form.code = c?.code ?? '';
  form.name = c?.name ?? '';
  form.direction = c?.direction ?? 'income';
  form.debitAccountId = c?.debitAccountId ?? '';
  form.creditAccountId = c?.creditAccountId ?? '';
  form.isActive = c?.isActive ?? true;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [cRes, aRes] = await Promise.all([
      api.get<{ data: Category[] }>('/api/v1/transaction-categories'),
      api.get<{ data: Account[] }>('/api/v1/accounts'),
    ]);
    items.value = cRes.data;
    accounts.value = aRes.data.filter((a) => a.isActive);
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

function openEdit(c: Category): void {
  editing.value = c;
  resetForm(c);
  modalOpen.value = true;
}

async function save(): Promise<void> {
  saving.value = true;
  error.value = null;
  try {
    const payload = {
      code: form.code,
      name: form.name,
      direction: form.direction,
      debitAccountId: form.debitAccountId,
      creditAccountId: form.creditAccountId,
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
    await load();
  } catch (err) {
    const e = err as { body?: { error?: string; missing?: string[] } };
    error.value = e.body?.error
      ? e.body.error + (e.body.missing ? ` (${e.body.missing.join(', ')})` : '')
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
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-slate-900">Kategori Transaksi</h1>
        <p class="text-sm text-slate-500">Pemetaan kategori ke pasangan akun debit/kredit</p>
      </div>
      <Button @click="openCreate"><Plus class="h-4 w-4" /> Tambah</Button>
    </header>

    <div class="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <select v-model="filterDirection" :class="INPUT_BASE" style="max-width:200px">
        <option value="">Semua arah</option>
        <option value="income">Pemasukan</option>
        <option value="expense">Pengeluaran</option>
      </select>
      <span class="ml-auto text-xs text-slate-500">{{ filtered.length }} kategori</span>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

    <div v-if="loading" class="space-y-2">
      <div v-for="i in 4" :key="i" class="h-12 animate-pulse rounded-lg border border-slate-200 bg-white" />
    </div>

    <div v-else-if="filtered.length > 0" class="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-2 font-medium">Kode</th>
            <th class="px-4 py-2 font-medium">Nama</th>
            <th class="px-4 py-2 font-medium">Arah</th>
            <th class="px-4 py-2 font-medium">Debit</th>
            <th class="px-4 py-2 font-medium">Kredit</th>
            <th class="px-4 py-2 font-medium">Status</th>
            <th class="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="c in filtered" :key="c.id" class="hover:bg-slate-50">
            <td class="px-4 py-2 font-mono text-xs">{{ c.code }}</td>
            <td class="px-4 py-2">{{ c.name }}</td>
            <td class="px-4 py-2">
              <span
                class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                :class="c.direction === 'income' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'"
              >
                {{ c.direction === 'income' ? 'Pemasukan' : 'Pengeluaran' }}
              </span>
            </td>
            <td class="px-4 py-2 text-xs text-slate-600">{{ fmtAccount(c.debitAccountId) }}</td>
            <td class="px-4 py-2 text-xs text-slate-600">{{ fmtAccount(c.creditAccountId) }}</td>
            <td class="px-4 py-2">
              <span class="text-xs" :class="c.isActive ? 'text-emerald-700' : 'text-slate-400'">
                {{ c.isActive ? 'Aktif' : 'Nonaktif' }}
              </span>
            </td>
            <td class="px-4 py-2 text-right">
              <Button variant="ghost" size="sm" @click="openEdit(c)"><Pencil class="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="sm" @click="askDelete(c)">
                <Trash2 class="h-3.5 w-3.5 text-red-600" />
              </Button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else class="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">
      Belum ada kategori.
    </p>

    <Modal v-model:open="modalOpen" :title="editing ? 'Edit Kategori' : 'Kategori Baru'" size="lg">
      <form class="space-y-3" @submit.prevent="save">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Kode" required>
            <input
              v-model="form.code"
              :class="INPUT_BASE"
              :disabled="!!editing"
              required
              maxlength="50"
              placeholder="INFAQ_JUMAT"
            />
          </FormField>
          <FormField label="Arah" required>
            <select v-model="form.direction" :class="INPUT_BASE">
              <option value="income">Pemasukan</option>
              <option value="expense">Pengeluaran</option>
            </select>
          </FormField>
        </div>
        <FormField label="Nama" required>
          <input v-model="form.name" :class="INPUT_BASE" required minlength="2" />
        </FormField>
        <FormField label="Akun debit" required>
          <select v-model="form.debitAccountId" :class="INPUT_BASE" required>
            <option value="">— Pilih akun —</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.code }} — {{ a.name }}</option>
          </select>
        </FormField>
        <FormField label="Akun kredit" required>
          <select v-model="form.creditAccountId" :class="INPUT_BASE" required>
            <option value="">— Pilih akun —</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.code }} — {{ a.name }}</option>
          </select>
        </FormField>
        <FormField label="Status">
          <label class="inline-flex items-center gap-2 text-sm">
            <input v-model="form.isActive" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
            <span>Aktif</span>
          </label>
        </FormField>
        <p class="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <strong>Pemasukan</strong>: kas/bank di debit, pendapatan di kredit.
          <strong>Pengeluaran</strong>: beban di debit, kas/bank di kredit.
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
