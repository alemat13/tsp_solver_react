import { PathProblem, pathCost } from './pathProblem';

const EPSILON = 1e-9;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Small deterministic PRNG (mulberry32) so results are reproducible for a given seed. */
export const createRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Nearest-neighbour construction from the source, always finishing on the sink. */
export const nearestNeighbourPath = (problem: PathProblem): number[] => {
  const { cost, size, source, sink } = problem;
  const visited = new Uint8Array(size);
  visited[source] = 1;
  visited[sink] = 1;
  const path = [source];
  for (let step = 0; step < size - 2; step += 1) {
    const current = path[path.length - 1];
    let best = -1;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let node = 0; node < size; node += 1) {
      if (!visited[node] && cost[current][node] < bestCost) {
        bestCost = cost[current][node];
        best = node;
      }
    }
    visited[best] = 1;
    path.push(best);
  }
  path.push(sink);
  return path;
};

/**
 * Local search on a path whose two ends are fixed: 2-opt (segment reversal) and Or-opt
 * (moving a segment of 1-3 nodes elsewhere, optionally reversed). Deltas are computed in O(1)
 * with prefix sums of forward and backward costs, so asymmetric matrices are handled exactly.
 * Returns a new path; the input is not modified.
 */
export const improvePath = (input: number[], cost: number[][]): number[] => {
  let path = input.slice();
  const length = path.length;
  if (length < 4) return path;

  const forward = new Float64Array(length);
  const backward = new Float64Array(length);
  const refreshPrefixes = () => {
    for (let p = 1; p < length; p += 1) {
      forward[p] = forward[p - 1] + cost[path[p - 1]][path[p]];
      backward[p] = backward[p - 1] + cost[path[p]][path[p - 1]];
    }
  };
  // Cost change of reversing the internal arcs of path[i..k].
  const reversalDelta = (i: number, k: number) => backward[k] - backward[i] - (forward[k] - forward[i]);

  refreshPrefixes();
  let improved = true;
  while (improved) {
    improved = false;

    // 2-opt: reverse path[i..k].
    for (let i = 1; i < length - 2 && !improved; i += 1) {
      const a = path[i - 1];
      const first = path[i];
      for (let k = i + 1; k < length - 1; k += 1) {
        const last = path[k];
        const b = path[k + 1];
        const delta = cost[a][last] + cost[first][b] - cost[a][first] - cost[last][b] + reversalDelta(i, k);
        if (delta < -EPSILON) {
          path = path.slice(0, i).concat(path.slice(i, k + 1).reverse(), path.slice(k + 1));
          refreshPrefixes();
          improved = true;
          break;
        }
      }
    }
    if (improved) continue;

    // Or-opt: move path[i..e] (1 to 3 nodes) between path[j] and path[j + 1].
    for (let segmentLength = 1; segmentLength <= 3 && !improved; segmentLength += 1) {
      for (let i = 1; i + segmentLength - 1 < length - 1 && !improved; i += 1) {
        const e = i + segmentLength - 1;
        const first = path[i];
        const last = path[e];
        const previous = path[i - 1];
        const next = path[e + 1];
        const removalGain = cost[previous][first] + cost[last][next] - cost[previous][next];
        const internalReversal = reversalDelta(i, e);
        for (let j = 0; j < length - 1; j += 1) {
          if (j >= i - 1 && j <= e) continue;
          const left = path[j];
          const right = path[j + 1];
          const base = cost[left][right];
          const insertForward = cost[left][first] + cost[last][right] - base;
          const insertReversed = cost[left][last] + cost[first][right] - base + internalReversal;
          const reverse = insertReversed < insertForward;
          const delta = Math.min(insertForward, insertReversed) - removalGain;
          if (delta < -EPSILON) {
            const segment = path.slice(i, e + 1);
            if (reverse) segment.reverse();
            const rest = path.slice(0, i).concat(path.slice(e + 1));
            const insertAt = j < i ? j + 1 : j + 1 - segmentLength;
            path = rest.slice(0, insertAt).concat(segment, rest.slice(insertAt));
            refreshPrefixes();
            improved = true;
            break;
          }
        }
      }
    }
  }
  return path;
};

/** Double-bridge kick on the inner nodes (keeps both ends fixed, no reversal needed). */
const perturb = (path: number[], random: () => number): number[] => {
  const innerLength = path.length - 2;
  if (innerLength < 4) {
    const result = path.slice();
    const i = 1 + Math.floor(random() * innerLength);
    const k = 1 + Math.floor(random() * innerLength);
    [result[i], result[k]] = [result[k], result[i]];
    return result;
  }
  const cuts = new Set<number>();
  while (cuts.size < 3) cuts.add(2 + Math.floor(random() * (innerLength - 1)));
  const [p1, p2, p3] = Array.from(cuts).sort((x, y) => x - y);
  return path
    .slice(0, p1)
    .concat(path.slice(p2, p3), path.slice(p1, p2), path.slice(p3));
};

export interface IteratedLocalSearchOptions {
  timeLimitMs?: number;
  maxIterations?: number;
  seed?: number;
  initialPath?: number[];
}

/**
 * Iterated local search: 2-opt + Or-opt descent, then repeated double-bridge kicks followed by
 * a new descent, keeping the best path. Typically within ~1% of optimal on itinerary sizes.
 */
export const iteratedLocalSearch = (problem: PathProblem, options: IteratedLocalSearchOptions = {}): number[] => {
  const { cost } = problem;
  const timeLimitMs = options.timeLimitMs ?? 1000;
  const maxIterations = options.maxIterations ?? Math.max(200, 50 * problem.size);
  const random = createRandom(options.seed ?? 12345);
  const deadline = now() + timeLimitMs;

  let best = improvePath(options.initialPath ?? nearestNeighbourPath(problem), cost);
  let bestCost = pathCost(best, cost);
  if (problem.size <= 4) return best;

  for (let iteration = 0; iteration < maxIterations && now() < deadline; iteration += 1) {
    const candidate = improvePath(perturb(best, random), cost);
    const candidateCost = pathCost(candidate, cost);
    if (candidateCost < bestCost - EPSILON) {
      best = candidate;
      bestCost = candidateCost;
    }
  }
  return best;
};
