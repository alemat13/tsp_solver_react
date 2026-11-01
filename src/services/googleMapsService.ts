import { CoordinatePoint, MatrixData, TransitLeg, TransitRide, TransitStep, TravelMode } from '../types';
import { buildHaversineMatrix } from '../utils/distance';
import { coordinateKey, googleLegCache, googleMatrixCache, googleTransitLegCache, PairValue } from './apiCache';
import { readCachedMatrix, tileBlock } from './matrixCache';

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
  /** Step-by-step transit directions, one entry per leg (undefined when Google has none). */
  transitLegs?: (TransitLeg | undefined)[];
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

  // Cells already fetched in this session come from the in-memory cache (Google's terms do not
  // allow storing distances or durations), so only new rows and columns are billed.
  const { distances, durations: cachedDurations, keys, blocks } = await readCachedMatrix(googleMatrixCache, params.profile, points);
  const durations = cachedDurations as number[][];

  const tasks = blocks.flatMap((block) => tileBlock(block, TRANSIT_MATRIX_BLOCK, TRANSIT_MATRIX_BLOCK)).map(({ sources, destinations }) => async () => {
    const payload = await postJson(
      ROUTE_MATRIX_URL,
      apiKey,
      'originIndex,destinationIndex,distanceMeters,duration,condition',
      {
        origins: sources.map((i) => toWaypoint(points[i])),
        destinations: destinations.map((j) => toWaypoint(points[j])),
        travelMode: 'TRANSIT',
      }
    );
    if (!Array.isArray(payload)) {
      throw new GoogleApiError('Invalid Google route matrix response format.');
    }
    const fresh: [string, PairValue][] = [];
    for (const element of payload) {
      const i = sources[element?.originIndex ?? 0];
      const j = destinations[element?.destinationIndex ?? 0];
      if (i === undefined || j === undefined || i === j) continue;
      const exists = element?.condition === 'ROUTE_EXISTS';
      const d = exists && typeof element.distanceMeters === 'number' ? element.distanceMeters : null;
      const seconds = exists ? parseDuration(element.duration) ?? null : null;
      distances[i][j] = d ?? Infinity;
      durations[i][j] = seconds ?? Infinity;
      if (exists || element?.condition === 'ROUTE_NOT_FOUND') fresh.push([keys[i][j], { d, s: seconds }]);
    }
    await googleMatrixCache.setMany(fresh);
  });

  try {
    await runLimited(tasks, MAX_PARALLEL_REQUESTS);
  } catch (e) {
    const fallback = buildFallbackMatrix(params);
    const message = e instanceof Error ? e.message : String(e);
    return { ...fallback, error: e instanceof GoogleApiError ? message : `Google Routes API request failed: ${message}` };
  }

  for (const row of durations) for (let j = 0; j < row.length; j += 1) if (row[j] === undefined) row[j] = Infinity;
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

const LEG_FIELD_MASK = [
  'routes.polyline.encodedPolyline',
  'routes.legs.duration',
  'routes.legs.distanceMeters',
  'routes.legs.steps.travelMode',
  'routes.legs.steps.staticDuration',
  'routes.legs.steps.distanceMeters',
  'routes.legs.steps.transitDetails',
].join(',');

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const number = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseRide = (details: any): TransitRide => {
  const line = details?.transitLine ?? {};
  const agency = Array.isArray(line.agencies) ? line.agencies[0] : undefined;
  const stops = details?.stopDetails ?? {};
  const local = details?.localizedValues ?? {};
  return {
    line: text(line.nameShort) ?? text(line.name) ?? text(details?.tripShortText) ?? text(line.vehicle?.name?.text) ?? 'Transit',
    lineName: text(line.name),
    color: text(line.color),
    textColor: text(line.textColor),
    vehicleType: text(line.vehicle?.type),
    vehicleName: text(line.vehicle?.name?.text),
    headsign: text(details?.headsign),
    agency: text(agency?.name),
    agencyUrl: text(agency?.uri),
    departureStop: text(stops.departureStop?.name),
    arrivalStop: text(stops.arrivalStop?.name),
    departureTime: text(stops.departureTime),
    arrivalTime: text(stops.arrivalTime),
    departureText: text(local.departureTime?.time?.text),
    arrivalText: text(local.arrivalTime?.time?.text),
    stopCount: number(details?.stopCount),
  };
};

