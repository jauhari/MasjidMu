export interface BulkRunResult {
  failed: number;
  total: number;
  firstError: string;
}

export async function runBulk(
  ids: string[],
  fn: (id: string) => Promise<void>,
): Promise<BulkRunResult> {
  let failed = 0;
  let firstError = '';
  for (const id of ids) {
    try {
      await fn(id);
    } catch (err) {
      failed++;
      if (!firstError) {
        const e = err as { body?: { error?: string; detail?: string } };
        firstError = e.body?.detail ?? e.body?.error ?? (err as Error).message;
      }
    }
  }
  return { failed, total: ids.length, firstError };
}

export function bulkErrorMessage(result: BulkRunResult, label: string): string | null {
  if (result.failed === 0) return null;
  const tail = result.firstError ? ` — ${result.firstError}` : '';
  return `${result.failed} dari ${result.total} ${label} gagal diproses${tail}`;
}