/**
 * Client-side cache for routing API responses, to avoid paying twice for the same data.
 *
 * Every namespace keeps its entries in memory; persistent namespaces are also written to
 * IndexedDB so they survive a page reload. Persistence is best-effort: without IndexedDB
 * (private mode, tests, old browsers) the cache simply lives for the session.
 *
 * Google Maps Platform terms (Service Specific Terms, Routes API: "Caching") only allow
 * latitude/longitude values to be cached, for at most 30 consecutive days. So Google route
 * geometry may be persisted for up to 30 days, but Google distances and durations are kept in
 * memory only, for the current page session. OpenRouteService and Nominatim data come from
 * OpenStreetMap (ODbL) and may be stored; Nominatim's usage policy even asks clients to cache.
 */

import type { TransitLeg } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CacheOptions {
  /** Entries older than this are ignored and purged. */
  ttlMs: number;
  /** Store in IndexedDB as well as in memory. */
  persist: boolean;
  /** Maximum number of entries kept; the oldest are dropped first. */
  maxEntries?: number;
}

interface StoredEntry<T> {
  /** Namespace. */
  n: string;
  /** Key within the namespace. */
  k: string;
  /** Value. */
  v: T;
  /** Time stored (ms since epoch). */
  t: number;
}

const DB_NAME = 'tsp-solver-api-cache';
const STORE = 'entries';
const DEFAULT_MAX_ENTRIES = 200_000;

let dbPromise: Promise<IDBDatabase | undefined> | undefined;

const openDatabase = (): Promise<IDBDatabase | undefined> => {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') {
          resolve(undefined);
          return;
        }
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore(STORE);
          store.createIndex('namespace', 'n');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(undefined);
        request.onblocked = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }
  return dbPromise;
};

const storageKey = (namespace: string, key: string) => namespace + '\u0000' + key;

const requestToPromise = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const transactionDone = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

const caches: ApiCache<unknown>[] = [];

export class ApiCache<T> {
  private readonly memory = new Map<string, { v: T; t: number }>();
  private loaded: Promise<void> | undefined;
  private pendingWrites = new Map<string, StoredEntry<T>>();
  private flushScheduled = false;

  constructor(readonly namespace: string, readonly options: CacheOptions) {
    caches.push(this as ApiCache<unknown>);
  }

  private isFresh(storedAt: number, now = Date.now()) {
    return now - storedAt < this.options.ttlMs && storedAt <= now;
  }

  /** Loads the persisted entries of this namespace once, purging expired ones. */
  private load(): Promise<void> {
    if (!this.options.persist) return Promise.resolve();
    if (!this.loaded) {
      this.loaded = (async () => {
        const db = await openDatabase();
        if (!db) return;
        try {
          const transaction = db.transaction(STORE, 'readwrite');
          const store = transaction.objectStore(STORE);
          const range = IDBKeyRange.only(this.namespace);
          const entries = (await requestToPromise(store.index('namespace').getAll(range))) as StoredEntry<T>[];
          const now = Date.now();
          const fresh = entries.filter((entry) => this.isFresh(entry.t, now)).sort((a, b) => a.t - b.t);
          const limit = this.options.maxEntries ?? DEFAULT_MAX_ENTRIES;
          const keep = fresh.slice(Math.max(0, fresh.length - limit));
          const keepKeys = new Set(keep.map((entry) => entry.k));
          for (const entry of entries) {
            if (!keepKeys.has(entry.k)) store.delete(storageKey(this.namespace, entry.k));
          }
          for (const entry of keep) {
            // Entries written during this session take precedence over older stored ones.
            if (!this.memory.has(entry.k)) this.memory.set(entry.k, { v: entry.v, t: entry.t });
          }
          await transactionDone(transaction);
        } catch {
          // A broken store only costs us the cache.
        }
      })();
    }
    return this.loaded;
  }

  async get(key: string): Promise<T | undefined> {
    await this.load();
    const entry = this.memory.get(key);
    if (!entry) return undefined;
    if (!this.isFresh(entry.t)) {
      this.memory.delete(key);
      return undefined;
    }
    return entry.v;
  }

  /** Looks up several keys at once; missing or expired keys are absent from the result. */
  async getMany(keys: string[]): Promise<Map<string, T>> {
    await this.load();
    const now = Date.now();
    const found = new Map<string, T>();
    for (const key of keys) {
      const entry = this.memory.get(key);
      if (entry && this.isFresh(entry.t, now)) found.set(key, entry.v);
    }
    return found;
  }

