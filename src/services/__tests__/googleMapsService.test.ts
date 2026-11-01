import { vi } from 'vitest';
import { fetchMatrix as fetchGoogleMatrix, fetchRouteGeometry as fetchGoogleRouteGeometry, parseTransitLeg } from '../googleMapsService';
import { CoordinatePoint } from '../../types';

globalThis.fetch = vi.fn();
const mockFetch = () => globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

const mockPoints: CoordinatePoint[] = [
  { id: '1', label: 'A', latitude: 48.8584, longitude: 2.2945 },
  { id: '2', label: 'B', latitude: 48.8606, longitude: 2.3376 },
];

const element = (originIndex: number, destinationIndex: number, distanceMeters: number, seconds: number) => ({
  originIndex,
  destinationIndex,
  distanceMeters,
  duration: seconds + 's',
  condition: 'ROUTE_EXISTS',
});

describe('Google Maps Service (Routes API)', () => {
  beforeEach(() => {
    mockFetch().mockReset();
  });

  test('fetchMatrix parses the route matrix and sends the key in a header', async () => {
    mockFetch().mockResolvedValue({
      ok: true,
      json: async () => [element(0, 0, 0, 0), element(0, 1, 2000, 1200), element(1, 0, 3000, 1800), element(1, 1, 0, 0)],
    });

    const result = await fetchGoogleMatrix({ apiKey: 'test-key', profile: 'transit', points: mockPoints });
    expect(result.data.distances).toEqual([[0, 2000], [3000, 0]]);
    expect(result.data.durations).toEqual([[0, 1200], [1800, 0]]);
    expect(result.data.provider).toBe('google');
    expect(result.warnings).toHaveLength(0);

    const [url, init] = mockFetch().mock.calls[0];
    expect(url).toContain('routes.googleapis.com');
    expect(url).not.toContain('test-key');
    expect(init.headers['X-Goog-Api-Key']).toBe('test-key');
    expect(JSON.parse(init.body).travelMode).toBe('TRANSIT');
  });

  test('fetchMatrix splits large inputs into 10 x 10 blocks', async () => {
    const points = Array.from({ length: 15 }, (_, i) => ({ id: 'p' + i, label: 'P' + i, latitude: 48.8 + i / 100, longitude: 2.3 }));
    mockFetch().mockImplementation(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      const elements = [];
      for (let o = 0; o < body.origins.length; o += 1) {
        for (let d = 0; d < body.destinations.length; d += 1) elements.push(element(o, d, 100, 60));
      }
      return { ok: true, json: async () => elements };
    });

    const result = await fetchGoogleMatrix({ apiKey: 'k', profile: 'transit', points });
    expect(mockFetch()).toHaveBeenCalledTimes(4);
    expect(result.data.distances[14][0]).toBe(100);
    expect(result.data.distances[3][3]).toBe(0);
  });

  test('fetchMatrix marks pairs without a transit route as unreachable', async () => {
    mockFetch().mockResolvedValue({
      ok: true,
      json: async () => [element(0, 1, 2000, 1200), { originIndex: 1, destinationIndex: 0, condition: 'ROUTE_NOT_FOUND' }],
    });
    const result = await fetchGoogleMatrix({ apiKey: 'k', profile: 'transit', points: mockPoints });
    expect(result.data.distances[1][0]).toBe(Infinity);
    expect(result.warnings[0]).toContain('no public-transport connection');
  });

  test('fetchMatrix falls back to Haversine when API key missing', async () => {
    const result = await fetchGoogleMatrix({ apiKey: '', profile: 'transit', points: mockPoints });
    expect(result.data.provider).toBe('haversine');
    expect(result.warnings).toContain('Google Maps fallback to Haversine distances.');
  });

  test('fetchMatrix falls back on HTTP errors', async () => {
    mockFetch().mockResolvedValue({ ok: false, status: 403, text: async () => 'API key invalid' });
    const result = await fetchGoogleMatrix({ apiKey: 'k', profile: 'transit', points: mockPoints });
    expect(result.data.provider).toBe('haversine');
    expect(result.error).toContain('Google Routes API error 403');
  });

  test('fetchMatrix falls back on invalid payloads and network errors', async () => {
    mockFetch().mockResolvedValue({ ok: true, json: async () => ({ invalid: 'response' }) });
    expect((await fetchGoogleMatrix({ apiKey: 'k', profile: 'transit', points: mockPoints })).error).toContain('Invalid');

    mockFetch().mockRejectedValue(new Error('Network down'));
    const result = await fetchGoogleMatrix({ apiKey: 'k', profile: 'transit', points: mockPoints });
    expect(result.data.provider).toBe('haversine');
    expect(result.error).toContain('Network down');
  });

  test('fetchRouteGeometry decodes one polyline per leg', async () => {
    const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
    mockFetch().mockResolvedValue({ ok: true, json: async () => ({ routes: [{ polyline: { encodedPolyline: encoded } }] }) });
    const points = [...mockPoints, { id: '3', label: 'C', latitude: 48.853, longitude: 2.3499 }];
    const result = await fetchGoogleRouteGeometry({ apiKey: 'k', profile: 'transit', points });
    expect(mockFetch()).toHaveBeenCalledTimes(2);
    expect(result.coordinates.length).toBe(5); // 3 + 3 points, shared junction dropped
    expect(result.warnings).toHaveLength(0);
  });

  test('fetchRouteGeometry falls back to straight lines on errors', async () => {
    mockFetch().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const result = await fetchGoogleRouteGeometry({ apiKey: 'k', profile: 'transit', points: mockPoints });
    expect(result.coordinates).toEqual([[48.8584, 2.2945], [48.8606, 2.3376]]);
    expect(result.error).toContain('500');

    mockFetch().mockResolvedValue({ ok: true, json: async () => ({ routes: [] }) });
    const empty = await fetchGoogleRouteGeometry({ apiKey: 'k', profile: 'transit', points: mockPoints });
    expect(empty.warnings[0]).toContain('straight');
  });
});

