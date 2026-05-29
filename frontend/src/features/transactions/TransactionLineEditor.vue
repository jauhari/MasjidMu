<script setup lang="ts">
/**
 * TransactionLineEditor — multi-line double-entry editor.
 *
 * Each line: account (COA picker) + description + debit OR credit.
 * Validates: at least 2 lines, exactly one of debit/credit > 0 per line,
 * sum(debit) === sum(credit). Emits update:lines on every change.
 *
 * Optional `categoryId` shortcut: picking a category auto-fills 2 lines
 * (debit account + credit account from category mapping). User can edit
 * after the auto-fill.
 */
import { computed, ref, watch } from 'vue';
import { Plus, Trash2, AlertCircle, CheckCircle2 } from 'lucide-vue-next';
import { INPUT_BASE } from '@/shared/ui/input-classes';

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
  direction: 'income' | 'expense';
  debitAccountId: string;
  creditAccountId: string;
  isActive: boolean;
}

export interface Line {
  accountId: string;
  debit: string;
  credit: string;
  description: string | null;
}

const props = defineProps<{
  lines: Line[];
  accounts: Account[];
  categories?: Category[];
  categoryId?: string | null;
  amountHint?: string | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:lines': [Line[]];
  'update:categoryId': [string | null];
}>();

const localCategoryId = ref<string>(props.categoryId ?? '');

watch(
  () => props.categoryId,
  (v) => {
    localCategoryId.value = v ?? '';
  },
);

function emptyLine(): Line {
  return { accountId: '', debit: '0', credit: '0', description: null };
}

function ensureMinLines(arr: Line[]): Line[] {
  const next = [...arr];
  while (next.length < 2) next.push(emptyLine());
  return next;
}

const editable = computed(() => ensureMinLines(props.lines));

function update(idx: number, patch: Partial<Line>): void {
  const next = editable.value.map((l, i) => (i === idx ? { ...l, ...patch } : l));
  emit('update:lines', next);
}

function addLine(): void {
  emit('update:lines', [...editable.value, emptyLine()]);
}

function removeLine(idx: number): void {
  const next = editable.value.filter((_, i) => i !== idx);
  emit('update:lines', ensureMinLines(next));
}

function applyCategory(): void {
  const c = props.categories?.find((x) => x.id === localCategoryId.value);
  if (!c || !props.amountHint) {
    emit('update:categoryId', localCategoryId.value || null);
    return;
  }
  const amt = props.amountHint;
  emit('update:categoryId', c.id);
  emit('update:lines', [
    { accountId: c.debitAccountId, debit: amt, credit: '0', description: null },
    { accountId: c.creditAccountId, debit: '0', credit: amt, description: null },
  ]);
}

function fmtIDR(s: string): string {
  const n = Number(s || '0');
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(n);
}

function num(s: string): number {
  const n = Number(s || '0');
  return Number.isFinite(n) ? n : 0;
}

const totals = computed(() => {
  const d = editable.value.reduce((a, l) => a + num(l.debit), 0);
  const c = editable.value.reduce((a, l) => a + num(l.credit), 0);
  return { debit: d, credit: c, diff: d - c, balanced: d === c && d > 0 };
});

function onAmountInput(idx: number, field: 'debit' | 'credit', value: string): void {
  if (value && Number(value) > 0) {
    update(idx, { [field]: value, [field === 'debit' ? 'credit' : 'debit']: '0' } as Partial<Line>);
  } else {
    update(idx, { [field]: '0' } as Partial<Line>);
  }
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="categories?.length" class="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
      <label class="text-xs font-medium text-slate-600">Shortcut kategori:</label>
      <select v-model="localCategoryId" :class="INPUT_BASE" :disabled="disabled" class="!w-auto flex-1" @change="applyCategory">
        <option value="">— Tanpa kategori (manual) —</option>
        <option v-for="c in categories" :key="c.id" :value="c.id">
          {{ c.code }} — {{ c.name }}
        </option>
      </select>
      <span v-if="amountHint" class="text-xs text-slate-500">akan otomatis isi 2 baris dgn nominal {{ fmtIDR(amountHint) }}</span>
    </div>

    <div class="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="w-8 px-2 py-2 font-medium">#</th>
            <th class="px-3 py-2 font-medium">Akun (COA)</th>
            <th class="px-3 py-2 font-medium">Keterangan</th>
            <th class="w-36 px-3 py-2 text-right font-medium">Debit</th>
            <th class="w-36 px-3 py-2 text-right font-medium">Kredit</th>
            <th class="w-10 px-2 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="(line, i) in editable" :key="i">
            <td class="px-2 py-2 text-center text-xs text-slate-400">{{ i + 1 }}</td>
            <td class="px-3 py-2">
              <select
                :value="line.accountId"
                :class="INPUT_BASE"
                :disabled="disabled"
                required
                @change="update(i, { accountId: ($event.target as HTMLSelectElement).value })"
              >
                <option value="" disabled>Pilih akun…</option>
                <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.code }} — {{ a.name }}</option>
              </select>
            </td>
            <td class="px-3 py-2">
              <input
                :value="line.description ?? ''"
                :class="INPUT_BASE"
                :disabled="disabled"
                placeholder="(opsional)"
                @input="update(i, { description: ($event.target as HTMLInputElement).value || null })"
              />
            </td>
            <td class="px-3 py-2">
              <input
                :value="num(line.debit) > 0 ? line.debit : ''"
                :class="[INPUT_BASE, 'text-right font-mono']"
                :disabled="disabled"
                placeholder="0"
                pattern="^\d+(\.\d{1,2})?$"
                @input="onAmountInput(i, 'debit', ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td class="px-3 py-2">
              <input
                :value="num(line.credit) > 0 ? line.credit : ''"
                :class="[INPUT_BASE, 'text-right font-mono']"
                :disabled="disabled"
                placeholder="0"
                pattern="^\d+(\.\d{1,2})?$"
                @input="onAmountInput(i, 'credit', ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td class="px-2 py-2 text-center">
              <button
                v-if="editable.length > 2 && !disabled"
                type="button"
                class="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                title="Hapus baris"
                @click="removeLine(i)"
              >
                <Trash2 class="h-4 w-4" />
              </button>
            </td>
          </tr>
        </tbody>
        <tfoot class="border-t border-slate-200 bg-slate-50">
          <tr>
            <td colspan="3" class="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Total</td>
            <td class="px-3 py-2 text-right font-mono text-sm font-semibold tabular-nums text-slate-900">{{ fmtIDR(String(totals.debit)) }}</td>
            <td class="px-3 py-2 text-right font-mono text-sm font-semibold tabular-nums text-slate-900">{{ fmtIDR(String(totals.credit)) }}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="flex items-center justify-between">
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:border-slate-400 hover:text-slate-900"
        :disabled="disabled"
        @click="addLine"
      >
        <Plus class="h-3.5 w-3.5" /> Tambah baris
      </button>
      <div
        class="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium"
        :class="totals.balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'"
      >
        <CheckCircle2 v-if="totals.balanced" class="h-4 w-4" />
        <AlertCircle v-else class="h-4 w-4" />
        <span v-if="totals.balanced">Seimbang • Rp {{ fmtIDR(String(totals.debit)) }}</span>
        <span v-else-if="totals.debit === 0 && totals.credit === 0">Belum ada nominal</span>
        <span v-else>Selisih Rp {{ fmtIDR(String(Math.abs(totals.diff))) }}</span>
      </div>
    </div>
  </div>
</template>
