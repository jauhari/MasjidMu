<script setup lang="ts">
/**
 * Editor jurnal padat — minim langkah:
 * 1) Nominal + kategori (+ dana) di parent
 * 2) Tabel 2 baris: akun | debit | kredit
 * Nominal otomatis mengisi debit baris 1 & kredit baris 2.
 */
import { computed, ref, watch } from 'vue';
import { Plus, Trash2, CheckCircle2, AlertCircle, FolderPlus } from 'lucide-vue-next';
import Button from '@/shared/ui/Button.vue';
import AppSelect from '@/shared/ui/AppSelect.vue';
import SmartAccountSelect from '@/shared/ui/SmartAccountSelect.vue';
import MoneyText from '@/shared/ui/MoneyText.vue';
import MoneyInput from '@/shared/ui/MoneyInput.vue';
import { parseMoneyInput } from '@/shared/lib/money';

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
  defaultFundId?: string | null;
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
  /** Sembunyikan picker kategori/dana (kalau parent sudah handle) */
  hideToolbar?: boolean;
}>();

const emit = defineEmits<{
  'update:lines': [Line[]];
  'update:categoryId': [string | null];
  'request-create-category': [];
}>();

const localCategoryId = ref<string>(props.categoryId ?? '');
const headerFundId = ref<string>('');

watch(
  () => props.categoryId,
  (v) => {
    localCategoryId.value = v ?? '';
  },
);

const categoryOptions = computed(() => [
  { value: '', label: '— Template cepat (opsional) —' },
  ...(props.categories ?? []).map((c) => {
    const fundName = c.defaultFundId
      ? props.funds?.find((f) => f.id === c.defaultFundId)?.name
      : null;
    return {
      value: c.id,
      label: fundName ? `${c.name} · ${fundName}` : c.name,
    };
  }),
]);

const showFund = computed(() => (props.funds?.length ?? 0) > 0);
const fundOptions = computed(() => [
  { value: '', label: '— Pilih Dana (wajib) —' },
  ...(props.funds ?? []).map((f) => ({
    value: f.id,
    label: f.isRestricted ? `${f.name} *` : f.name,
  })),
]);

function num(s: string): number {
  const n = Number(s || '0');
  return Number.isFinite(n) ? n : 0;
}

/** Sync header dana dari baris — pakai unique fund ids (2 baris sama fund = 1 id). */
function syncHeaderFundFromLines(lines: Line[]): void {
  if (!showFund.value) return;
  const unique = [
    ...new Set(lines.map((l) => l.fundId).filter((id): id is string => !!id)),
  ];
  if (unique.length === 1) {
    headerFundId.value = unique[0]!;
  } else if (unique.length === 0) {
    // Jangan paksa kosong kalau user baru pilih di header tapi lines belum emit
    // — hanya clear jika lines benar-benar tanpa fund.
    if (lines.some((l) => l.accountId)) {
      headerFundId.value = '';
    }
  }
  // multi-fund: biarkan header apa adanya (user bisa seragamkan lewat applyFundToAll)
}

watch(
  () => props.lines,
  (lines) => {
    syncHeaderFundFromLines(lines);
  },
  { deep: true, immediate: true },
);

function emptyLine(): Line {
  return {
    accountId: '',
    debit: '0',
    credit: '0',
    description: null,
    fundId: headerFundId.value || null,
  };
}

function ensureMinLines(arr: Line[]): Line[] {
  const next = [...arr];
  while (next.length < 2) next.push(emptyLine());
  return next;
}

const editable = computed(() => ensureMinLines(props.lines));

function emitLines(next: Line[]): void {
  emit('update:lines', ensureMinLines(next));
}

