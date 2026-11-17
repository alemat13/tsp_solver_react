import { loadHighs } from '../algorithms/highsLoader';
import { SolveOutcome, solveWithMode } from '../algorithms/solve';
import { SolveRequest, SolverMode } from '../types';
import { logError, logInfo } from './diagnostics';

/**
 * Runs the solver in a Web Worker so the UI stays responsive. Falls back to the main thread
 * when workers are unavailable (tests, very old browsers).
 */
export interface SolverOptions {
  exactTimeLimitMs?: number;
}

/** Solves, logging the problem size, the time taken and the outcome. */
export const solveInBackground = async (mode: SolverMode, request: SolveRequest, options: SolverOptions = {}): Promise<SolveOutcome> => {
  const { matrix, points } = request;
  const unreachable = matrix.distances.reduce((sum, row, i) => sum + row.filter((value, j) => i !== j && !Number.isFinite(value)).length, 0);
  logInfo('solver', 'Solving ' + points.length + ' stops, mode ' + mode, {
    objective: request.objective ?? 'distance',
    provider: matrix.provider,
    hasDurations: Boolean(matrix.durations),
    unreachablePairs: unreachable,
    start: request.startId ? points.findIndex((point) => point.id === request.startId) : null,
    end: request.endId ? points.findIndex((point) => point.id === request.endId) : null,
    timeLimitMs: options.exactTimeLimitMs,
    worker: typeof Worker !== 'undefined',
  });
  const started = performance.now();
  try {
    const outcome = await runSolver(mode, request, options);
    const { result, notes } = outcome;
    logInfo('solver', 'Solved in ' + Math.round(performance.now() - started) + ' ms with ' + result.strategy, {
      distance: Math.round(result.totalDistance),
      duration: result.totalDuration !== undefined ? Math.round(result.totalDuration) : undefined,
      objective: result.objectiveValue,
      lowerBound: result.lowerBound,
      provenOptimal: result.provenOptimal,
      order: result.orderedIds.map((id) => points.findIndex((point) => point.id === id)),
      notes,
      warnings: result.warnings,
    });
    return outcome;
  } catch (error) {
    logError('solver', 'Solver failed after ' + Math.round(performance.now() - started) + ' ms: ' + (error instanceof Error ? error.message : String(error)));
    throw error;
  }
};

const runSolver = (mode: SolverMode, request: SolveRequest, options: SolverOptions): Promise<SolveOutcome> => {
  if (typeof Worker === 'undefined') {
    return solveWithMode(mode, request, { loadHighs, ...options });
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/solver.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      worker.terminate();
      if (event.data.ok) resolve(event.data.outcome as SolveOutcome);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'Solver worker failed.'));
    };
    worker.postMessage({ mode, request, options });
  });
};
