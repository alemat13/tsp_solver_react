import { act, renderHook } from '@testing-library/react';
import { useGeolocation } from '../useGeolocation';

type Success = (position: { coords: { latitude: number; longitude: number; accuracy: number } }) => void;
type Failure = (error: { code: number; PERMISSION_DENIED: number; TIMEOUT: number }) => void;

const mockGeolocation = () => {
  const handlers: { success?: Success; failure?: Failure } = {};
  const geolocation = {
    watchPosition: vi.fn((success: Success, failure: Failure) => {
      handlers.success = success;
      handlers.failure = failure;
      return 7;
    }),
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn(),
  };
  Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true });
  return { geolocation, handlers };
};

describe('useGeolocation', () => {
  it('resolves with the first fix and keeps following the position', async () => {
    const { geolocation, handlers } = mockGeolocation();
    const { result } = renderHook(() => useGeolocation());

    let first: Promise<unknown>;
    act(() => {
      first = result.current.start();
    });
    expect(result.current.status).toBe('locating');
    act(() => handlers.success?.({ coords: { latitude: 48.85, longitude: 2.35, accuracy: 12 } }));
    await expect(first!).resolves.toEqual({ latitude: 48.85, longitude: 2.35, accuracy: 12 });
    expect(result.current.status).toBe('on');

    act(() => handlers.success?.({ coords: { latitude: 48.86, longitude: 2.36, accuracy: 8 } }));
    expect(result.current.position).toEqual({ latitude: 48.86, longitude: 2.36, accuracy: 8 });

    // A second start reuses the running watch.
    await expect(result.current.start()).resolves.toEqual({ latitude: 48.86, longitude: 2.36, accuracy: 8 });
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1);
  });

  it('reports a denied permission', async () => {
    const { geolocation, handlers } = mockGeolocation();
    const { result } = renderHook(() => useGeolocation());
    let attempt: Promise<unknown>;
    act(() => {
      attempt = result.current.start();
    });
    act(() => handlers.failure?.({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 }));
    await expect(attempt!).rejects.toThrow(/denied/);
    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/denied/);
    expect(geolocation.clearWatch).toHaveBeenCalledWith(7);
  });
});
