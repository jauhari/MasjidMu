import { computed, ref, type Ref } from 'vue';

export function useBulkSelection<T extends { id: string }>(items: Ref<T[]>) {
  const selectedIds = ref(new Set<string>());
  const bulkActing = ref(false);
  const bulkError = ref<string | null>(null);

  const selectedCount = computed(() => selectedIds.value.size);

  const selectedItems = computed(() => items.value.filter((i) => selectedIds.value.has(i.id)));

  const isAllSelected = computed(
    () => items.value.length > 0 && items.value.every((i) => selectedIds.value.has(i.id)),
  );

  function toggleSelectAll(): void {
    if (isAllSelected.value) selectedIds.value = new Set();
    else selectedIds.value = new Set(items.value.map((i) => i.id));
  }

  function toggleSelect(id: string): void {
    const next = new Set(selectedIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds.value = next;
  }

  function isSelected(id: string): boolean {
    return selectedIds.value.has(id);
  }

  function clearSelection(): void {
    selectedIds.value = new Set();
    bulkError.value = null;
  }

  return {
    selectedIds,
    bulkActing,
    bulkError,
    selectedCount,
    selectedItems,
    isAllSelected,
    toggleSelectAll,
    toggleSelect,
    isSelected,
    clearSelection,
  };
}