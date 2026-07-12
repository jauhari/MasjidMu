<script setup lang="ts">
/**
 * Picker akun COA — daftar INLINE (bukan portal/fixed).
 * Aman di dalam Modal: klik pasti ke-handle, tidak diblok Dialog dismiss layer.
 * Hanya akun LEAF (postable) yang ditampilkan.
 */
import { computed, ref, watch, nextTick } from 'vue';
import { Search, ChevronsUpDown, Check, X, Sparkles } from 'lucide-vue-next';
import { cn } from '@/lib/utils';

interface Account {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  accountType: string;
  isActive: boolean;
}

interface HighlightPart {
  text: string;
  match: boolean;
}

const props = defineProps<{
  modelValue: string | null;
  accounts: Account[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  suggestedAccountId?: string | null;
}>();

const emit = defineEmits<{ 'update:modelValue': [string] }>();

const open = ref(false);
const query = ref('');
const focusedIdx = ref(-1);
const searchInput = ref<HTMLInputElement | null>(null);

const TYPE_LABEL: Record<string, string> = {
  asset: 'Aset',
  liability: 'Kewajiban',
  equity: 'Modal',
  income: 'Pendapatan',
  expense: 'Beban',
  contra_asset: 'Kontra Aset',
  contra_liability: 'Kontra Kewajiban',
};

const TYPE_COLOR: Record<string, string> = {
  asset: 'bg-blue-50 text-blue-700 border-blue-200',
  liability: 'bg-orange-50 text-orange-700 border-orange-200',
  equity: 'bg-violet-50 text-violet-700 border-violet-200',
  income: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  expense: 'bg-red-50 text-red-700 border-red-200',
  contra_asset: 'bg-sky-50 text-sky-700 border-sky-200',
  contra_liability: 'bg-amber-50 text-amber-700 border-amber-200',
};

/** Hanya leaf — head COA tidak postable. */
const postableAccounts = computed<Account[]>(() => {
  const parentIds = new Set(
    props.accounts.map((a) => a.parentId).filter((id): id is string => !!id),
  );
  return props.accounts
    .filter((a) => a.isActive !== false && !parentIds.has(a.id))
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
});

const accountById = computed(() => new Map(props.accounts.map((a) => [a.id, a])));

function parentPath(account: Account): string {
  const parts: string[] = [];
  let pid = account.parentId;
  let guard = 0;
  while (pid && guard++ < 6) {
    const p = accountById.value.get(pid);
    if (!p) break;
    parts.unshift(p.name);
    pid = p.parentId;
  }
  return parts.length ? parts.join(' › ') : '';
}

function scoreAccount(account: Account, q: string): number {
  const ql = q.toLowerCase();
  const code = account.code.toLowerCase();
  const name = account.name.toLowerCase();
  if (code === ql) return 100;
  if (name === ql) return 90;
  if (code.startsWith(ql)) return 80;
  if (name.startsWith(ql)) return 70;
  if (code.includes(ql)) return 60;
  if (name.includes(ql)) return 50;
  if (`${code} ${name}`.includes(ql)) return 40;
  return 0;
}

const suggested = computed<Account | null>(() => {
  if (!props.suggestedAccountId) return null;
  return postableAccounts.value.find((a) => a.id === props.suggestedAccountId) ?? null;
});

const filtered = computed<Account[]>(() => {
  const q = query.value.trim();
  if (!q) {
    const rest = postableAccounts.value.filter((a) => a.id !== props.suggestedAccountId);
    return suggested.value ? [suggested.value, ...rest] : postableAccounts.value;
  }
  return postableAccounts.value
    .map((a) => ({ account: a, score: scoreAccount(a, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.account);
});

const selected = computed<Account | null>(() => {
  if (!props.modelValue) return null;
  return props.accounts.find((a) => a.id === props.modelValue) ?? null;
});

function select(account: Account): void {
  emit('update:modelValue', account.id);
  open.value = false;
  query.value = '';
  focusedIdx.value = -1;
}

function toggle(): void {
  if (props.disabled) return;
  open.value = !open.value;
}

function close(): void {
  open.value = false;
  query.value = '';
  focusedIdx.value = -1;
}

watch(open, async (v) => {
  if (v) {
    query.value = '';
    focusedIdx.value = -1;
    await nextTick();
    searchInput.value?.focus();
  }
});

function onKeydown(e: KeyboardEvent): void {
  if (!open.value && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    open.value = true;
    return;
  }
  if (!open.value) return;
  const list = filtered.value;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    focusedIdx.value = Math.min(focusedIdx.value + 1, list.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    focusedIdx.value = Math.max(focusedIdx.value - 1, 0);
  } else if (e.key === 'Enter' && focusedIdx.value >= 0) {
    e.preventDefault();
    const account = list[focusedIdx.value];
    if (account) select(account);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    close();
  }
}

function highlightParts(text: string, q: string): HighlightPart[] {
  if (!q) return [{ text, match: false }];
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return [{ text, match: false }];
  return [
    { text: text.slice(0, idx), match: false },
    { text: text.slice(idx, idx + q.length), match: true },
    { text: text.slice(idx + q.length), match: false },
  ].filter((p) => p.text.length > 0);
}
</script>

<template>
  <div class="w-full">
    <!-- Trigger -->
    <button
      type="button"
      role="combobox"
      :aria-expanded="open"
      :disabled="disabled"
      :class="
        cn(
          'border-input bg-background hover:bg-muted/40 flex h-9 w-full items-center justify-between rounded-md border px-3 text-left text-sm shadow-xs transition-colors',
          'focus-visible:border-ring focus-visible:ring-ring/40 outline-none focus-visible:ring-2',
          !selected && 'text-muted-foreground',
          disabled && 'pointer-events-none opacity-50',
          open && 'border-ring ring-ring/30 ring-2',
        )
      "
      @click="toggle"
      @keydown="onKeydown"
    >
      <span v-if="selected" class="flex min-w-0 flex-1 items-center gap-2">
        <span class="shrink-0 font-mono text-[11px] leading-none text-muted-foreground">
          {{ selected.code }}
        </span>
        <span class="truncate">{{ selected.name }}</span>
      </span>
      <span v-else class="flex-1 truncate">{{ placeholder ?? 'Pilih akun…' }}</span>
      <ChevronsUpDown class="ml-1 size-3.5 shrink-0 opacity-40" />
    </button>

    <!-- Panel INLINE — di dalam DOM form, bukan portal -->
    <div
      v-if="open"
      class="bg-popover text-popover-foreground mt-1 flex max-h-56 flex-col overflow-hidden rounded-lg border border-border shadow-md"
      role="listbox"
    >
      <div class="flex shrink-0 items-center gap-2 border-b px-2.5 py-1.5">
        <Search class="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref="searchInput"
          v-model="query"
          class="min-w-0 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground/60"
          placeholder="Cari kode / nama…"
          autocomplete="off"
          @keydown="onKeydown"
          @click.stop
        />
        <button
          v-if="query"
          type="button"
          class="text-muted-foreground hover:text-foreground"
          tabindex="-1"
          @click="query = ''; searchInput?.focus()"
        >
          <X class="size-3.5" />
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto py-0.5">
        <div v-if="!query && suggested" class="px-2 pt-1">
          <p class="flex items-center gap-1 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles class="size-3 text-amber-500" />
            Disarankan
          </p>
        </div>

        <p
          v-if="filtered.length === 0"
          class="px-3 py-5 text-center text-xs text-muted-foreground"
        >
          {{
            postableAccounts.length === 0
              ? 'Belum ada akun leaf. Buat sub-akun di Bagan Akun.'
              : 'Tidak ketemu.'
          }}
        </p>

        <button
          v-for="(account, i) in filtered"
          :key="account.id"
          type="button"
          role="option"
          class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors"
          :class="
            focusedIdx === i || selected?.id === account.id
              ? 'bg-accent'
              : 'hover:bg-muted/70'
          "
          @click="select(account)"
          @mouseenter="focusedIdx = i"
        >
          <span class="w-14 shrink-0 font-mono text-[11px] text-muted-foreground">
            {{ account.code }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm">
              <template v-for="(part, pi) in highlightParts(account.name, query)" :key="pi">
                <mark
                  v-if="part.match"
                  class="rounded-[2px] bg-amber-100 px-px font-medium text-amber-900 not-italic"
                  >{{ part.text }}</mark
                >
                <span v-else>{{ part.text }}</span>
              </template>
            </span>
            <span
              v-if="parentPath(account)"
              class="block truncate text-[10px] text-muted-foreground/75"
            >
              {{ parentPath(account) }}
            </span>
          </span>
          <span
            class="shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-medium leading-none"
            :class="
              TYPE_COLOR[account.accountType] ?? 'border-border bg-muted text-muted-foreground'
            "
          >
            {{ TYPE_LABEL[account.accountType] ?? account.accountType }}
          </span>
          <Check
            v-if="selected?.id === account.id"
            class="size-3.5 shrink-0 text-primary"
          />
        </button>
      </div>
    </div>
  </div>
</template>
