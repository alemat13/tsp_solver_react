/// <reference lib="webworker" />
import { loadHighs } from '../algorithms/highsLoader';
import { solveWithMode } from '../algorithms/solve';
import { SolveRequest, SolverMode } from '../types';

interface SolveMessage {
  mode: SolverMode;
  request: SolveRequest;
  options?: { exactTimeLimitMs?: number };
}

self.onmessage = async (event: MessageEvent<SolveMessage>) => {
  try {
    const outcome = await solveWithMode(event.data.mode, event.data.request, {
      loadHighs,
      ...event.data.options,
      // Lets the page show this route if it has to stop the exact search early.
      onIncumbent: (incumbent) => self.postMessage({ incumbent }),
    });
    self.postMessage({ ok: true, outcome });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
