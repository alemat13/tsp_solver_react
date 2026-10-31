import type { HighsLike } from './branchAndCut';

let highsPromise: Promise<HighsLike> | undefined;

/**
 * Lazily loads HiGHS (~3.5 MB of WebAssembly) the first time the exact solver needs it, so the
 * main bundle stays small. The .wasm file is bundled by Vite and served next to the app.
 */
export const loadHighs = (): Promise<HighsLike> => {
  if (!highsPromise) {
    highsPromise = Promise.all([import('highs'), import('highs/runtime?url')])
      .then(([module, wasm]) => module.default({ locateFile: () => wasm.default }))
      .then((instance) => instance as unknown as HighsLike)
      .catch((error) => {
        highsPromise = undefined;
        throw error;
      });
  }
  return highsPromise;
};
