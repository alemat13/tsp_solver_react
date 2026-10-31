import { PathProblem } from './pathProblem';

/** Held-Karp is exact; above this many intermediate nodes memory/time grow too fast. */
export const HELD_KARP_MAX_INNER_NODES = 16;

/**
 * Exact shortest Hamiltonian path source -> sink by dynamic programming (Held-Karp, 1962).
 * O(2^m * m^2) time and O(2^m * m) memory with m = number of intermediate nodes.
 * Works with asymmetric matrices.
 */
export const solveHeldKarpPath = (problem: PathProblem): number[] => {
  const { cost, size, source, sink } = problem;
  const inner: number[] = [];
  for (let node = 0; node < size; node += 1) {
    if (node !== source && node !== sink) inner.push(node);
  }
  const m = inner.length;
  if (m === 0) return [source, sink];
  if (m > HELD_KARP_MAX_INNER_NODES) {
    throw new Error('Held-Karp is limited to ' + HELD_KARP_MAX_INNER_NODES + ' intermediate nodes.');
  }

  const full = 1 << m;
  // dp[mask * m + j]: cheapest path from source visiting exactly `mask`, ending at inner[j].
  const dp = new Float64Array(full * m).fill(Number.POSITIVE_INFINITY);
  const parent = new Int8Array(full * m).fill(-1);

  for (let j = 0; j < m; j += 1) {
    dp[(1 << j) * m + j] = cost[source][inner[j]];
  }

  for (let mask = 1; mask < full; mask += 1) {
    for (let j = 0; j < m; j += 1) {
      if (!(mask & (1 << j))) continue;
      const base = dp[mask * m + j];
      if (base === Number.POSITIVE_INFINITY) continue;
      const row = cost[inner[j]];
      for (let k = 0; k < m; k += 1) {
        if (mask & (1 << k)) continue;
        const nextMask = mask | (1 << k);
        const value = base + row[inner[k]];
        const index = nextMask * m + k;
        if (value < dp[index]) {
          dp[index] = value;
          parent[index] = j;
        }
      }
    }
  }

  const last = full - 1;
  let bestJ = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let j = 0; j < m; j += 1) {
    const value = dp[last * m + j] + cost[inner[j]][sink];
    if (value < best) {
      best = value;
      bestJ = j;
    }
  }

  const reversed: number[] = [sink];
  let mask = last;
  let j = bestJ;
  while (j !== -1) {
    reversed.push(inner[j]);
    const previous = parent[mask * m + j];
    mask &= ~(1 << j);
    j = previous;
  }
  reversed.push(source);
  return reversed.reverse();
};
