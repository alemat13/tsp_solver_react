import { SolveRequest } from '../types';

/**
 * Every itinerary variant (loop, fixed start, fixed end, open path…) is reduced to a single
 * canonical problem: find the cheapest Hamiltonian path from `source` to `sink` over a
 * (possibly augmented) cost matrix. Solvers only need to handle that one case.
 *
 * - Loop (no end, or end === start): the start node s (default 0) is duplicated into a copy s'
 *   with the same incoming costs; the path runs s -> ... -> s'.
 * - Open path with fixed end t and fixed start s: path s -> ... -> t, no augmentation.
 * - Open path with fixed end t and free start: a dummy node D with zero-cost arcs to every
 *   node is prepended; the path runs D -> ... -> t and D is dropped afterwards.
 *
 * Unused arcs (into the source, out of the sink) are set to 0: a valid path never uses them,
 * and keeping them finite avoids NaN in incremental cost computations.
 * Matrices may be asymmetric (real road networks): no symmetry is assumed anywhere.
 */
export interface PathProblem {
  /** Cost matrix over `size` nodes (original nodes first, then the optional extra node). */
  cost: number[][];
  size: number;
  source: number;
  sink: number;
  /** Whether the itinerary is a closed loop (result route ends at its start). */
  isLoop: boolean;
  /** Maps a canonical path (source..sink) back to original point indices. */
  toRoute: (path: number[]) => number[];
}

export const resolveEndpoints = (request: SolveRequest) => {
  const { points, startId, endId } = request;
  const idToIndex = new Map<string, number>();
  points.forEach((point, index) => idToIndex.set(point.id, index));
  const start = startId !== undefined ? idToIndex.get(startId) : undefined;
  const end = endId !== undefined ? idToIndex.get(endId) : undefined;
  const isLoop = end === undefined || (start !== undefined && start === end);
  return { start, end, isLoop };
};

/**
 * Picks the matrix to minimise and replaces unusable entries (null, NaN, Infinity: pairs the
 * routing service could not connect) by a large finite penalty, so every solver keeps working
 * and only uses such a leg when there is no alternative.
 */
export const objectiveMatrix = (request: SolveRequest): number[][] => {
  const { matrix, objective } = request;
  const source = objective === 'duration' && matrix.durations ? matrix.durations : matrix.distances;
  let maxFinite = 0;
  for (const row of source) {
    for (const value of row) {
      if (typeof value === 'number' && Number.isFinite(value) && value > maxFinite) maxFinite = value;
    }
  }
  const penalty = Math.max(1, maxFinite) * Math.max(10, source.length * 10);
  return source.map((row) => row.map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : penalty)));
};

export const usesDurationObjective = (request: SolveRequest) => request.objective === 'duration' && !!request.matrix.durations;

export const buildPathProblem = (request: SolveRequest): PathProblem => {
  const n = request.points.length;
  const d = objectiveMatrix(request);
  const { start, end, isLoop } = resolveEndpoints(request);

  if (isLoop) {
    const s = start ?? 0;
    const size = n + 1;
    const copy = n;
    const cost = Array.from({ length: size }, (_, i) =>
      Array.from({ length: size }, (_, j) => {
        if (i === copy) return 0;
        const from = i;
        const to = j === copy ? s : j;
        if (j === s) return 0; // never enter the source
        return from === to ? 0 : d[from][to];
      })
    );
    return {
      cost,
      size,
      source: s,
      sink: copy,
      isLoop: true,
      toRoute: (path) => path.map((node) => (node === copy ? s : node)),
    };
  }

  const t = end as number;
  if (start !== undefined) {
    const cost = d.map((row, i) => row.map((value, j) => (j === start || i === t || i === j ? 0 : value)));
    return { cost, size: n, source: start, sink: t, isLoop: false, toRoute: (path) => path.slice() };
  }

  const dummy = n;
  const size = n + 1;
  const cost = Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => {
      if (i === dummy || j === dummy || i === t || i === j) return 0;
      return d[i][j];
    })
  );
  return {
    cost,
    size,
    source: dummy,
    sink: t,
    isLoop: false,
    toRoute: (path) => path.filter((node) => node !== dummy),
  };
};

export const pathCost = (path: number[], cost: number[][]): number => {
  let total = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    total += cost[path[i]][path[i + 1]];
  }
  return total;
};
