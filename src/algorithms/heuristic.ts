import { SolveRequest, SolveResult } from '../types';
import { computeTotals, deriveResult } from './common';
import { iteratedLocalSearch, IteratedLocalSearchOptions } from './localSearch';
import { buildPathProblem } from './pathProblem';

/**
 * Heuristic solver: nearest neighbour + iterated local search (2-opt, Or-opt, double-bridge).
 * Supports loops, fixed start and/or end, and asymmetric matrices.
 */
export const solveHeuristic = (request: SolveRequest, options: IteratedLocalSearchOptions = {}): SolveResult => {
  const { points, matrix } = request;
  if (points.length < 2) {
    return {
      orderedPoints: points,
      orderedIds: points.map((point) => point.id),
      totalDistance: 0,
      totalDuration: 0,
      strategy: 'heuristic',
      warnings: ['Provide at least two locations to optimise an itinerary.'],
    };
  }

  const problem = buildPathProblem(request);
  const route = problem.toRoute(iteratedLocalSearch(problem, options));
  const warnings = problem.isLoop && request.startId !== undefined && request.startId === request.endId
    ? ['Start and end points are identical; treating itinerary as a loop.']
    : [];
  return deriveResult(points, route, computeTotals(route, matrix.distances, matrix.durations), 'heuristic', warnings);
};
