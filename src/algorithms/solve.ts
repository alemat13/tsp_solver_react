import { SolveRequest, SolveResult, SolverMode } from '../types';
import { solveBruteForce } from './bruteForce';
import { HighsLike, solveBranchAndCut } from './branchAndCut';
import { computeTotals, deriveResult } from './common';
import { EXACT_POINT_LIMIT, solveExact } from './exact';
import { solveGenetic } from './genetic';
import { solveHeuristic } from './heuristic';
import { iteratedLocalSearch } from './localSearch';
import { buildPathProblem } from './pathProblem';

export interface SolveOutcome {
  result: SolveResult;
  notes: string[];
}

export interface SolveContext {
  /** Provides the HiGHS LP/MIP engine for the branch-and-cut solver. */
  loadHighs?: () => Promise<HighsLike>;
  /** Time budget for branch-and-cut in explicit "exact" mode. */
  exactTimeLimitMs?: number;
  /** Time budget for branch-and-cut in automatic mode. */
  autoTimeLimitMs?: number;
}

/** In automatic mode, branch-and-cut is attempted up to this many points. */
export const AUTO_BRANCH_AND_CUT_LIMIT = 80;

const percent = (value: number) => (value * 100).toFixed(2) + '%';

const runBranchAndCut = async (request: SolveRequest, context: SolveContext, timeLimitMs: number): Promise<SolveOutcome> => {
  const problem = buildPathProblem(request);
  const initialPath = iteratedLocalSearch(problem, { timeLimitMs: 500 });
  const heuristicRoute = problem.toRoute(initialPath);
  const { matrix, points } = request;

  let highs: HighsLike | undefined;
  try {
    highs = context.loadHighs ? await context.loadHighs() : undefined;
  } catch {
    highs = undefined;
  }
  if (!highs) {
    const result = deriveResult(points, heuristicRoute, computeTotals(heuristicRoute, matrix.distances, matrix.durations), 'heuristic', [
      'The exact solver engine (HiGHS) could not be loaded; heuristic route returned.',
    ]);
    return { result, notes: ['Heuristic strategy used: exact solver unavailable.'] };
  }

  const outcome = solveBranchAndCut(problem, highs, { timeLimitMs, initialPath });
  const route = problem.toRoute(outcome.path);
  const totals = computeTotals(route, matrix.distances, matrix.durations);
  const gap = outcome.cost > 0 ? (outcome.cost - outcome.lowerBound) / outcome.cost : 0;
  const result: SolveResult = {
    ...deriveResult(points, route, totals, outcome.provenOptimal ? 'exact' : 'heuristic', []),
    lowerBound: outcome.lowerBound,
    provenOptimal: outcome.provenOptimal,
  };
  const notes = outcome.provenOptimal
    ? ['Exact branch-and-cut (HiGHS) proved this route optimal (' + outcome.cuts + ' cuts).']
    : ['Branch-and-cut stopped at the time limit: route is at most ' + percent(gap) + ' above the optimum.'];
  return { result, notes };
};

/** Single entry point used by the UI (through the Web Worker) and by tests. */
export const solveWithMode = async (mode: SolverMode, request: SolveRequest, context: SolveContext = {}): Promise<SolveOutcome> => {
  const size = request.points.length;
  switch (mode) {
    case 'brute-force':
      return { result: solveBruteForce(request), notes: ['Brute force strategy selected explicitly by the user.'] };
    case 'heuristic':
      return { result: solveHeuristic(request), notes: ['Heuristic strategy selected explicitly by the user.'] };
    case 'genetic':
      return { result: solveGenetic(request), notes: ['Genetic strategy selected explicitly by the user.'] };
    case 'exact':
      if (size <= EXACT_POINT_LIMIT) {
        return { result: { ...solveExact(request), provenOptimal: true }, notes: ['Exact (Held-Karp) strategy: the route is optimal.'] };
      }
      return runBranchAndCut(request, context, context.exactTimeLimitMs ?? 60000);
    default:
      if (size <= EXACT_POINT_LIMIT) {
        return {
          result: { ...solveExact(request), provenOptimal: true },
          notes: ['Exact (Held-Karp) strategy selected for ' + size + ' locations: the route is optimal.'],
        };
      }
      if (size <= AUTO_BRANCH_AND_CUT_LIMIT) {
        return runBranchAndCut(request, context, context.autoTimeLimitMs ?? 15000);
      }
      return {
        result: solveHeuristic(request),
        notes: ['Heuristic strategy (iterated local search) selected for ' + size + ' locations.'],
      };
  }
};
