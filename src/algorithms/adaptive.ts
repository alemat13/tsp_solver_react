import { SolveRequest, SolveResult } from '../types';
import { solveBruteForce } from './bruteForce';
import { solveGenetic } from './genetic';
import { solveHeuristic } from './heuristic';

const BRUTE_FORCE_LIMIT = 9;
const GENETIC_ALGORITHM_LIMIT = 20;

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
  } else if (size > GENETIC_ALGORITHM_LIMIT) {
    // For very large datasets, we might want to implement a genetic algorithm in the future
    result = solveGenetic(request);
    notes.push('Genetic algorithm strategy selected for ' + size + ' locations.');
  } else {
    result = solveHeuristic(request);
    notes.push('Heuristic strategy selected for ' + size + ' locations.');
  }

  return {
    ...result,
    notes,
  };
};
