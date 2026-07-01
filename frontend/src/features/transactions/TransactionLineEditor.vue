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
import { Plus, Trash2, AlertCircle, CheckCircle2, FolderPlus } from 'lucide-vue-next';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Button from '@/shared/ui/Button.vue';
import AppSelect from '@/shared/ui/AppSelect.vue';
import SmartAccountSelect from '@/shared/ui/SmartAccountSelect.vue';
import MoneyText from '@/shared/ui/MoneyText.vue';

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
  direction: 'income' | 'expense';
  debitAccountId: string | null;
  creditAccountId: string | null;
  isActive: boolean;
}

interface Fund {
  id: string;
  code: string;
  name: string;
  isRestricted: boolean;
  isActive: boolean;
}

export interface Line {
  accountId: string;
  debit: string;
  credit: string;
  description: string | null;
  fundId: string | null;
}

const props = defineProps<{
  lines: Line[];
  accounts: Account[];
  categories?: Category[];
  funds?: Fund[];
  categoryId?: string | null;
  amountHint?: string | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:lines': [Line[]];
  'update:categoryId': [string | null];
  'request-create-category': [];
}>();

const localCategoryId = ref<string>(props.categoryId ?? '');

watch(
  () => props.categoryId,
  (v) => {
    localCategoryId.value = v ?? '';
  },
);

const categoryOptions = computed(() => [
  { value: '', label: '— Tanpa kategori (manual) —' },
  ...(props.categories ?? []).map((c) => ({
    value: c.id,
    label: `${c.code} — ${c.name}`,
  })),
]);

const showFund = computed(() => (props.funds?.length ?? 0) > 0);
const fundOptions = computed(() => [
  { value: '', label: '— Tanpa dana —' },
  ...(props.funds ?? []).map((f) => ({
    value: f.id,
    label: f.isRestricted ? `${f.name} *` : f.name,
  })),
]);

