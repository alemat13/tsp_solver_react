/// <reference lib="webworker" />
import { solveWithMode } from '../algorithms/solve';
import { SolveRequest, SolverMode } from '../types';

interface SolveMessage {
  mode: SolverMode;
  request: SolveRequest;
}

self.onmessage = (event: MessageEvent<SolveMessage>) => {
  try {
    const outcome = solveWithMode(event.data.mode, event.data.request);
    self.postMessage({ ok: true, outcome });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
