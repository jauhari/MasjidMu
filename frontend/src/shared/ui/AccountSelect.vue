<script setup lang="ts">
import { computed } from 'vue';
import { Check, ChevronsUpDown } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxAnchor,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxTrigger,
} from '@/components/ui/combobox';
import { cn } from '@/lib/utils';

interface Account {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  accountType?: string;
  isActive?: boolean;
}

interface FlatNode {
  id: string;
  code: string;
  name: string;
  depth: number;
  isHeader: boolean;
  label: string;
}

const props = defineProps<{
  modelValue: string | null;
  accounts: Account[];
  filterType?: string;
  placeholder?: string;
  includeInactive?: boolean;
  required?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [string] }>();

const flat = computed<FlatNode[]>(() => {
  const childrenOf = new Map<string | null, Account[]>();
  for (const a of props.accounts) {
    if (props.includeInactive !== true && a.isActive === false) continue;
    const k = a.parentId ?? null;
    if (!childrenOf.has(k)) childrenOf.set(k, []);
    childrenOf.get(k)!.push(a);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }

  const out: FlatNode[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const a of childrenOf.get(parentId) ?? []) {
      const grand = childrenOf.get(a.id) ?? [];
      const isHeader = grand.length > 0;
      const indent = depth === 0 ? '' : '\u00a0\u00a0'.repeat(depth) + '\u2514\u00a0';
      out.push({
        id: a.id,
        code: a.code,
        name: a.name,
        depth,
        isHeader,
        label: `${indent}${a.code} — ${a.name}`,
      });
      if (grand.length > 0) visit(a.id, depth + 1);
    }
  };
  visit(null, 0);

  if (props.filterType) {
    const byId = new Map(props.accounts.map((a) => [a.id, a]));
    const keep = new Set<string>();
    for (const a of props.accounts) {
      if (a.accountType !== props.filterType) continue;
      keep.add(a.id);
      let p = a.parentId;
      while (p) {
        if (keep.has(p)) break;
        keep.add(p);
        p = byId.get(p)?.parentId ?? null;
      }
    }
    return out.filter((n) => keep.has(n.id));
  }
  return out;
});

const selectable = computed(() => flat.value.filter((n) => !n.isHeader));

const selected = computed({
  get: () => selectable.value.find((n) => n.id === props.modelValue) ?? null,
  set: (v: FlatNode | null) => emit('update:modelValue', v?.id ?? ''),
});
</script>

<template>
  <Combobox v-model="selected" by="id" :disabled="disabled" :required="required">
    <ComboboxAnchor class="w-full">
      <ComboboxTrigger as-child>
        <Button
          variant="outline"
          role="combobox"
          :disabled="disabled"
          class="w-full justify-between font-normal"
        >
          <span :class="cn(!selected && 'text-muted-foreground')">
            {{ selected?.label ?? placeholder ?? '— Pilih akun —' }}
          </span>
          <ChevronsUpDown class="size-4 shrink-0 opacity-50" />
        </Button>
      </ComboboxTrigger>
      <ComboboxList class="max-h-56 w-[var(--reka-combobox-trigger-width)]" :avoid-collisions="false">
        <ComboboxInput placeholder="Cari kode atau nama akun…" />
        <ComboboxEmpty>Akun tidak ditemukan.</ComboboxEmpty>
        <ComboboxGroup>
          <ComboboxItem
            v-for="n in selectable"
            :key="n.id"
            :value="n"
            :text-value="`${n.code} ${n.name}`"
          >
            <ComboboxItemIndicator>
              <Check class="size-4" />
            </ComboboxItemIndicator>
            <span class="truncate">{{ n.label }}</span>
          </ComboboxItem>
        </ComboboxGroup>
      </ComboboxList>
    </ComboboxAnchor>
  </Combobox>
</template>