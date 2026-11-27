import { vi } from 'vitest';
import { fetchMatrix, fetchRouteGeometry, ORS_MATRIX_TIMEOUT_MS } from '../openRouteService';

globalThis.fetch = vi.fn();
const mockFetch = () => globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
const points = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, label: 'P' + i, latitude: 48.8 + i / 1000, longitude: 2.3 }));

describe('OpenRouteService', () => {
  beforeEach(() => {
    mockFetch().mockReset();
  });

  it('splits matrices above 3500 cells into blocks of source rows', async () => {
    mockFetch().mockImplementation(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      const all = body.locations.map((_: unknown, i: number) => i);
      const rows: number[] = body.sources ?? all;
      const columns: number[] = body.destinations ?? all;
      const row = (i: number) => columns.map((j) => i * 1000 + j);
      return { ok: true, json: async () => ({ distances: rows.map(row), durations: rows.map(row) }) };
    });
    const result = await fetchMatrix({ apiKey: 'k', profile: 'driving-car', points: points(100) });
    expect(mockFetch()).toHaveBeenCalledTimes(3); // 35 rows per request
    expect(result.data.provider).toBe('openrouteservice');
    expect(result.data.distances).toHaveLength(100);
    expect(result.data.distances[99][7]).toBe(99007);
    expect(result.data.durations?.[50][2]).toBe(50002);
  });

  const hangingFetch = async (_url: string, init: { signal: AbortSignal }) =>
    new Promise((_, reject) => {
      if (init.signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });

  it('falls back to straight lines when the matrix request never answers', async () => {
    vi.useFakeTimers();
    try {
      mockFetch().mockImplementation(hangingFetch);
      const pending = fetchMatrix({ apiKey: 'k', profile: 'driving-car', points: points(4).map((p, i) => ({ ...p, id: 'hang' + i, latitude: 10 + i })) });
      await vi.advanceTimersByTimeAsync(ORS_MATRIX_TIMEOUT_MS + 10);
      const result = await pending;
      expect(result.data.provider).toBe('haversine');
      expect(result.error).toMatch(/did not answer/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects with an AbortError when the user cancels', async () => {
    mockFetch().mockImplementation(hangingFetch);
    const controller = new AbortController();
    const pending = fetchMatrix({ apiKey: 'k', profile: 'driving-car', points: points(4).map((p, i) => ({ ...p, id: 'cancel' + i, latitude: 20 + i })), signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stitches directions for itineraries longer than 50 stops', async () => {
    mockFetch().mockImplementation(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ routes: [{ geometry: body.coordinates }] }) };
    });
    const result = await fetchRouteGeometry({ apiKey: 'k', profile: 'driving-car', points: points(60) });
    expect(mockFetch()).toHaveBeenCalledTimes(2);
    expect(result.coordinates).toHaveLength(60);
  });

  const unroutable = (index: number) => ({
    ok: false,
    status: 404,
    text: async () =>
      JSON.stringify({ error: { code: 2010, message: 'Could not find routable point within a radius of 350.0 meters of specified coordinate ' + index + ': 5.4433692 43.2131160.' } }),
  });

  it('retries an off-road stop with a wider snapping radius', async () => {
    mockFetch().mockImplementation(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      if (!body.radiuses) return unroutable(2);
      return { ok: true, json: async () => ({ routes: [{ geometry: body.coordinates }] }) };
    });
    const result = await fetchRouteGeometry({ apiKey: 'k', profile: 'driving-car', points: points(5).map((p) => ({ ...p, latitude: p.latitude + 1 })) });
    expect(mockFetch()).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mockFetch().mock.calls[1][1].body).radiuses).toEqual([350, 350, 2000, 350, 350]);
    expect(result.coordinates).toHaveLength(5);
    expect(result.warnings).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it('draws only the legs around an unroutable stop as straight lines', async () => {
    const stops = points(6).map((p) => ({ ...p, latitude: p.latitude + 2 }));
    const offRoad = stops[3];
    mockFetch().mockImplementation(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      const index = body.coordinates.findIndex((c: number[]) => c[1] === offRoad.latitude);
      if (index >= 0) return unroutable(index);
      // Road geometry: one extra vertex per leg.
      const geometry = body.coordinates.flatMap((c: number[], i: number) => (i === 0 ? [c] : [[c[0] + 0.001, c[1]], c]));
      return { ok: true, json: async () => ({ routes: [{ geometry }] }) };
    });
    const result = await fetchRouteGeometry({ apiKey: 'k', profile: 'foot-walking', points: stops });
    // Full request, radius retry, then stops 0-2 and 4-5 on roads.
    expect(mockFetch()).toHaveBeenCalledTimes(4);
    expect(result.coordinates).toHaveLength(5 + 1 + 3);
    expect(result.coordinates[5]).toEqual([offRoad.latitude, offRoad.longitude]);
    expect(result.warnings).toEqual([
      'No road found near stop “P3” for this travel mode, so the legs to and from it are drawn as straight lines.',
    ]);
    expect(result.error).toBeUndefined();
  });

  it('splits the itinerary when the ORS proxy fails with HTTP 500', async () => {
    const stops = points(8).map((p) => ({ ...p, latitude: p.latitude + 4 }));
    const broken = [stops[5], stops[6]].map((p) => p.latitude);
    mockFetch().mockImplementation(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      const lats = body.coordinates.map((c: number[]) => c[1]);
      // Fails for any request that contains the leg 5 -> 6.
      if (lats.some((lat: number, i: number) => lat === broken[0] && lats[i + 1] === broken[1])) {
        return { ok: false, status: 500, text: async () => JSON.stringify({ error: 'There was a problem proxying the request' }) };
      }
      return { ok: true, json: async () => ({ routes: [{ geometry: body.coordinates }] }) };
    });
    const result = await fetchRouteGeometry({ apiKey: 'k', profile: 'driving-car', points: stops });
    expect(result.warnings).toEqual(['No detailed route between “P5” and “P6”, so that leg is drawn as a straight line.']);
    expect(result.error).toBe('OpenRouteService directions failed (HTTP 500): There was a problem proxying the request');
    // Every stop is still on the line, in order.
    const lats = result.coordinates.map((c) => c[0]);
    expect(stops.every((s) => lats.includes(s.latitude))).toBe(true);
    expect(mockFetch().mock.calls.length).toBeLessThanOrEqual(30);
  });

  it('gives up after two requests when ORS is down', async () => {
    mockFetch().mockResolvedValue({ ok: false, status: 500, text: async () => JSON.stringify({ error: 'There was a problem proxying the request' }) });
    const stops = points(22).map((p) => ({ ...p, latitude: p.latitude + 5 }));
    const result = await fetchRouteGeometry({ apiKey: 'k', profile: 'driving-car', points: stops });
    expect(mockFetch()).toHaveBeenCalledTimes(2);
    expect(result.coordinates).toHaveLength(22);
    expect(result.warnings).toEqual(['OpenRouteService is not answering right now, so the route is drawn as straight lines. Try again later.']);
  });

  it('gives up after two timeouts', async () => {
    mockFetch().mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const stops = points(6).map((p) => ({ ...p, latitude: p.latitude + 6 }));
    const result = await fetchRouteGeometry({ apiKey: 'k', profile: 'driving-car', points: stops });
    expect(mockFetch()).toHaveBeenCalledTimes(2);
    expect(result.coordinates).toHaveLength(6);
  });

  it('turns other ORS errors into a readable message', async () => {
    mockFetch().mockResolvedValue({ ok: false, status: 403, text: async () => JSON.stringify({ error: 'Access to this API has been disallowed' }) });
    const result = await fetchRouteGeometry({ apiKey: 'k', profile: 'driving-car', points: points(3).map((p) => ({ ...p, latitude: p.latitude + 3 })) });
    expect(result.coordinates).toHaveLength(3);
    expect(result.error).toBe('OpenRouteService directions failed (HTTP 403): Access to this API has been disallowed');
  });

  it('keeps the closing leg of a loop', async () => {
    const loop = [...points(3), points(3)[0]];
    mockFetch().mockImplementation(async (_url: string, init: { body: string }) => ({
      ok: true,
      json: async () => ({ routes: [{ geometry: JSON.parse(init.body).coordinates, segments: [] }] }),
    }));
    const result = await fetchRouteGeometry({ apiKey: 'k', profile: 'driving-car', points: loop });
    expect(result.coordinates).toHaveLength(4);
  });
});

