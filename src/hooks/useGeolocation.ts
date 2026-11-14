import { useCallback, useEffect, useRef, useState } from 'react';

export interface UserPosition {
  latitude: number;
  longitude: number;
  /** Radius of the 95% confidence circle, in metres. */
  accuracy: number;
}

export type GeolocationStatus = 'off' | 'locating' | 'on' | 'error';

const OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 };

export const geolocationErrorMessage = (error: GeolocationPositionError | undefined): string => {
  if (!error) return 'Geolocation is not available on this device.';
  if (error.code === error.PERMISSION_DENIED) return 'Location access was denied. Allow it in your browser settings to use your position.';
  if (error.code === error.TIMEOUT) return 'Finding your location took too long. Try again.';
  return 'Your location is unavailable right now.';
};

/**
 * Follows the user's position once `start()` is called (watchPosition), so the map can show a live "you are here" dot.
 * `start()` resolves with the first fix, or rejects with a readable message.
 */
export const useGeolocation = () => {
  const [position, setPosition] = useState<UserPosition>();
  const [status, setStatus] = useState<GeolocationStatus>('off');
  const [error, setError] = useState<string>();
  const watchId = useRef<number>();
  const waiters = useRef<{ resolve: (position: UserPosition) => void; reject: (reason: Error) => void }[]>([]);
  const latest = useRef<UserPosition>();

  const settle = (result: UserPosition | Error) => {
    const pending = waiters.current;
    waiters.current = [];
    pending.forEach(({ resolve, reject }) => (result instanceof Error ? reject(result) : resolve(result)));
  };

  const stop = useCallback(() => {
    if (watchId.current !== undefined) navigator.geolocation?.clearWatch(watchId.current);
    watchId.current = undefined;
    latest.current = undefined;
    setPosition(undefined);
    setStatus('off');
  }, []);

  const start = useCallback((): Promise<UserPosition> => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      const message = geolocationErrorMessage(undefined);
      setStatus('error');
      setError(message);
      return Promise.reject(new Error(message));
    }
    if (watchId.current !== undefined && latest.current) return Promise.resolve(latest.current);

    const promise = new Promise<UserPosition>((resolve, reject) => waiters.current.push({ resolve, reject }));
    if (watchId.current === undefined) {
      setStatus('locating');
      setError(undefined);
      watchId.current = navigator.geolocation.watchPosition(
        ({ coords }) => {
          const next = { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy };
          latest.current = next;
          setPosition(next);
          setStatus('on');
          setError(undefined);
          settle(next);
        },
        (failure) => {
          const message = geolocationErrorMessage(failure);
          setError(message);
          settle(new Error(message));
          // Keep following after a transient error once we have had a fix; give up otherwise.
          if (latest.current && failure.code !== failure.PERMISSION_DENIED) return;
          if (watchId.current !== undefined) navigator.geolocation.clearWatch(watchId.current);
          watchId.current = undefined;
          latest.current = undefined;
          setPosition(undefined);
          setStatus('error');
        },
        OPTIONS
      );
    }
    return promise;
  }, []);

  useEffect(
    () => () => {
      if (watchId.current !== undefined) navigator.geolocation?.clearWatch(watchId.current);
    },
    []
  );

  return { position, status, error, start, stop, clearError: () => setError(undefined) };
};
