import { SolveRequest, SolveResult } from '../types';
import { computeTotals, deriveResult } from './common';
import { HELD_KARP_MAX_INNER_NODES, solveHeldKarpPath } from './heldKarp';
import { buildPathProblem } from './pathProblem';

/** Largest number of points for which the exact solver is guaranteed to be fast. */
export const EXACT_POINT_LIMIT = HELD_KARP_MAX_INNER_NODES + 1;

/** Exact solver (Held-Karp dynamic programming). Optimal for every itinerary variant. */
export const solveExact = (request: SolveRequest): SolveResult => {
  const { points, matrix } = request;
  if (points.length < 2) {
    return {
      orderedPoints: points,
      orderedIds: points.map((point) => point.id),
      totalDistance: 0,
      totalDuration: 0,
      strategy: 'exact',
      warnings: ['Provide at least two locations to optimise an itinerary.'],
    };
  }
  const problem = buildPathProblem(request);
  const route = problem.toRoute(solveHeldKarpPath(problem));
  return deriveResult(points, route, computeTotals(route, matrix.distances, matrix.durations), 'exact', []);
};
