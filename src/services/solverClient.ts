import { loadHighs } from '../algorithms/highsLoader';
import { SolveOutcome, solveWithMode } from '../algorithms/solve';
import { SolveRequest, SolverMode } from '../types';

/**
 * Runs the solver in a Web Worker so the UI stays responsive. Falls back to the main thread
 * when workers are unavailable (tests, very old browsers).
 */
export interface SolverOptions {
  exactTimeLimitMs?: number;
}

export const solveInBackground = (mode: SolverMode, request: SolveRequest, options: SolverOptions = {}): Promise<SolveOutcome> => {
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
