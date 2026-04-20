import { CoordinatePoint, MatrixData, TravelMode } from '../types';
import { buildHaversineMatrix } from '../utils/distance';

/**
 * Google Maps API service wrapper.
 * Supports only the `transit` travel mode for now.
 *
 * The public transport implementation mirrors the OpenRouteService API surface
 * so the rest of the application can remain unchanged.
 */

const GOOGLE_MATRIX_BASE_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json';
const GOOGLE_DIRECTIONS_BASE_URL = 'https://maps.googleapis.com/maps/api/directions/json';

export interface MatrixFetchParams {
  apiKey?: string;
  profile: TravelMode; // expected to be 'transit'
  points: CoordinatePoint[];
}

export interface MatrixFetchResult {
  data: MatrixData;
  warnings: string[];
  error?: string;
}

export interface RouteGeometryParams {
  apiKey?: string;
  profile: TravelMode; // 'transit'
  points: CoordinatePoint[];
}

export interface RouteGeometryResult {
  coordinates: [number, number][];
  warnings: string[];
  error?: string;
}

/**
 * Helper to build a fallback Haversine matrix when the Google request fails.
 */
const buildFallbackMatrix = (params: MatrixFetchParams): MatrixFetchResult => {
  const distances = buildHaversineMatrix(params.points);
  return {
    data: {
      distances,
      durations: undefined,
      profile: params.profile,
      sourceIds: params.points.map((p) => p.id),
      destinationIds: params.points.map((p) => p.id),
      provider: 'haversine',
    },
    warnings: ['Google Maps fallback to Haversine distances.' ],
  };
};

/**
 * Fetch a distance matrix from Google Distance Matrix API.
 * Returns distances in meters and durations in seconds.
 */
export const fetchMatrix = async (params: MatrixFetchParams): Promise<MatrixFetchResult> => {
  const { apiKey, profile, points } = params;
  if (profile !== 'transit') {
    console.warn(`Google Maps service currently supports only the 'transit' travel mode. Profile '${profile}' may not work correctly.`);
  }
  if (!apiKey) {
    return buildFallbackMatrix(params);
  }

  // Google expects "lat,lng" strings for origins/destinations.
  const locations = points.map((p) => `${p.latitude},${p.longitude}`).join('|');
  const url = `${GOOGLE_MATRIX_BASE_URL}?origins=${encodeURIComponent(locations)}&destinations=${encodeURIComponent(locations)}&mode=${profile}&key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const fallback = buildFallbackMatrix(params);
      const errorText = await response.text();
      return { ...fallback, error: `Google Distance Matrix error ${response.status}: ${errorText}` };
    }
    const payload = await response.json();
    // Payload shape: { rows: [{ elements: [{ distance: { value }, duration: { value } }, ...] }, ...] }
    const distances: number[][] = [];
    const durations: number[][] = [];
    if (!Array.isArray(payload?.rows)) {
      const fallback = buildFallbackMatrix(params);
      return { ...fallback, error: 'Invalid Google Distance Matrix response format.' };
    }
    for (const row of payload.rows) {
      const distRow: number[] = [];
      const durRow: number[] = [];
      for (const element of row.elements) {
        if (element.status !== 'OK') {
          distRow.push(Infinity);
          durRow.push(Infinity);
        } else {
          distRow.push(element.distance?.value ?? Infinity);
          durRow.push(element.duration?.value ?? Infinity);
        }
      }
      distances.push(distRow);
      durations.push(durRow);
    }
    const data: MatrixData = {
      distances,
      durations,
      profile,
      sourceIds: points.map((p) => p.id),
      destinationIds: points.map((p) => p.id),
      provider: 'google',
    };
    return { data, warnings: [] };
  } catch (e) {
    const fallback = buildFallbackMatrix(params);
    const message = e instanceof Error ? e.message : String(e);
    return { ...fallback, error: `Google Distance Matrix request failed: ${message}` };
  }
};

/**
 * Fetch route geometry from Google Directions API.
 * For simplicity we request a single‑leg route (origin → destination) and
 * concatenate any intermediate waypoints. The API returns an encoded polyline
 * which we decode to a list of lat/lng pairs.
 */
export const fetchRouteGeometry = async (params: RouteGeometryParams): Promise<RouteGeometryResult> => {
  const { apiKey, profile, points } = params;
  if (points.length < 2) {
    return { coordinates: points.map((p) => [p.latitude, p.longitude]), warnings: [] };
  }
  if (!apiKey) {
    return { coordinates: points.map((p) => [p.latitude, p.longitude]), warnings: ['Missing Google API key – using straight‑line geometry.'] };
  }

  const origin = `${points[0].latitude},${points[0].longitude}`;
  const destination = `${points[points.length - 1].latitude},${points[points.length - 1].longitude}`;
  const waypoints = points.slice(1, -1).map((p) => `${p.latitude},${p.longitude}`).join('|');
  const waypointParam = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : '';
  const url = `${GOOGLE_DIRECTIONS_BASE_URL}?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}${waypointParam}&mode=${profile}&key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      return { coordinates: points.map((p) => [p.latitude, p.longitude]), warnings: ['Failed to fetch Google route geometry – using straight‑line fallback.'], error: `Google Directions error ${response.status}: ${errorText}` };
    }
    const payload = await response.json();
    const route = payload?.routes?.[0];
    const polyline = route?.overview_polyline?.points;
    if (!polyline) {
      return { coordinates: points.map((p) => [p.latitude, p.longitude]), warnings: ['Google Directions returned no polyline – using straight‑line fallback.'] };
    }
    // Decode polyline (Google uses 5‑precision).
    const decodePolyline = (str: string, precision = 5): [number, number][] => {
      const coordinates: [number, number][] = [];
      let index = 0, lat = 0, lng = 0;
      const factor = Math.pow(10, precision);
      while (index < str.length) {
        let result = 0, shift = 0, byte: number;
        do {
          byte = str.charCodeAt(index++) - 63;
          result |= (byte & 0x1f) << shift;
          shift += 5;
        } while (byte >= 0x20);
        const deltaLat = (result & 1) ? ~(result >> 1) : result >> 1;
        lat += deltaLat;
        result = 0; shift = 0;
        do {
          byte = str.charCodeAt(index++) - 63;
          result |= (byte & 0x1f) << shift;
          shift += 5;
        } while (byte >= 0x20);
        const deltaLng = (result & 1) ? ~(result >> 1) : result >> 1;
        lng += deltaLng;
        coordinates.push([lat / factor, lng / factor]);
      }
      return coordinates;
    };
    const coordinates = decodePolyline(polyline);
    return { coordinates, warnings: [] };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { coordinates: points.map((p) => [p.latitude, p.longitude]), warnings: ['Google Directions request failed – using straight‑line fallback.'], error: message };
  }
};
