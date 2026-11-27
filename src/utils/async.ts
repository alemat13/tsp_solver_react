/** Helpers that make sure no network request or background task can keep the app waiting forever. */

/** Error raised when an operation is abandoned because it took too long. */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/** Error raised when the user cancels an operation. */
export const abortError = () => {
  const error = new Error('Cancelled.');
  error.name = 'AbortError';
  return error;
};

export const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError';

export const isTimeoutError = (error: unknown) =>
  error instanceof Error && (error.name === 'TimeoutError' || error instanceof TimeoutError);

/**
 * A signal that aborts after `ms` milliseconds, or as soon as `parent` aborts (user cancel).
 * `timedOut()` tells the two cases apart; call `dispose()` once the request is over.
 */
export const timeoutSignal = (ms: number, parent?: AbortSignal) => {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, ms);
  const onParentAbort = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener('abort', onParentAbort);
  return {
    signal: controller.signal,
    timedOut: () => expired,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    },
  };
};

/** Resolves like `promise`, but rejects with a TimeoutError after `ms` milliseconds. */
export const withTimeout = <T>(promise: Promise<T>, ms: number, message: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
