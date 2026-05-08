import { describe, test, expect, vi } from 'vitest';
import { runWithConcurrency } from '@/lib/utils/concurrency';

describe('runWithConcurrency', () => {
  test('returns empty array for empty input', async () => {
    expect(await runWithConcurrency([], 3, async () => 1)).toEqual([]);
  });

  test('preserves order with concurrency 2', async () => {
    const delays = [30, 5, 20, 5];
    const fn = vi.fn(async (ms: number, i: number) => {
      await new Promise((r) => setTimeout(r, ms));
      return i * 10;
    });
    const out = await runWithConcurrency(delays, 2, (ms, i) => fn(ms, i));
    expect(out).toEqual([0, 10, 20, 30]);
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
