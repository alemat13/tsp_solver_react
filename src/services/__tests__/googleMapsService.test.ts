import { vi } from 'vitest';
import { fetchMatrix as fetchGoogleMatrix, fetchRouteGeometry as fetchGoogleRouteGeometry } from '../googleMapsService';
import { CoordinatePoint } from '../../types';

// Mock global fetch
globalThis.fetch = vi.fn();

const mockPoints: CoordinatePoint[] = [
  { id: '1', label: 'A', latitude: 40.7128, longitude: -74.006 },
  { id: '2', label: 'B', latitude: 34.0522, longitude: -118.2437 },
];
describe('Google Maps Service', () => {
  beforeEach(() => {
    // @ts-ignore
    (globalThis.fetch as any).mockReset();
  });

  test('fetchMatrix returns parsed distances and durations', async () => {
    const mockResponse = {
      rows: [
        { elements: [{ distance: { value: 1000 }, duration: { value: 600 }, status: 'OK' }, { distance: { value: 2000 }, duration: { value: 1200 }, status: 'OK' }] },
        { elements: [{ distance: { value: 3000 }, duration: { value: 1800 }, status: 'OK' }, { distance: { value: 4000 }, duration: { value: 2400 }, status: 'OK' }] },
      ],
    };
    // @ts-ignore
    fetch.mockResolvedValue({ ok: true, json: async () => mockResponse });

    const result = await fetchGoogleMatrix({ apiKey: 'test-key', profile: 'transit', points: mockPoints });
    expect(result.data.distances).toEqual([[1000, 2000], [3000, 4000]]);
    expect(result.data.durations).toEqual([[600, 1200], [1800, 2400]]);
    expect(result.data.provider).toBe('google');
    expect(result.warnings).toHaveLength(0);
  });

  test('fetchMatrix falls back to Haversine when API key missing', async () => {
    const result = await fetchGoogleMatrix({ apiKey: '', profile: 'transit', points: mockPoints });
    expect(result.data.provider).toBe('haversine');
    expect(result.warnings).toContain('Google Maps fallback to Haversine distances.');
  });

  test('fetchRouteGeometry decodes polyline', async () => {
    // Simple polyline for two points (encoded) – using Google's polyline algorithm
    const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'; // corresponds to [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]
    const mockResponse = { routes: [{ overview_polyline: { points: encoded } }] };
    // @ts-ignore
    fetch.mockResolvedValue({ ok: true, json: async () => mockResponse });

    const result = await fetchGoogleRouteGeometry({ apiKey: 'test-key', profile: 'transit', points: mockPoints });
    expect(result.coordinates.length).toBeGreaterThan(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.error).toBeUndefined();
  });

  describe('fetchMatrix error handling', () => {
    test('handles HTTP error status (4xx)', async () => {
      // @ts-ignore
      fetch.mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden', text: async () => 'API key invalid' });

      const result = await fetchGoogleMatrix({ apiKey: 'test-key', profile: 'transit', points: mockPoints });

      expect(result.data.provider).toBe('haversine');
      expect(result.data.distances[0][1]).toBeGreaterThan(0);
      expect(result.error).toContain('Google Distance Matrix error 403');
      expect(result.warnings).toContain('Google Maps fallback to Haversine distances.');
    });

    test('handles HTTP error status (5xx)', async () => {
      // @ts-ignore
      fetch.mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable', text: async () => 'Service unavailable' });

      const result = await fetchGoogleMatrix({ apiKey: 'test-key', profile: 'transit', points: mockPoints });

      expect(result.data.provider).toBe('haversine');
      expect(result.error).toContain('Google Distance Matrix error 503');
      expect(result.warnings).toContain('Google Maps fallback to Haversine distances.');
    });

    test('handles invalid response format', async () => {
      const mockResponse = { invalid: 'response' };
      // @ts-ignore
      fetch.mockResolvedValue({ ok: true, json: async () => mockResponse });

      const result = await fetchGoogleMatrix({ apiKey: 'test-key', profile: 'transit', points: mockPoints });

      expect(result.data.provider).toBe('haversine');
      expect(result.error).toBe('Invalid Google Distance Matrix response format.');
      expect(result.warnings).toContain('Google Maps fallback to Haversine distances.');
    });

    test('handles network error (fetch throws)', async () => {
      // @ts-ignore
      fetch.mockRejectedValue(new Error('Network error: Failed to fetch'));

      const result = await fetchGoogleMatrix({ apiKey: 'test-key', profile: 'transit', points: mockPoints });

      expect(result.data.provider).toBe('haversine');
      expect(result.error).toContain('Google Distance Matrix request failed: Network error');
      expect(result.warnings).toContain('Google Maps fallback to Haversine distances.');
    });
  });

  describe('fetchRouteGeometry error handling', () => {
    test('handles HTTP error status', async () => {
      // @ts-ignore
      fetch.mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found', text: async () => 'Route not found' });

      const result = await fetchGoogleRouteGeometry({ apiKey: 'test-key', profile: 'transit', points: mockPoints });

      expect(result.coordinates).toEqual([[40.7128, -74.006], [34.0522, -118.2437]]);
      expect(result.error).toContain('Google Directions error 404');
      expect(result.warnings).toContain('Failed to fetch Google route geometry – using straight‑line fallback.');
    });

    test('handles invalid response format (no routes)', async () => {
      const mockResponse = { invalid: 'response' };
      // @ts-ignore
      fetch.mockResolvedValue({ ok: true, json: async () => mockResponse });

      const result = await fetchGoogleRouteGeometry({ apiKey: 'test-key', profile: 'transit', points: mockPoints });

      expect(result.coordinates).toEqual([[40.7128, -74.006], [34.0522, -118.2437]]);
      expect(result.warnings).toContain('Google Directions returned no polyline – using straight‑line fallback.');
    });

    test('handles fetch network error', async () => {
      // @ts-ignore
      fetch.mockRejectedValue(new Error('Network error: Failed to fetch'));

      const result = await fetchGoogleRouteGeometry({ apiKey: 'test-key', profile: 'transit', points: mockPoints });

      expect(result.coordinates).toEqual([[40.7128, -74.006], [34.0522, -118.2437]]);
      expect(result.error).toBe('Network error: Failed to fetch');
      expect(result.warnings).toContain('Google Directions request failed – using straight‑line fallback.');
    });
  });
});
