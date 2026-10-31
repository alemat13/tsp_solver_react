import { SolveRequest, SolveResult, SolverMode } from '../types';
import { solveAdaptiveTsp } from './adaptive';
import { solveBruteForce } from './bruteForce';
import { EXACT_POINT_LIMIT, solveExact } from './exact';
import { solveGenetic } from './genetic';
import { solveHeuristic } from './heuristic';

export interface SolveOutcome {
  result: SolveResult;
  notes: string[];
}

/** Single entry point used by the UI (directly or through the Web Worker). */
export const solveWithMode = (mode: SolverMode, request: SolveRequest): SolveOutcome => {
  switch (mode) {
    case 'brute-force':
      return { result: solveBruteForce(request), notes: ['Brute force strategy selected explicitly by the user.'] };
    case 'exact': {
      if (request.points.length > EXACT_POINT_LIMIT) {
        const fallback = solveHeuristic(request);
        return {
          result: { ...fallback, warnings: fallback.warnings.concat(['Exact solver is limited to ' + EXACT_POINT_LIMIT + ' points; heuristic used instead.']) },
          notes: ['Heuristic strategy used: too many points for the exact solver.'],
        };
      }
      return { result: solveExact(request), notes: ['Exact (Held-Karp) strategy selected explicitly by the user.'] };
    }
    case 'heuristic':
      return { result: solveHeuristic(request), notes: ['Heuristic strategy selected explicitly by the user.'] };
    case 'genetic':
      return { result: solveGenetic(request), notes: ['Genetic strategy selected explicitly by the user.'] };
    default: {
      const { notes, ...result } = solveAdaptiveTsp(request);
      return { result, notes };
    }
  }
};
