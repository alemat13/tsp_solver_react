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
      const rows = body.sources ?? body.locations.map((_: unknown, i: number) => i);
      const row = (i: number) => body.locations.map((_: unknown, j: number) => i * 1000 + j);
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