/** Turns a Routes API leg into rides and walks; consecutive walking steps are merged. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const parseTransitLeg = (leg: any): TransitLeg | undefined => {
  if (!leg || !Array.isArray(leg.steps)) return undefined;
  const steps: TransitStep[] = [];
  for (const step of leg.steps) {
    const duration = parseDuration(step?.staticDuration);
    const distance = number(step?.distanceMeters);
    if (step?.travelMode === 'TRANSIT' && step.transitDetails) {
      steps.push({ kind: 'transit', duration, distance, ride: parseRide(step.transitDetails) });
      continue;
    }
    const previous = steps[steps.length - 1];
    if (previous?.kind === 'walk') {
      previous.duration = (previous.duration ?? 0) + (duration ?? 0);
      previous.distance = (previous.distance ?? 0) + (distance ?? 0);
    } else {
      steps.push({ kind: 'walk', duration, distance });
    }
  }
  return { duration: parseDuration(leg.duration), distance: number(leg.distanceMeters), steps };
};

/**
 * Route geometry and step-by-step transit directions for the ordered stops. Transit routes
 * cannot have intermediate waypoints, so each leg is requested separately (departing now); a
 * leg without a transit route is drawn as a straight line.
 *
 * Caching follows the Google terms: the leg polyline (lat/lng only) is persisted for at most 30
 * days, while the directions (lines, stops, times) stay in memory for a few minutes only, which
 * also keeps the timetable reasonably fresh.
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

  type LegResult = { polyline?: string; details?: TransitLeg; error?: string };
  const legs = points.slice(0, -1).map((origin, index) => async (): Promise<LegResult> => {
    const destination = points[index + 1];
    const cacheKey = coordinateKey(origin.latitude, origin.longitude) + '|' + coordinateKey(destination.latitude, destination.longitude);
    const cached = await googleTransitLegCache.get(cacheKey);
    if (cached !== undefined) {
      const polyline = (await googleLegCache.get(cacheKey)) ?? undefined;
      return { polyline, details: cached ?? undefined };
    }
    try {
      const payload = await postJson(ROUTES_URL, apiKey, LEG_FIELD_MASK, {
        origin: toWaypoint(origin).waypoint,
        destination: toWaypoint(destination).waypoint,
        travelMode: 'TRANSIT',
      });
      const route = payload?.routes?.[0];
      const polyline = route?.polyline?.encodedPolyline as string | undefined;
      const details = parseTransitLeg(route?.legs?.[0]);
      await googleLegCache.set(cacheKey, polyline ?? null);
      await googleTransitLegCache.set(cacheKey, details ?? null);
      return { polyline, details };
    } catch (e) {
      // Fall back to a polyline fetched earlier, if any; the directions are not available.
      const polyline = (await googleLegCache.get(cacheKey)) ?? undefined;
      return { polyline, error: e instanceof Error ? e.message : String(e) };
    }
  });

  const results = await runLimited(legs, MAX_PARALLEL_REQUESTS);
  const error = results.find((leg) => leg.error)?.error;
  const transitLegs = results.map((leg) => leg.details);
  const coordinates: [number, number][] = [];
  let missing = 0;
  results.forEach(({ polyline }, index) => {
    const leg = polyline ? decodePolyline(polyline) : [straight[index], straight[index + 1]];
    if (!polyline) missing += 1;
    coordinates.push(...(coordinates.length > 0 ? leg.slice(1) : leg));
  });
  if (missing === results.length) {
    return {
      coordinates: straight,
      warnings: [error ? 'Google route request failed – using straight‑line fallback.' : 'Google returned no transit route – using straight‑line fallback.'],
      error,
      transitLegs,
    };
  }
  const warnings = missing > 0 ? [missing + ' legs have no transit route and are drawn as straight lines.'] : [];
  if (error) warnings.push('Some transit directions could not be loaded.');
  return { coordinates, warnings, error, transitLegs };
};
