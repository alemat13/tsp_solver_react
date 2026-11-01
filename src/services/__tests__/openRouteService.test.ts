import { vi } from 'vitest';
import { fetchMatrix, fetchRouteGeometry } from '../openRouteService';

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

  it('stitches directions for itineraries longer than 50 stops', async () => {
    mockFetch().mockImplementation(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ routes: [{ geometry: body.coordinates }] }) };
    });
    const result = await fetchRouteGeometry({ apiKey: 'k', profile: 'driving-car', points: points(60) });
    expect(mockFetch()).toHaveBeenCalledTimes(2);
    expect(result.coordinates).toHaveLength(60);
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