  async set(key: string, value: T): Promise<void> {
    await this.setMany([[key, value]]);
  }

  async setMany(entries: [string, T][]): Promise<void> {
    await this.load();
    const t = Date.now();
    for (const [key, value] of entries) {
      this.memory.delete(key); // keep Map insertion order = age order
      this.memory.set(key, { v: value, t });
      if (this.options.persist) this.pendingWrites.set(key, { n: this.namespace, k: key, v: value, t });
    }
    const limit = this.options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    while (this.memory.size > limit) {
      const oldest = this.memory.keys().next().value as string;
      this.memory.delete(oldest);
    }
    this.scheduleFlush();
  }

  /** Writes are batched into one IndexedDB transaction per tick. */
  private scheduleFlush() {
    if (!this.options.persist || this.flushScheduled || this.pendingWrites.size === 0) return;
    this.flushScheduled = true;
    setTimeout(() => {
      this.flushScheduled = false;
      void this.flush();
    }, 0);
  }

  async flush(): Promise<void> {
    if (this.pendingWrites.size === 0) return;
    const writes = [...this.pendingWrites.values()];
    this.pendingWrites = new Map();
    const db = await openDatabase();
    if (!db) return;
    try {
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      for (const entry of writes) store.put(entry, storageKey(this.namespace, entry.k));
      await transactionDone(transaction);
    } catch {
      // Quota exceeded or store unavailable: keep working from memory.
    }
  }

  get size(): number {
    return this.memory.size;
  }

  async count(): Promise<number> {
    await this.load();
    const now = Date.now();
    let total = 0;
    for (const entry of this.memory.values()) if (this.isFresh(entry.t, now)) total += 1;
    return total;
  }

  /** Drops the in-memory entries only (persisted entries are reloaded on next use). */
  resetMemory() {
    this.memory.clear();
    this.pendingWrites.clear();
    this.loaded = undefined;
  }
}

/** Removes every cached API response, in memory and in IndexedDB. */
export const clearApiCache = async (): Promise<void> => {
  for (const cache of caches) {
    cache.resetMemory();
  }
  const db = await openDatabase();
  if (!db) return;
  try {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).clear();
    await transactionDone(transaction);
  } catch {
    // ignore
  }
};

/** Number of cached responses (pairs of stops count as one entry each). */
export const countApiCacheEntries = async (): Promise<number> => {
  const counts = await Promise.all(caches.map((cache) => cache.count()));
  return counts.reduce((sum, count) => sum + count, 0);
};

/** Stable key for a coordinate (~10 cm precision). */
export const coordinateKey = (latitude: number, longitude: number) => latitude.toFixed(6) + ',' + longitude.toFixed(6);

// --- Caches used by the services ---------------------------------------------------------

export interface PairValue {
  /** Metres; null = no route between the two stops. */
  d: number | null;
  /** Seconds; null = unknown or no route. */
  s: number | null;
}

/** OpenRouteService matrix cells, per travel profile and ordered pair of coordinates. */
export const orsMatrixCache = new ApiCache<PairValue>('ors-matrix', { ttlMs: 30 * DAY_MS, persist: true });
/** OpenRouteService directions geometry, per itinerary chunk. */
export const orsDirectionsCache = new ApiCache<[number, number][]>('ors-directions', { ttlMs: 30 * DAY_MS, persist: true, maxEntries: 2_000 });
/** Address search results (ORS / Nominatim). */
export const geocodeCache = new ApiCache<unknown>('geocode', { ttlMs: 30 * DAY_MS, persist: true, maxEntries: 5_000 });

/** Google transit matrix cells: memory only (the Google terms do not allow storing them). */
export const googleMatrixCache = new ApiCache<PairValue>('google-matrix', { ttlMs: 6 * 60 * 60 * 1000, persist: false });
/** Google transit leg polylines (lat/lng only): persisted for at most 30 days, as the terms allow. */
export const googleLegCache = new ApiCache<string | null>('google-legs', { ttlMs: 30 * DAY_MS - 60 * 60 * 1000, persist: true, maxEntries: 5_000 });
/**
 * Google transit directions per leg (lines, stops, times): memory only, as the Google terms do not
 * allow storing them, and short-lived because the departure times are for "leaving now".
 */
export const googleTransitLegCache = new ApiCache<TransitLeg | null>('google-transit-legs', {
  ttlMs: 10 * 60 * 1000,
  persist: false,
  maxEntries: 2_000,
});