describe('OpenRouteService caching', () => {
  const answerMatrix = () =>
    mockFetch().mockImplementation(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      const all = body.locations.map((_: unknown, i: number) => i);
      const rows: number[] = body.sources ?? all;
      const columns: number[] = body.destinations ?? all;
      // Values depend on the coordinates, not on the indices, so cached cells can be checked.
      const value = (i: number, j: number) => Math.round(Math.abs(body.locations[i][1] - body.locations[j][1]) * 1e6);
      return { ok: true, json: async () => ({ distances: rows.map((i) => columns.map((j) => value(i, j))), durations: rows.map((i) => columns.map((j) => value(i, j) / 10)) }) };
    });

  beforeEach(() => {
    mockFetch().mockReset();
    answerMatrix();
  });

  it('does not call the API again for the same stops', async () => {
    const first = await fetchMatrix({ apiKey: 'k', profile: 'driving-car', points: points(5) });
    const second = await fetchMatrix({ apiKey: 'k', profile: 'driving-car', points: points(5).reverse() });
    expect(mockFetch()).toHaveBeenCalledTimes(1);
    expect(second.data.distances[0][4]).toBe(first.data.distances[4][0]);
    expect(second.data.durations?.[0][4]).toBe(first.data.durations?.[4][0]);
  });

  it('only requests the row and column of an added stop', async () => {
    await fetchMatrix({ apiKey: 'k', profile: 'driving-car', points: points(10) });
    mockFetch().mockClear();
    const more = points(11);
    const result = await fetchMatrix({ apiKey: 'k', profile: 'driving-car', points: more });
    expect(mockFetch()).toHaveBeenCalledTimes(2);
    const bodies = mockFetch().mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies[0].sources).toEqual([10]);
    expect(bodies[0].destinations).toBeUndefined();
    expect(bodies[1].destinations).toEqual([10]);
    expect(result.data.distances[10][3]).toBe(Math.round((more[10].latitude - more[3].latitude) * 1e6));
    expect(result.data.distances[3][10]).toBe(result.data.distances[10][3]);
  });

  it('keeps profiles apart', async () => {
    await fetchMatrix({ apiKey: 'k', profile: 'driving-car', points: points(3) });
    await fetchMatrix({ apiKey: 'k', profile: 'foot-walking', points: points(3) });
    expect(mockFetch()).toHaveBeenCalledTimes(2);
  });

  it('does not cache failed requests', async () => {
    mockFetch().mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'quota' });
    const failed = await fetchMatrix({ apiKey: 'k', profile: 'driving-car', points: points(3) });
    expect(failed.data.provider).toBe('haversine');
    const retried = await fetchMatrix({ apiKey: 'k', profile: 'driving-car', points: points(3) });
    expect(retried.data.provider).toBe('openrouteservice');
    expect(mockFetch()).toHaveBeenCalledTimes(2);
  });

  it('reuses route geometry for the same itinerary', async () => {
    mockFetch().mockImplementation(async (_url: string, init: { body: string }) => ({
      ok: true,
      json: async () => ({ routes: [{ geometry: JSON.parse(init.body).coordinates }] }),
    }));
    const first = await fetchRouteGeometry({ apiKey: 'k', profile: 'driving-car', points: points(4) });
    const second = await fetchRouteGeometry({ apiKey: 'k', profile: 'driving-car', points: points(4) });
    expect(mockFetch()).toHaveBeenCalledTimes(1);
    expect(second.coordinates).toEqual(first.coordinates);
  });
});