function emptyLine(): Line {
  return { accountId: '', debit: '0', credit: '0', description: null, fundId: null };
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
  if (!c) {
    emit('update:categoryId', localCategoryId.value || null);
    return;
  }
  emit('update:categoryId', c.id);
  const amt = parseAndClean(props.amountHint || '') || '0';
  // Auto-fill akun dari mapping kategori. Kalau ada amountHint, pakai nominal
  // itu di sisi yang relevan; kalau nggak, akun tetap terisi, nominal 0.
  emit('update:lines', [
    { accountId: c.debitAccountId ?? '', debit: amt, credit: '0', description: null, fundId: null },
    { accountId: c.creditAccountId ?? '', debit: '0', credit: amt, description: null, fundId: null },
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

/**
 * Format angka: separator ribuan pakai SPASI, desimal pakai `,`.
 * 5000 → "5 000", 1000000 → "1 000 000", 5000.5 → "5 000,5"
 * Pakai spasi biar gak dikira desimal (beda sama titik `.`).
 */
function fmtInput(value: string): string {
  if (!value || value === '0') return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  const parts = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2, useGrouping: false }).format(n).split(',');
  // Sisipkan spasi tiap 3 digit dari kanan
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  const decPart = parts[1] ? `,${parts[1]}` : '';
  return intPart + decPart;
}

function displayValue(line: Line, idx: number, field: 'debit' | 'credit'): string {
  const raw = line[field];
  const f = focused.value;
  if (f && f.line === idx && f.field === field) {
    // Fokus: raw — buang trailing .00 biar gak bikin bingung
    if (!raw || raw === '0') return '';
    return raw.replace(/\.0{1,2}$/, '');
  }
  // Tidak fokus: formatted dengan spasi ribuan
  return fmtInput(raw);
}

/**
 * Parse input user: hapus separator ribuan (`.`), ganti desimal `,` → `.`,
 * evaluasi ekspresi `+` untuk penjumlahan pintar.
 * "10000" → "10000", "10.000+25.000+500" → "35500"
 */
function parseAndClean(raw: string): string {
  if (!raw) return '';
  // Strip thousand separators (. dan spasi non-breaking) + convert IDR decimal (,) → (.)
  let s = raw.replace(/\./g, '').replace(/\s/g, '').replace(/,/g, '.');
  // Smart addition: 10000+25000+500
  if (s.includes('+')) {
    const parts = s.split('+');
    if (parts.every((p) => /^\d*(\.\d+)?$/.test(p.trim()))) {
      s = String(parts.reduce((a, p) => a + Number(p.trim() || '0'), 0));
    }
  }
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? String(n) : '';
}

function suggestedAccountFor(lineIndex: number): string | null {
  const cat = props.categories?.find((c) => c.id === localCategoryId.value);
  if (!cat) return null;
  if (lineIndex === 0) return cat.debitAccountId ?? null;
  if (lineIndex === 1) return cat.creditAccountId ?? null;
  return null;
}

/** Track which line/field is currently focused — show raw value while editing. */
const focused = ref<{ line: number; field: 'debit' | 'credit' } | null>(null);

function onAmountFocused(idx: number, field: 'debit' | 'credit'): void {
  focused.value = { line: idx, field };
}

function onAmountBlurred(idx: number, field: 'debit' | 'credit'): void {
  const line = editable.value[idx];
  if (!line) return;
  const raw = line[field];
  const hasExpression = raw.includes('+');
  const cleaned = parseAndClean(raw);
  const other = field === 'debit' ? 'credit' : 'debit';
  const patch: Partial<Line> = {};
  if (cleaned !== raw) {
    patch[field] = cleaned;
  }
  // XOR enforcement on confirm: debit dan kredit gak boleh sama-sama > 0
  if (cleaned && cleaned !== '0' && num(line[other]) > 0) {
    patch[other] = '0';
  }
  // Auto-fill description: rekap ekspresi kalkulator
  if (hasExpression && cleaned && !line.description) {
    const parts = raw.split('+').filter((p) => p.trim());
    if (parts.length > 1) {
      const formatted = parts.map((p) => {
        const n = Number(p.trim().replace(/\./g, '').replace(/,/g, '.'));
        return Number.isFinite(n) ? fmtIDR(String(n)) : p.trim();
      });
      patch.description = formatted.join(' + ');
    }
  }
  if (Object.keys(patch).length > 0) {
    update(idx, patch);
  }
  focused.value = null;
}

function onAmountInput(idx: number, field: 'debit' | 'credit', value: string): void {
  // Strip spasi separator ribuan supaya gak ikut tersimpan sebagai digit
  const raw = value.replace(/\s/g, '');
  if (raw) {
    update(idx, { [field]: raw });
  } else {
    update(idx, { [field]: '0' });
  }
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-2.5">
      <label class="whitespace-nowrap text-xs font-semibold text-muted-foreground">Kategori:</label>
      <div class="min-w-0 flex-1">
        <AppSelect
          v-model="localCategoryId"
          :options="categoryOptions"
          :disabled="disabled"
          @update:model-value="applyCategory"
        />
      </div>
      <Button
        variant="outline"
        size="sm"
        :disabled="disabled"
        title="Tambah kategori baru"
        @click="emit('request-create-category')"
      >
        <FolderPlus class="h-3.5 w-3.5" /> Baru
      </Button>
    </div>

    <div class="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader class="bg-muted/50">
          <TableRow class="hover:bg-transparent">
            <TableHead class="w-8 px-2 text-xs uppercase tracking-wide text-muted-foreground">#</TableHead>
            <TableHead class="px-3 text-xs uppercase tracking-wide text-muted-foreground">Akun (COA)</TableHead>
            <TableHead v-if="showFund" class="w-40 px-3 text-xs uppercase tracking-wide text-muted-foreground">Dana</TableHead>
            <TableHead class="px-3 text-xs uppercase tracking-wide text-muted-foreground">Keterangan</TableHead>
            <TableHead class="w-36 px-3 text-right text-xs uppercase tracking-wide text-emerald-800 bg-emerald-50/70">
              Debit
            </TableHead>
            <TableHead class="w-36 px-3 text-right text-xs uppercase tracking-wide text-amber-800 bg-amber-50/70">
              Kredit
            </TableHead>
            <TableHead class="w-10 px-2" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="(line, i) in editable" :key="i">
            <TableCell class="px-2 py-2 text-center text-xs text-muted-foreground">{{ i + 1 }}</TableCell>
            <TableCell class="px-3 py-2">
              <SmartAccountSelect
                :model-value="line.accountId || null"
                :accounts="accounts"
                :disabled="disabled"
                :suggested-account-id="suggestedAccountFor(i)"
                placeholder="Pilih akun…"
                required
                @update:model-value="(v: string) => update(i, { accountId: v })"
              />
            </TableCell>
            <TableCell v-if="showFund" class="px-3 py-2">
              <AppSelect
                :model-value="line.fundId ?? ''"
                :options="fundOptions"
                :disabled="disabled"
                @update:model-value="(v: string) => update(i, { fundId: v || null })"
              />
            </TableCell>
            <TableCell class="px-3 py-2">
              <Input
                :model-value="line.description ?? ''"
                :disabled="disabled"
                placeholder="(opsional)"
                @update:model-value="(v) => update(i, { description: String(v) || null })"
              />
            </TableCell>
            <TableCell class="px-3 py-2 bg-emerald-50/30">
              <Input
                :model-value="displayValue(line, i, 'debit')"
                class="border-emerald-200 bg-background text-right font-mono tabular-nums focus-visible:border-emerald-400 focus-visible:ring-emerald-100"
                :disabled="disabled"
                inputmode="numeric"
                placeholder="0"
                @focus="onAmountFocused(i, 'debit')"
                @blur="onAmountBlurred(i, 'debit')"
                @update:model-value="(v) => onAmountInput(i, 'debit', String(v))"
              />
            </TableCell>
            <TableCell class="px-3 py-2 bg-amber-50/30">
              <Input
                :model-value="displayValue(line, i, 'credit')"
                class="border-amber-200 bg-background text-right font-mono tabular-nums focus-visible:border-amber-400 focus-visible:ring-amber-100"
                :disabled="disabled"
                inputmode="numeric"
                placeholder="0"
                @focus="onAmountFocused(i, 'credit')"
                @blur="onAmountBlurred(i, 'credit')"
                @update:model-value="(v) => onAmountInput(i, 'credit', String(v))"
              />
            </TableCell>
            <TableCell class="px-2 py-2 text-center">
              <Button
                v-if="editable.length > 2 && !disabled"
                variant="ghost"
                size="sm"
                title="Hapus baris"
                @click="removeLine(i)"
              >
                <Trash2 class="h-4 w-4 text-destructive" />
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow class="hover:bg-transparent">
            <TableCell :colspan="showFund ? 4 : 3" class="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total
            </TableCell>
            <TableCell class="px-3 py-2 text-right font-mono text-sm font-semibold bg-emerald-50/50 text-emerald-800">
              <MoneyText :value="totals.debit" />
            </TableCell>
            <TableCell class="px-3 py-2 text-right font-mono text-sm font-semibold bg-amber-50/50 text-amber-800">
              <MoneyText :value="totals.credit" />
            </TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
    </div>

    <div class="flex items-center justify-between">
      <Button
        variant="outline"
        size="sm"
        class="border-dashed"
        :disabled="disabled"
        @click="addLine"
      >
        <Plus class="h-3.5 w-3.5" /> Tambah baris
      </Button>
      <div class="flex items-center gap-3">
        <span class="text-[0.65rem] text-muted-foreground">
          Tip: gunakan <kbd class="rounded border border-border bg-muted px-1 py-px text-[0.6rem] font-mono">+</kbd> untuk penjumlahan otomatis · <kbd class="rounded border border-border bg-muted px-1 py-px text-[0.6rem] font-mono">Tab</kbd> untuk format
        </span>
        <div
          class="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors duration-200"
          :class="totals.balanced
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : (totals.debit > 0 || totals.credit > 0)
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'border-border bg-muted/50 text-muted-foreground'"
        >
          <CheckCircle2 v-if="totals.balanced" class="h-4 w-4 shrink-0" />
          <AlertCircle v-else-if="totals.debit > 0 || totals.credit > 0" class="h-4 w-4 shrink-0" />
          <span v-else class="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-current opacity-30" />
          <span v-if="totals.balanced" class="inline-flex items-center gap-1">
            Seimbang · <MoneyText :value="totals.debit" class="inline" />
          </span>
          <span v-else-if="totals.debit === 0 && totals.credit === 0">Belum ada nominal</span>
          <span v-else class="inline-flex items-center gap-1">
            Selisih <MoneyText :value="Math.abs(totals.diff)" class="inline" />
          </span>
        </div>
      </div>
    </div>
  </div>
</template>