describe('Google Maps Service caching', () => {
  const grid = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 'g' + i, label: 'G' + i, latitude: 48.8 + i / 100, longitude: 2.3 }));

  beforeEach(() => {
    mockFetch().mockReset();
    mockFetch().mockImplementation(async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      if (url.includes('computeRoutes')) return { ok: true, json: async () => ({ routes: [{ polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC' } }] }) };
      const elements = [];
      for (let o = 0; o < body.origins.length; o += 1) {
        for (let d = 0; d < body.destinations.length; d += 1) elements.push(element(o, d, 100, 60));
      }
      return { ok: true, json: async () => elements };
    });
  });

  test('only bills the new row and column when a stop is added', async () => {
    await fetchGoogleMatrix({ apiKey: 'k', profile: 'transit', points: grid(9) });
    mockFetch().mockClear();
    const result = await fetchGoogleMatrix({ apiKey: 'k', profile: 'transit', points: grid(10) });
    const elements = mockFetch().mock.calls.reduce((sum, [, init]) => {
      const body = JSON.parse(init.body);
      return sum + body.origins.length * body.destinations.length;
    }, 0);
    expect(elements).toBe(10 + 9); // instead of 100
    expect(result.data.distances[9][0]).toBe(100);
    expect(result.data.durations?.[0][9]).toBe(60);
  });

  test('reuses transit legs already fetched', async () => {
    const points = grid(3);
    await fetchGoogleRouteGeometry({ apiKey: 'k', profile: 'transit', points });
    mockFetch().mockClear();
    await fetchGoogleRouteGeometry({ apiKey: 'k', profile: 'transit', points: [...points, grid(4)[3]] });
    expect(mockFetch()).toHaveBeenCalledTimes(1); // only the new last leg
  });
});

const transitLeg = {
  duration: '1500s',
  distanceMeters: 5200,
  steps: [
    { travelMode: 'WALK', staticDuration: '120s', distanceMeters: 150 },
    { travelMode: 'WALK', staticDuration: '60s', distanceMeters: 50 },
    {
      travelMode: 'TRANSIT',
      staticDuration: '900s',
      distanceMeters: 4800,
      transitDetails: {
        stopDetails: {
          departureStop: { name: 'Bir-Hakeim' },
          arrivalStop: { name: 'Palais Royal' },
          departureTime: '2026-11-01T12:05:00Z',
          arrivalTime: '2026-11-01T12:20:00Z',
        },
        localizedValues: { departureTime: { time: { text: '13:05' } }, arrivalTime: { time: { text: '13:20' } } },
        headsign: 'Nation',
        stopCount: 9,
        transitLine: {
          name: 'Métro 6',
          nameShort: '6',
          color: '#6eca97',
          textColor: '#000000',
          agencies: [{ name: 'RATP', uri: 'https://www.ratp.fr/' }],
          vehicle: { type: 'SUBWAY', name: { text: 'Subway' } },
        },
      },
    },
    { travelMode: 'WALK', staticDuration: '240s', distanceMeters: 200 },
  ],
};

describe('Google transit directions', () => {
  beforeEach(() => {
    mockFetch().mockReset();
  });

  test('parseTransitLeg extracts rides and merges walking steps', () => {
    const leg = parseTransitLeg(transitLeg);
    expect(leg?.duration).toBe(1500);
    expect(leg?.steps.map((step) => step.kind)).toEqual(['walk', 'transit', 'walk']);
    expect(leg?.steps[0]).toMatchObject({ duration: 180, distance: 200 });
    expect(leg?.steps[1].ride).toMatchObject({
      line: '6',
      vehicleType: 'SUBWAY',
      headsign: 'Nation',
      departureStop: 'Bir-Hakeim',
      arrivalStop: 'Palais Royal',
      departureText: '13:05',
      arrivalText: '13:20',
      stopCount: 9,
      agency: 'RATP',
      color: '#6eca97',
    });
    expect(parseTransitLeg(undefined)).toBeUndefined();
  });

  test('fetchRouteGeometry returns the directions of each leg', async () => {
    mockFetch().mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC' }, legs: [transitLeg] }] }),
    });
    const result = await fetchGoogleRouteGeometry({ apiKey: 'k', profile: 'transit', points: mockPoints });
    expect(result.transitLegs?.[0]?.steps[1].ride?.line).toBe('6');
    const [, init] = mockFetch().mock.calls[0];
    expect(init.headers['X-Goog-FieldMask']).toContain('routes.legs.steps.transitDetails');

    // Directions are served from the in-memory cache while fresh.
    mockFetch().mockClear();
    const again = await fetchGoogleRouteGeometry({ apiKey: 'k', profile: 'transit', points: mockPoints });
    expect(mockFetch()).not.toHaveBeenCalled();
    expect(again.transitLegs?.[0]?.steps).toHaveLength(3);
  });

  test('only the polyline is persisted; directions stay in memory', async () => {
    const { googleLegCache, googleTransitLegCache } = await import('../apiCache');
    expect(googleLegCache.options.persist).toBe(true);
    expect(googleTransitLegCache.options.persist).toBe(false);
    expect(googleTransitLegCache.options.ttlMs).toBeLessThanOrEqual(30 * 60 * 1000);
  });
});
