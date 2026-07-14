<script setup lang="ts">
/**
 * Picker akun induk COA. Inline panel supaya aman di dalam Modal.
 * Menampilkan seluruh akun aktif, bukan hanya leaf.
 */
import { computed, nextTick, ref, watch } from 'vue';
import { Check, ChevronsUpDown, Search, X } from 'lucide-vue-next';
import { cn } from '@/lib/utils';

interface Account {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  accountType: string;
  isActive: boolean;
}

interface AccountOption {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  depth: number;
  path: string;
  isRoot?: boolean;
}

const props = defineProps<{
  modelValue: string | null | undefined;
  accounts: Account[];
  placeholder?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [string] }>();

const open = ref(false);
const query = ref('');
const focusedIdx = ref(-1);
const searchInput = ref<HTMLInputElement | null>(null);

const rootOption: AccountOption = {
  id: '',
  parentId: null,
  code: 'Root',
  name: 'Tidak ada induk',
  depth: 0,
  path: 'Root',
  isRoot: true,
};

const accountById = computed(() => new Map(props.accounts.map((a) => [a.id, a])));

function pathFor(account: Account): string {
  const parts = [account.name];
  let pid = account.parentId;
  let guard = 0;
  while (pid && guard++ < 8) {
    const parent = accountById.value.get(pid);
    if (!parent) break;
    parts.unshift(parent.name);
    pid = parent.parentId;
  }
  return parts.join(' › ');
}

const options = computed<AccountOption[]>(() => {
  const active = props.accounts
    .filter((a) => a.isActive !== false)
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  const children = new Map<string, Account[]>();
  const byId = new Map(active.map((a) => [a.id, a]));
  const roots: Account[] = [];

  for (const account of active) {
    if (account.parentId && byId.has(account.parentId)) {
      const list = children.get(account.parentId) ?? [];
      list.push(account);
      children.set(account.parentId, list);
    } else {
      roots.push(account);
    }
  }

  const out: AccountOption[] = [];
  function walk(nodes: Account[], depth: number): void {
    for (const account of nodes) {
      out.push({
        id: account.id,
        parentId: account.parentId,
        code: account.code,
        name: account.name,
        depth,
        path: pathFor(account),
      });
      walk(children.get(account.id) ?? [], depth + 1);
    }
  }
  walk(roots, 0);
  return out;
});

const selected = computed<AccountOption>(() => {
  if (!props.modelValue) return rootOption;
  return options.value.find((opt) => opt.id === props.modelValue) ?? rootOption;
});

function score(option: AccountOption, raw: string): number {
  const q = raw.toLowerCase();
  const code = option.code.toLowerCase();
  const name = option.name.toLowerCase();
  const path = option.path.toLowerCase();
  if (code === q) return 100;
  if (name === q) return 90;
  if (code.startsWith(q)) return 80;
  if (name.startsWith(q)) return 70;
  if (code.includes(q)) return 60;
  if (name.includes(q)) return 50;
  if (path.includes(q)) return 40;
  return 0;
}

