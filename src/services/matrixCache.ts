import { CoordinatePoint, TravelMode } from '../types';
import { ApiCache, coordinateKey, PairValue } from './apiCache';

/**
 * Pair-level matrix caching shared by the routing providers.
 *
 * Matrices are cached cell by cell (ordered pair of coordinates + travel profile), so adding a
 * stop to a solved trip only requests the new row and column instead of the whole matrix, and
 * removing or reordering stops costs nothing.
 */

export interface MatrixBlock {
  sources: number[];
  destinations: number[];
}

export const pairKey = (profile: TravelMode, from: CoordinatePoint, to: CoordinatePoint) =>
  profile + '|' + coordinateKey(from.latitude, from.longitude) + '|' + coordinateKey(to.latitude, to.longitude);

/**
 * Chooses the requests that cover every missing cell. Picks a small set S of stops that touches
 * all missing pairs, then asks for S x all and (all \ S) x S. When S is large, a single full
 * matrix is cheaper and simpler.
 */
export const planMissingBlocks = (size: number, missing: boolean[][]): MatrixBlock[] => {
  const remaining = missing.map((row) => row.slice());
  const involvement = Array.from({ length: size }, (_, i) => {
    let count = 0;
    for (let j = 0; j < size; j += 1) {
      if (remaining[i][j]) count += 1;
      if (j !== i && remaining[j][i]) count += 1;
    }
    return count;
  });
  const selected: number[] = [];
  for (;;) {
    let best = -1;
    for (let i = 0; i < size; i += 1) if (involvement[i] > 0 && (best < 0 || involvement[i] > involvement[best])) best = i;
    if (best < 0) break;
    selected.push(best);
    for (let j = 0; j < size; j += 1) {
      if (remaining[best][j]) {
        remaining[best][j] = false;
        involvement[best] -= 1;
        if (j !== best) involvement[j] -= 1;
      }
      if (j !== best && remaining[j][best]) {
        remaining[j][best] = false;
        involvement[best] -= 1;
        involvement[j] -= 1;
      }
    }
  }
  if (selected.length === 0) return [];
  const all = Array.from({ length: size }, (_, i) => i);
  // Two blocks cost about 2|S|n cells against n² for the full matrix.
  if (selected.length * 2 >= size) return [{ sources: all, destinations: all }];
  const chosen = new Set(selected);
  const sorted = all.filter((i) => chosen.has(i));
  const others = all.filter((i) => !chosen.has(i));
  const blocks: MatrixBlock[] = [{ sources: sorted, destinations: all }];
  if (others.length > 0) blocks.push({ sources: others, destinations: sorted });
  return blocks;
};

export interface CachedMatrixState {
  distances: number[][];
  durations: (number | undefined)[][];
  keys: string[][];
  blocks: MatrixBlock[];
}

/** Fills the matrices from the cache and plans the requests for the remaining cells. */
export const readCachedMatrix = async (
  cache: ApiCache<PairValue>,
  profile: TravelMode,
  points: CoordinatePoint[]
): Promise<CachedMatrixState> => {
  const size = points.length;
  const keys = points.map((from) => points.map((to) => pairKey(profile, from, to)));
  const found = await cache.getMany(keys.flat());
  const distances = Array.from({ length: size }, () => new Array<number>(size).fill(Infinity));
  const durations = Array.from({ length: size }, () => new Array<number | undefined>(size).fill(undefined));
  const missing = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      if (i === j) {
        distances[i][j] = 0;
        durations[i][j] = 0;
        continue;
      }
      const value = found.get(keys[i][j]);
      if (!value) {
        missing[i][j] = true;
        continue;
      }
      distances[i][j] = value.d ?? Infinity;
      durations[i][j] = value.s ?? (value.d === null ? Infinity : undefined);
    }
  }
  return { distances, durations, keys, blocks: planMissingBlocks(size, missing) };
};

/** Splits a block so that each request holds at most `maxSources` sources and `maxDestinations` destinations. */
export const tileBlock = (block: MatrixBlock, maxSources: number, maxDestinations: number): MatrixBlock[] => {
  const tiles: MatrixBlock[] = [];
  for (let s = 0; s < block.sources.length; s += maxSources) {
    for (let d = 0; d < block.destinations.length; d += maxDestinations) {
      tiles.push({ sources: block.sources.slice(s, s + maxSources), destinations: block.destinations.slice(d, d + maxDestinations) });
    }
  }
  return tiles;
};
