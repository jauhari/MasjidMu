<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { Search, ChevronsUpDown, Check, X, Sparkles } from 'lucide-vue-next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
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

const leafAccounts = computed<Account[]>(() => {
  const hasChildren = new Set(
    props.accounts.filter((a) => a.parentId).map((a) => a.parentId!),
  );
  return props.accounts.filter((a) => a.isActive !== false && !hasChildren.has(a.id));
});

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

  const fuzzy = fuzzyMatch(ql, `${code} ${name}`);
  return fuzzy > 0 ? 20 + fuzzy : 0;
}

function fuzzyMatch(pattern: string, str: string): number {
  let score = 0;
  let pi = 0;
  for (let si = 0; si < str.length && pi < pattern.length; si++) {
    if (str[si] === pattern[pi]) {
      score++;
      pi++;
    }
  }
  return pi === pattern.length ? score : 0;
}

const suggested = computed<Account | null>(() => {
  if (!props.suggestedAccountId) return null;
  return leafAccounts.value.find((a) => a.id === props.suggestedAccountId) ?? null;
});

const filtered = computed<Account[]>(() => {
  const q = query.value.trim();
  if (!q) {
    // No query: show suggested first, then the rest
    const rest = leafAccounts.value.filter((a) => a.id !== props.suggestedAccountId);
    return suggested.value ? [suggested.value, ...rest] : leafAccounts.value;
  }
  return leafAccounts.value
    .map((a) => ({ account: a, score: scoreAccount(a, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.account);
});

const selected = computed<Account | null>(
  () => leafAccounts.value.find((a) => a.id === props.modelValue) ?? null,
);

function select(account: Account): void {
  emit('update:modelValue', account.id);
  open.value = false;
  query.value = '';
  focusedIdx.value = -1;
}

watch(open, (v) => {
  if (v) {
    query.value = '';
    focusedIdx.value = -1;
    nextTick(() => searchInput.value?.focus());
  }
});

watch(query, () => {
  focusedIdx.value = -1;
});

function onKeydown(e: KeyboardEvent): void {
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
    open.value = false;
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
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        role="combobox"
        :disabled="disabled"
        :class="cn('w-full justify-between font-normal h-9 px-3', !selected && 'text-muted-foreground')"
      >
        <span v-if="selected" class="flex items-center gap-2 min-w-0 flex-1">
          <span class="font-mono text-[11px] text-muted-foreground shrink-0 leading-none">{{ selected.code }}</span>
          <span class="truncate text-sm">{{ selected.name }}</span>
        </span>
        <span v-else class="text-sm flex-1 text-left">{{ placeholder ?? '— Pilih akun —' }}</span>
        <ChevronsUpDown class="size-3.5 shrink-0 opacity-40 ml-1" />
      </Button>
    </PopoverTrigger>

    <PopoverContent
      class="w-80 p-0 overflow-hidden"
      align="start"
      :side-offset="4"
      :avoid-collisions="true"
    >
      <!-- Search bar -->
      <div class="flex items-center gap-2 border-b px-3 py-2">
        <Search class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          ref="searchInput"
          v-model="query"
          class="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/60 py-0.5"
          placeholder="Ketik kode atau nama akun…"
          autocomplete="off"
          @keydown="onKeydown"
        />
        <button
          v-if="query"
          class="text-muted-foreground hover:text-foreground transition-colors"
          tabindex="-1"
          @click="query = ''; searchInput?.focus()"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>

      <!-- Result list -->
      <div class="max-h-72 overflow-y-auto scroll-py-1 py-1">
        <!-- Suggested banner (only when no query and suggestion exists) -->
        <div v-if="!query && suggested" class="px-2 mb-1">
          <p class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-1.5 py-1">
            <Sparkles class="h-3 w-3 text-amber-500" />
            Disarankan dari kategori
          </p>
        </div>

        <!-- Empty -->
        <p v-if="filtered.length === 0" class="text-center text-sm text-muted-foreground py-8">
          Akun tidak ditemukan.
        </p>

        <!-- Items -->
        <template v-else>
          <div
            v-for="(account, i) in filtered"
            :key="account.id"
          >
            <!-- Divider after suggested item when no query -->
            <div
              v-if="!query && suggested && i === 1"
              class="mx-2 my-1 border-t"
            />
            <button
              class="w-full flex items-center gap-2 rounded-md mx-1 px-2 py-1.5 text-left transition-colors"
              :class="[
                focusedIdx === i ? 'bg-accent' : 'hover:bg-accent/60',
                selected?.id === account.id ? 'bg-accent' : '',
              ]"
              style="width: calc(100% - 0.5rem)"
              @click="select(account)"
              @mouseenter="focusedIdx = i"
            >
              <!-- Code -->
              <span class="font-mono text-[11px] text-muted-foreground w-12 shrink-0 leading-none">
                {{ account.code }}
              </span>
              <!-- Name with highlight -->
              <span class="flex-1 text-sm leading-snug min-w-0">
                <template v-for="(part, pi) in highlightParts(account.name, query)" :key="pi">
                  <mark
                    v-if="part.match"
                    class="bg-amber-100 text-amber-900 rounded-[2px] not-italic font-medium px-px"
                  >{{ part.text }}</mark>
                  <span v-else>{{ part.text }}</span>
                </template>
              </span>
              <!-- Type badge -->
              <span
                class="text-[9px] font-medium px-1.5 py-0.5 rounded border shrink-0 leading-none"
                :class="TYPE_COLOR[account.accountType] ?? 'bg-muted text-muted-foreground border-border'"
              >
                {{ TYPE_LABEL[account.accountType] ?? account.accountType }}
              </span>
              <!-- Check if selected -->
              <Check
                v-if="selected?.id === account.id"
                class="h-3.5 w-3.5 text-primary shrink-0"
              />
            </button>
          </div>
        </template>
      </div>

      <!-- Footer hint -->
      <div v-if="filtered.length > 0" class="border-t px-3 py-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
        <kbd class="rounded border border-border bg-muted px-1 py-px font-mono text-[9px]">↑↓</kbd>
        <span>navigasi</span>
        <kbd class="rounded border border-border bg-muted px-1 py-px font-mono text-[9px]">Enter</kbd>
        <span>pilih</span>
        <kbd class="rounded border border-border bg-muted px-1 py-px font-mono text-[9px]">Esc</kbd>
        <span>tutup</span>
      </div>
    </PopoverContent>
  </Popover>
</template>