const filtered = computed<AccountOption[]>(() => {
  const q = query.value.trim();
  if (!q) return [rootOption, ...options.value];
  const matched = options.value
    .map((option) => ({ option, score: score(option, q) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.option.code.localeCompare(b.option.code, undefined, { numeric: true }))
    .map((item) => item.option);
  return [rootOption, ...matched];
});

function select(option: AccountOption): void {
  emit('update:modelValue', option.id);
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

watch(open, async (value) => {
  if (!value) return;
  query.value = '';
  focusedIdx.value = 0;
  await nextTick();
  searchInput.value?.focus();
});

function onKeydown(event: KeyboardEvent): void {
  if (!open.value && (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    open.value = true;
    return;
  }
  if (!open.value) return;

  const list = filtered.value;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    focusedIdx.value = Math.min(focusedIdx.value + 1, list.length - 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    focusedIdx.value = Math.max(focusedIdx.value - 1, 0);
  } else if (event.key === 'Enter' && focusedIdx.value >= 0) {
    event.preventDefault();
    const option = list[focusedIdx.value];
    if (option) select(option);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    close();
  }
}

function depthBars(depth: number): number[] {
  return Array.from({ length: Math.min(depth, 4) }, (_, i) => i);
}
</script>

<template>
  <div class="relative w-full">
    <button
      type="button"
      role="combobox"
      :aria-expanded="open"
      :disabled="disabled"
      :class="
        cn(
          'border-input bg-card hover:bg-muted/30 flex h-10 w-full items-center justify-between gap-3 rounded-lg border px-3 text-left text-sm shadow-sm transition-colors',
          'focus-visible:border-ring focus-visible:ring-ring/40 outline-none focus-visible:ring-2',
          disabled && 'pointer-events-none opacity-50',
          open && 'border-ring ring-ring/30 ring-2',
        )
      "
      @click="toggle"
      @keydown="onKeydown"
    >
      <span
        class="shrink-0 rounded-md border bg-muted/60 px-2 py-1 font-mono text-[11px] leading-none text-muted-foreground"
        :class="selected.isRoot && 'font-sans'"
      >
        {{ selected.code }}
      </span>
      <span
        class="min-w-0 flex-1 truncate text-right"
        :class="selected.isRoot ? 'text-muted-foreground' : 'font-medium text-foreground'"
      >
        {{ selected.name || placeholder || 'Pilih akun induk' }}
      </span>
      <ChevronsUpDown class="size-3.5 shrink-0 text-muted-foreground" />
    </button>

    <div
      v-if="open"
      class="bg-popover text-popover-foreground absolute left-0 right-0 top-full z-50 mt-1 flex max-h-72 flex-col overflow-hidden rounded-xl border border-border p-1 shadow-xl"
      role="listbox"
    >
      <div class="flex shrink-0 items-center gap-2 border-b px-2.5 py-2">
        <Search class="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref="searchInput"
          v-model="query"
          class="min-w-0 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground/60"
          placeholder="Cari kode atau nama akun"
          autocomplete="off"
          @keydown="onKeydown"
          @click.stop
        />
        <button
          v-if="query"
          type="button"
          class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          tabindex="-1"
          @click="query = ''; searchInput?.focus()"
        >
          <X class="size-3.5" />
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto py-1">
        <p
          v-if="filtered.length <= 1 && options.length === 0"
          class="px-3 py-5 text-center text-xs text-muted-foreground"
        >
          Akun COA belum termuat. Pastikan backend aktif, lalu muat ulang halaman.
        </p>
        <p
          v-else-if="filtered.length <= 1"
          class="px-3 py-5 text-center text-xs text-muted-foreground"
        >
          Tidak ada akun yang cocok.
        </p>

        <button
          v-for="(option, index) in filtered"
          :key="option.id || 'root'"
          type="button"
          role="option"
          class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors"
          :class="
            focusedIdx === index || selected.id === option.id
              ? 'bg-emerald-50/90'
              : option.depth === 0 && !option.isRoot
                ? 'bg-muted/25 hover:bg-muted/50'
                : 'hover:bg-muted/60'
          "
          @click="select(option)"
          @mouseenter="focusedIdx = index"
        >
          <span
            class="w-[4.75rem] shrink-0 rounded-md border bg-background px-2 py-1 text-left font-mono text-[11px] leading-none tabular-nums text-slate-600"
            :class="option.isRoot && 'border-emerald-200 bg-emerald-50 font-sans text-emerald-700'"
          >
            {{ option.code }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="flex min-w-0 items-center justify-end gap-1.5">
              <span
                v-if="option.depth > 0"
                class="hidden shrink-0 items-center gap-1 sm:inline-flex"
                aria-hidden="true"
              >
                <span
                  v-for="bar in depthBars(option.depth)"
                  :key="bar"
                  class="h-px w-2 rounded-full bg-border"
                />
              </span>
              <span
                class="min-w-0 truncate text-right text-sm"
                :class="option.isRoot ? 'text-emerald-700' : option.depth === 0 ? 'font-semibold text-foreground' : 'text-foreground'"
              >
                {{ option.name }}
              </span>
            </span>
            <span
              v-if="query && !option.isRoot && option.path !== option.name"
              class="block truncate text-right text-[10px] text-muted-foreground/75"
            >
              {{ option.path }}
            </span>
          </span>
          <Check v-if="selected.id === option.id" class="size-3.5 shrink-0 text-emerald-700" />
        </button>
      </div>
    </div>
  </div>
</template>
