import { vi } from 'vitest';
import { ApiCache, clearApiCache, countApiCacheEntries } from '../apiCache';
import { planMissingBlocks } from '../matrixCache';

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('ApiCache', () => {
  it('persists entries to IndexedDB and reloads them after a page reload', async () => {
    const cache = new ApiCache<number>('test-persist', { ttlMs: 60_000, persist: true });
    await cache.setMany([['a', 1], ['b', 2]]);
    await settle();
    cache.resetMemory(); // simulates a reload: memory is empty, IndexedDB is not
    expect(await cache.get('a')).toBe(1);
    expect((await cache.getMany(['a', 'b', 'c'])).size).toBe(2);
  });

  it('keeps memory-only namespaces out of IndexedDB', async () => {
    const cache = new ApiCache<number>('test-memory', { ttlMs: 60_000, persist: false });
    await cache.set('a', 1);
    expect(await cache.get('a')).toBe(1);
    await settle();
    cache.resetMemory();
    expect(await cache.get('a')).toBeUndefined();
  });

  it('expires entries after their TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const cache = new ApiCache<number>('test-ttl', { ttlMs: 1_000, persist: false });
      await cache.set('a', 1);
      vi.setSystemTime(Date.now() + 2_000);
      expect(await cache.get('a')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the oldest entries beyond maxEntries', async () => {
    const cache = new ApiCache<number>('test-max', { ttlMs: 60_000, persist: false, maxEntries: 2 });
    await cache.setMany([['a', 1], ['b', 2], ['c', 3]]);
    expect(await cache.get('a')).toBeUndefined();
    expect(await cache.get('c')).toBe(3);
  });

  it('clears everything', async () => {
    const cache = new ApiCache<number>('test-clear', { ttlMs: 60_000, persist: true });
    await cache.set('a', 1);
    await settle();
    expect(await countApiCacheEntries()).toBeGreaterThan(0);
    await clearApiCache();
    expect(await cache.get('a')).toBeUndefined();
  });
});

describe('planMissingBlocks', () => {
  const grid = (n: number, missing: (i: number, j: number) => boolean) =>
    Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i !== j && missing(i, j)));

  it('requests nothing when every cell is cached', () => {
    expect(planMissingBlocks(5, grid(5, () => false))).toEqual([]);
  });

  it('requests the full matrix when nothing is cached', () => {
    expect(planMissingBlocks(4, grid(4, () => true))).toEqual([{ sources: [0, 1, 2, 3], destinations: [0, 1, 2, 3] }]);
  });

  it('requests only the row and column of a new stop', () => {
    const blocks = planMissingBlocks(10, grid(10, (i, j) => i === 7 || j === 7));
    expect(blocks).toEqual([
      { sources: [7], destinations: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
      { sources: [0, 1, 2, 3, 4, 5, 6, 8, 9], destinations: [7] },
    ]);
  });
});
