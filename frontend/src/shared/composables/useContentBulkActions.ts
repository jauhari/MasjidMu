import type { Ref } from 'vue';
import { api } from '@/shared/api/client';
import { bulkErrorMessage, runBulk } from '@/shared/lib/bulk-actions';
import { toast } from '@/shared/lib/toast';
import { useBulkSelection } from './useBulkSelection';

type Item = { id: string };

export function useContentBulkActions(
  items: Ref<Item[]>,
  resourcePath: string,
  itemLabel: string,
  reload: () => Promise<void>,
) {
  const bulk = useBulkSelection(items);

  async function bulkPatch(patch: Record<string, unknown>): Promise<void> {
    if (bulk.selectedCount.value === 0) return;
    bulk.bulkActing.value = true;
    bulk.bulkError.value = null;
    const ids = [...bulk.selectedIds.value];
    const result = await runBulk(ids, (id) => api.patch(`${resourcePath}/${id}`, patch));
    bulk.clearSelection();
    await reload();
    bulk.bulkError.value = bulkErrorMessage(result, itemLabel);
    if (result.failed === 0) {
      toast.success(`${result.total} ${itemLabel} berhasil diperbarui`);
    }
    bulk.bulkActing.value = false;
  }

  async function bulkDelete(
    deleteOne?: (id: string) => Promise<void>,
  ): Promise<void> {
    if (bulk.selectedCount.value === 0) return;
    bulk.bulkActing.value = true;
    bulk.bulkError.value = null;
    const ids = [...bulk.selectedIds.value];
    const result = await runBulk(
      ids,
      deleteOne ?? ((id) => api.delete(`${resourcePath}/${id}`)),
    );
    bulk.clearSelection();
    await reload();
    bulk.bulkError.value = bulkErrorMessage(result, itemLabel);
    if (result.failed === 0) {
      toast.success(`${result.total} ${itemLabel} berhasil dihapus`);
    }
    bulk.bulkActing.value = false;
  }

  return {
    ...bulk,
    selectedItems: bulk.selectedItems,
    bulkPatch,
    bulkDelete,
  };
}