function update(idx: number, patch: Partial<Line>): void {
  emitLines(editable.value.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
}

function addLine(): void {
  emitLines([...editable.value, emptyLine()]);
}

function removeLine(idx: number): void {
  emitLines(editable.value.filter((_, i) => i !== idx));
}

/** Nominal dari parent (form create). */
function amtFromHint(): string {
  const raw = props.amountHint == null ? '' : String(props.amountHint);
  if (!raw.trim() || raw.trim() === '0') return '0';
  return parseMoneyInput(raw, { allowZero: true }) || '0';
}

/**
 * Nominal efektif: hint parent, atau total debit/kredit baris yang sudah ada
 * (penting untuk force-edit / edit draft yang amountHint-nya null).
 */
function resolveAmount(): string {
  const fromHint = amtFromHint();
  if (fromHint !== '0' && Number(fromHint) > 0) return fromHint;

  let totalDebit = 0;
  let totalCredit = 0;
  for (const l of props.lines) {
    totalDebit += num(l.debit);
    totalCredit += num(l.credit);
  }
  const max = Math.max(totalDebit, totalCredit);
  if (max > 0) {
    // Canonical string tanpa formatting
    return String(Math.round(max * 100) / 100);
  }
  return '0';
}

function amt(): string {
  return resolveAmount();
}

const hasNominal = computed(() => {
  const a = resolveAmount();
  return a !== '0' && Number(a) > 0;
});

function applyFundToAll(fundId: string): void {
  headerFundId.value = fundId;
  emitLines(editable.value.map((l) => ({ ...l, fundId: fundId || null })));
}

/** Pola sederhana 2 baris: debit di [0], kredit di [1]. */
function applySimpleAmounts(lines: Line[], amount: string, fundId: string | null): Line[] {
  const base = ensureMinLines(lines);
  if (base.length === 2) {
    return [
      {
        ...base[0]!,
        debit: amount,
        credit: '0',
        fundId: fundId ?? base[0]!.fundId,
      },
      {
        ...base[1]!,
        debit: '0',
        credit: amount,
        fundId: fundId ?? base[1]!.fundId,
      },
    ];
  }
  // >2 baris: isi baris pertama yang kosong, atau update baris 0 & 1
  const next = base.map((l) => ({ ...l, fundId: fundId ?? l.fundId }));
  if (next[0]) {
    next[0] = { ...next[0], debit: amount, credit: '0' };
  }
  if (next[1]) {
    next[1] = { ...next[1], debit: '0', credit: amount };
  }
  return next;
}

/** Terapkan nominal ke debit/kredit (dipanggil otomatis & lewat tombol). */
function applyNominalToLines(): void {
  const amount = resolveAmount();
  if (amount === '0') return;
  const fundId = headerFundId.value || null;
  emitLines(applySimpleAmounts(props.lines, amount, fundId));
}

function applyCategory(selectedId?: string): void {
  // Jangan andalkan localCategoryId di tick yang sama dengan v-model — pakai argumen event.
  const catId = selectedId !== undefined ? selectedId : localCategoryId.value;
  localCategoryId.value = catId;
  emit('update:categoryId', catId || null);

  if (!catId) return; // clear template: jangan hapus nominal/akun

  const c = props.categories?.find((x) => x.id === catId);
  if (!c) return;

  // Jangan reset ke 0: pakai hint ATAU nominal yang sudah di baris jurnal
  const amount = resolveAmount();
  // Default dana dari kategori; fallback header / fund di baris existing
  const existingFund =
    headerFundId.value ||
    props.lines.map((l) => l.fundId).find((id): id is string => !!id) ||
    null;
  const fundId = c.defaultFundId || existingFund || null;
  if (fundId) headerFundId.value = fundId;

  const prev = ensureMinLines(props.lines);
  emitLines([
    {
      accountId: c.debitAccountId ?? prev[0]?.accountId ?? '',
      debit: amount,
      credit: '0',
      description: prev[0]?.description ?? null,
      fundId,
    },
    {
      accountId: c.creditAccountId ?? prev[1]?.accountId ?? '',
      debit: '0',
      credit: amount,
      description: prev[1]?.description ?? null,
      fundId,
    },
  ]);
}

/** Nominal hint parent berubah → isi debit/kredit (hanya jika hint > 0). */
watch(
  () => props.amountHint,
  () => {
    const fromHint = amtFromHint();
    if (fromHint === '0' || Number(fromHint) <= 0) return;
    applyNominalToLines();
  },
);

const totals = computed(() => {
  const d = editable.value.reduce((a, l) => a + num(l.debit), 0);
  const c = editable.value.reduce((a, l) => a + num(l.credit), 0);
  return { debit: d, credit: c, diff: d - c, balanced: d === c && d > 0 };
});

function suggestedAccountFor(lineIndex: number): string | null {
  const cat = props.categories?.find((c) => c.id === localCategoryId.value);
  if (!cat) return null;
  if (lineIndex === 0) return cat.debitAccountId ?? null;
  if (lineIndex === 1) return cat.creditAccountId ?? null;
  return null;
}

function onAmountUpdate(idx: number, field: 'debit' | 'credit', value: string): void {
  const cleaned = parseMoneyInput(value, { allowZero: true }) || '0';
  const line = editable.value[idx];
  if (!line) return;
  const other = field === 'debit' ? 'credit' : 'debit';
  const patch: Partial<Line> = { [field]: cleaned };
  if (cleaned !== '0' && num(line[other]) > 0) patch[other] = '0';
  update(idx, patch);
}
</script>

<template>
  <div class="space-y-2">
    <!-- Toolbar padat: kategori + dana sebaris -->
    <div
      v-if="!hideToolbar"
      class="flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <div class="min-w-0 flex-1">
          <AppSelect
            :model-value="localCategoryId"
            :options="categoryOptions"
            :disabled="disabled"
            @update:model-value="applyCategory"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          class="h-9 shrink-0 px-2"
          :disabled="disabled"
          title="Kategori baru"
          @click="emit('request-create-category')"
        >
          <FolderPlus class="size-3.5" />
        </Button>
      </div>
      <div
        v-if="showFund"
        class="min-w-0 sm:w-56"
        :class="!headerFundId ? 'rounded-md ring-2 ring-amber-400/70 ring-offset-1' : ''"
        :title="!headerFundId ? 'Wajib: pilih dana agar masuk SPD / kartu dana' : undefined"
      >
        <AppSelect
          :model-value="headerFundId"
          :options="fundOptions"
          :disabled="disabled"
          @update:model-value="(v: string) => applyFundToAll(v)"
        />
      </div>
      <!-- Status / aksi terapkan nominal -->
      <button
        v-if="hasNominal && totals.debit === 0 && totals.credit === 0"
        type="button"
        class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/15"
        :disabled="disabled"
        @click="applyNominalToLines"
      >
        Terapkan <MoneyText :value="amt()" class="inline text-primary" />
      </button>
      <div
        v-else
        class="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border px-2.5 text-[11px] font-semibold"
        :class="
          totals.balanced
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : totals.debit > 0 || totals.credit > 0
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-border bg-muted/40 text-muted-foreground'
        "
      >
        <CheckCircle2 v-if="totals.balanced" class="size-3.5" />
        <AlertCircle v-else-if="totals.debit > 0 || totals.credit > 0" class="size-3.5" />
        <template v-if="totals.balanced">
          OK <MoneyText :value="totals.debit" class="inline" />
        </template>
        <template v-else-if="!hasNominal">Isi nominal di atas</template>
        <template v-else>
          Δ <MoneyText :value="Math.abs(totals.diff)" class="inline" />
        </template>
      </div>
    </div>

    <!-- Tabel padat -->
    <div class="overflow-x-auto rounded-lg border border-border/80">
      <table class="w-full min-w-[28rem] border-collapse text-sm">
        <thead>
          <tr class="border-b bg-muted/40 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <th class="w-8 px-2 py-1.5">#</th>
            <th class="px-2 py-1.5">Akun</th>
            <th class="w-[7.5rem] px-2 py-1.5 text-right text-emerald-800">Debit</th>
            <th class="w-[7.5rem] px-2 py-1.5 text-right text-amber-800">Kredit</th>
            <th class="w-8 px-1 py-1.5" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(line, i) in editable"
            :key="i"
            class="border-b border-border/50 last:border-0"
          >
            <td class="px-2 py-1.5 text-center text-[11px] text-muted-foreground">{{ i + 1 }}</td>
            <td class="min-w-0 px-2 py-1.5">
              <SmartAccountSelect
                :model-value="line.accountId || null"
                :accounts="accounts"
                :disabled="disabled"
                :suggested-account-id="suggestedAccountFor(i)"
                placeholder="Pilih akun…"
                required
                @update:model-value="(v: string) => update(i, { accountId: v })"
              />
            </td>
            <td class="px-1.5 py-1.5">
              <MoneyInput
                :model-value="line.debit === '0' ? '' : line.debit"
                :disabled="disabled"
                :show-currency="false"
                :allow-zero="true"
                placeholder="0"
                input-class="h-8 border-emerald-200/70 bg-emerald-50/30 text-xs"
                @update:model-value="(v) => onAmountUpdate(i, 'debit', v)"
              />
            </td>
            <td class="px-1.5 py-1.5">
              <MoneyInput
                :model-value="line.credit === '0' ? '' : line.credit"
                :disabled="disabled"
                :show-currency="false"
                :allow-zero="true"
                placeholder="0"
                input-class="h-8 border-amber-200/70 bg-amber-50/30 text-xs"
                @update:model-value="(v) => onAmountUpdate(i, 'credit', v)"
              />
            </td>
            <td class="px-1 py-1.5 text-center">
              <button
                v-if="editable.length > 2 && !disabled"
                type="button"
                class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                title="Hapus"
                @click="removeLine(i)"
              >
                <Trash2 class="size-3.5" />
              </button>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="border-t bg-muted/30 text-xs font-semibold">
            <td colspan="2" class="px-2 py-1.5 text-right text-muted-foreground">Total</td>
            <td class="px-2 py-1.5 text-right text-emerald-800">
              <MoneyText :value="totals.debit" class="text-xs" />
            </td>
            <td class="px-2 py-1.5 text-right text-amber-800">
              <MoneyText :value="totals.credit" class="text-xs" />
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>

    <button
      type="button"
      class="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
      :disabled="disabled"
      @click="addLine"
    >
      <Plus class="size-3" /> Tambah baris
    </button>
  </div>
</template>
