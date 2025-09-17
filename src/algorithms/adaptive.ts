import { SolveRequest, SolveResult } from '../types';
import { solveBruteForce } from './bruteForce';
import { solveHeuristic } from './heuristic';

const BRUTE_FORCE_LIMIT = 9;

export interface AdaptiveOutcome extends SolveResult {
  notes: string[];
}

export const solveAdaptiveTsp = (request: SolveRequest): AdaptiveOutcome => {
  const size = request.points.length;
  const notes: string[] = [];

  let result: SolveResult;
  if (size <= BRUTE_FORCE_LIMIT) {
    result = solveBruteForce(request);
    notes.push('Brute force strategy selected for ' + size + ' locations.');
  } else {
    result = solveHeuristic(request);
    notes.push('Heuristic strategy selected for ' + size + ' locations.');
  }

  return {
    ...result,
    notes,
  };
};
