import { loadHighs } from '../algorithms/highsLoader';
import { SolveOutcome, solveWithMode } from '../algorithms/solve';
import { SolveRequest, SolverMode } from '../types';
import { abortError } from '../utils/async';

export interface SolverOptions {
  exactTimeLimitMs?: number;
  /** Stops the solver (the user cancelled). The promise then rejects with an AbortError. */
  signal?: AbortSignal;
}

/** Default time budget of branch-and-cut (see solveWithMode). */
const DEFAULT_TIME_LIMIT_MS = 15_000;
/**
 * Extra time allowed on top of the solver's own time limit (loading HiGHS, building the
 * model, a last LP solve that overruns) before the page gives up on the worker.
 */
export const WATCHDOG_GRACE_MS = 30_000;
/** Heuristic modes finish in about a second: past this, something is wrong. */
const HEURISTIC_WATCHDOG_MS = 30_000;

/** How long the page waits for a worker before stopping it, or undefined for no limit. */
export const watchdogDelay = (mode: SolverMode, options: SolverOptions): number | undefined => {
  if (mode === 'brute-force') return undefined; // explicitly accepted by the user, and cancellable
  if (mode === 'heuristic' || mode === 'genetic') return HEURISTIC_WATCHDOG_MS;
  return (options.exactTimeLimitMs ?? DEFAULT_TIME_LIMIT_MS) + WATCHDOG_GRACE_MS;
};

type WorkerAnswer = { kind: 'done'; outcome: SolveOutcome } | { kind: 'timeout'; incumbent?: SolveOutcome };

const runWorker = (mode: SolverMode, request: SolveRequest, options: SolverOptions, delay: number | undefined) =>
  new Promise<WorkerAnswer>((resolve, reject) => {
    const { signal, ...workerOptions } = options;
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const worker = new Worker(new URL('../workers/solver.worker.ts', import.meta.url), { type: 'module' });
    let incumbent: SolveOutcome | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      worker.terminate();
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      finish();
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort);
    if (delay !== undefined) {
      timer = setTimeout(() => {
        finish();
        resolve({ kind: 'timeout', incumbent });
      }, delay);
    }
    worker.onmessage = (event) => {
      if (event.data.incumbent) {
        incumbent = event.data.incumbent as SolveOutcome;
        return;
      }
      finish();
      if (event.data.ok) resolve({ kind: 'done', outcome: event.data.outcome as SolveOutcome });
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || 'Solver worker failed.'));
    };
    worker.postMessage({ mode, request, options: workerOptions });
  });

const withWarning = (outcome: SolveOutcome, warning: string): SolveOutcome => ({
  ...outcome,
  result: { ...outcome.result, warnings: [warning, ...outcome.result.warnings] },
});

/**
 * Runs the solver in a Web Worker so the UI stays responsive, and makes sure it always ends:
 * a worker that overruns its time limit is stopped, and the best route it had found (or a quick
 * heuristic route) is returned instead. Falls back to the main thread when workers are
 * unavailable (tests, very old browsers).
 */
export const solveInBackground = async (mode: SolverMode, request: SolveRequest, options: SolverOptions = {}): Promise<SolveOutcome> => {
  if (typeof Worker === 'undefined') {
    const { signal, ...context } = options;
    if (signal?.aborted) throw abortError();
    return solveWithMode(mode, request, { loadHighs, ...context });
  }

  const delay = watchdogDelay(mode, options);
  const first = await runWorker(mode, request, options, delay);
  if (first.kind === 'done') return first.outcome;

  const seconds = Math.round((delay ?? 0) / 1000);
  if (first.incumbent) {
    return withWarning(first.incumbent, 'The solver did not finish within ' + seconds + ' s and was stopped; showing the best route found so far.');
  }
  if (mode !== 'heuristic') {
    const second = await runWorker('heuristic', request, options, HEURISTIC_WATCHDOG_MS);
    if (second.kind === 'done') {
      return withWarning(second.outcome, 'The ' + mode + ' solver did not finish within ' + seconds + ' s and was stopped; showing a heuristic route instead.');
    }
  }
  throw new Error('The solver did not finish within ' + seconds + ' s and was stopped. Try fewer stops or another solver in Settings.');
};
