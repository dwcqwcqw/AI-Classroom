/**
 * Run async work over `items` with at most `concurrency` tasks in flight.
 * Preserves result order (same index as `items`).
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  const results: R[] = new Array(items.length);
  let next = 0;

  const runWorker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}
