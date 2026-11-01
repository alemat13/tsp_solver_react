import { SolveRequest, SolveResult } from '../types';
import { EXACT_POINT_LIMIT, solveExact } from './exact';
import { solveHeuristic } from './heuristic';

export interface AdaptiveOutcome extends SolveResult {
  notes: string[];
}

/**
 * Exact Held-Karp up to EXACT_POINT_LIMIT points (optimal, well under a second),
 * iterated local search above (near-optimal in milliseconds to a second).
 */
export const solveAdaptiveTsp = (request: SolveRequest): AdaptiveOutcome => {
  const size = request.points.length;
  if (size <= EXACT_POINT_LIMIT) {
    return { ...solveExact(request), notes: ['Exact (Held-Karp) strategy selected for ' + size + ' locations: the route is optimal.'] };
  }
  return {
    ...solveHeuristic(request),
    notes: ['Heuristic strategy (iterated local search) selected for ' + size + ' locations.'],
  };
};
