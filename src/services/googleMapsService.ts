import { CoordinatePoint, MatrixData, TravelMode } from '../types';
import { buildHaversineMatrix } from '../utils/distance';

/**
 * Google public-transport routing through the Routes API.
 *
 * The legacy Distance Matrix and Directions web services cannot be called from a browser (no
 * CORS headers), and they are closed to new projects. The Routes API endpoints accept browser
 * requests authenticated with the X-Goog-Api-Key header, so the app stays front-only.
 * The key needs the "Routes API" enabled in Google Cloud; restrict it to your site's referrer.
 */

const ROUTE_MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/** Transit route matrices are limited to 100 elements per request. */
const TRANSIT_MATRIX_BLOCK = 10;
/** Parallel requests, to stay well within per-minute quotas. */
const MAX_PARALLEL_REQUESTS = 4;

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

const FALLBACK_WARNING = 'Google Maps fallback to Haversine distances.';

const buildFallbackMatrix = (params: MatrixFetchParams): MatrixFetchResult => ({
  data: {
    distances: buildHaversineMatrix(params.points),
    durations: undefined,
    profile: params.profile,
    sourceIds: params.points.map((p) => p.id),
    destinationIds: params.points.map((p) => p.id),
    provider: 'haversine',
  },
  warnings: [FALLBACK_WARNING],
});

const toWaypoint = (point: CoordinatePoint) => ({
  waypoint: { location: { latLng: { latitude: point.latitude, longitude: point.longitude } } },
});

/** Routes API durations are strings such as "1234s". */
const parseDuration = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined;
  const seconds = Number.parseFloat(value.replace(/s$/, ''));
  return Number.isFinite(seconds) ? seconds : undefined;
};

/** Runs async tasks with a concurrency limit, preserving result order. */
const runLimited = async <T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> => {
  const results = new Array<T>(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
};

class GoogleApiError extends Error {}

const postJson = async (url: string, apiKey: string, fieldMask: string, body: unknown) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new GoogleApiError(`Google Routes API error ${response.status}: ${errorText}`);
  }
  return response.json();
};

/**
 * Transit distance/duration matrix (metres / seconds), requested in 10 x 10 blocks.
 * Pairs without a transit connection are left as Infinity (the solvers treat them as a penalty).
 */
export const fetchMatrix = async (params: MatrixFetchParams): Promise<MatrixFetchResult> => {
  const { apiKey, points } = params;
  if (!apiKey) {
    return buildFallbackMatrix(params);
  }

  const size = points.length;
  const distances = Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => (i === j ? 0 : Infinity)));
  const durations = Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => (i === j ? 0 : Infinity)));

  const tasks: (() => Promise<void>)[] = [];
  for (let originStart = 0; originStart < size; originStart += TRANSIT_MATRIX_BLOCK) {
    for (let destinationStart = 0; destinationStart < size; destinationStart += TRANSIT_MATRIX_BLOCK) {
      const origins = points.slice(originStart, originStart + TRANSIT_MATRIX_BLOCK);
      const destinations = points.slice(destinationStart, destinationStart + TRANSIT_MATRIX_BLOCK);
      tasks.push(async () => {
        const payload = await postJson(
          ROUTE_MATRIX_URL,
          apiKey,
          'originIndex,destinationIndex,distanceMeters,duration,condition',
          { origins: origins.map(toWaypoint), destinations: destinations.map(toWaypoint), travelMode: 'TRANSIT' }
        );
        if (!Array.isArray(payload)) {
          throw new GoogleApiError('Invalid Google route matrix response format.');
        }
        for (const element of payload) {
          const i = originStart + (element?.originIndex ?? 0);
          const j = destinationStart + (element?.destinationIndex ?? 0);
          if (i === j || element?.condition !== 'ROUTE_EXISTS') continue;
          distances[i][j] = typeof element.distanceMeters === 'number' ? element.distanceMeters : Infinity;
          durations[i][j] = parseDuration(element.duration) ?? Infinity;
        }
      });
    }
  }

  try {
    await runLimited(tasks, MAX_PARALLEL_REQUESTS);
  } catch (e) {
    const fallback = buildFallbackMatrix(params);
    const message = e instanceof Error ? e.message : String(e);
    return { ...fallback, error: e instanceof GoogleApiError ? message : `Google Routes API request failed: ${message}` };
  }

  const missing = distances.reduce((count, row, i) => count + row.filter((value, j) => i !== j && !Number.isFinite(value)).length, 0);
  return {
    data: {
      distances,
      durations,
      profile: params.profile,
      sourceIds: points.map((p) => p.id),
      destinationIds: points.map((p) => p.id),
      provider: 'google',
    },
    warnings: missing > 0 ? [missing + ' pairs of stops have no public-transport connection; the route avoids them when possible.'] : [],
  };
};

const decodePolyline = (str: string, precision = 5): [number, number][] => {
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const factor = Math.pow(10, precision);
  while (index < str.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
};

/**
 * Route geometry for the ordered stops. Transit routes cannot have intermediate waypoints, so
 * each leg is requested separately; a leg without a transit route is drawn as a straight line.
 */
export const fetchRouteGeometry = async (params: RouteGeometryParams): Promise<RouteGeometryResult> => {
  const { apiKey, points } = params;
  const straight = points.map((p) => [p.latitude, p.longitude] as [number, number]);
  if (points.length < 2) {
    return { coordinates: straight, warnings: [] };
  }
  if (!apiKey) {
    return { coordinates: straight, warnings: ['Missing Google API key – using straight‑line geometry.'] };
  }

  const legs = points.slice(0, -1).map((origin, index) => () =>
    postJson(ROUTES_URL, apiKey, 'routes.polyline.encodedPolyline', {
      origin: toWaypoint(origin).waypoint,
      destination: toWaypoint(points[index + 1]).waypoint,
      travelMode: 'TRANSIT',
    }).then((payload) => payload?.routes?.[0]?.polyline?.encodedPolyline as string | undefined)
  );

  try {
    const polylines = await runLimited(legs, MAX_PARALLEL_REQUESTS);
    const coordinates: [number, number][] = [];
    let missing = 0;
    polylines.forEach((polyline, index) => {
      const leg = polyline ? decodePolyline(polyline) : [straight[index], straight[index + 1]];
      if (!polyline) missing += 1;
      coordinates.push(...(coordinates.length > 0 ? leg.slice(1) : leg));
    });
    if (missing === polylines.length) {
      return { coordinates: straight, warnings: ['Google returned no transit route – using straight‑line fallback.'] };
    }
    return {
      coordinates,
      warnings: missing > 0 ? [missing + ' legs have no transit route and are drawn as straight lines.'] : [],
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { coordinates: straight, warnings: ['Google route request failed – using straight‑line fallback.'], error: message };
  }
};
