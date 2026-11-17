import { CoordinatePoint, MatrixData, TravelMode } from '../types';
import { buildHaversineMatrix } from '../utils/distance';
import { coordinateKey, orsDirectionsCache, orsMatrixCache, PairValue } from './apiCache';
import { readCachedMatrix, tileBlock } from './matrixCache';

const ORS_BASE_URL = 'https://api.heigit.org/openrouteservice/v2/matrix/';
/** Free-plan limits of the OpenRouteService API. */
export const ORS_MAX_MATRIX_ELEMENTS = 3500;
export const ORS_MAX_DIRECTIONS_WAYPOINTS = 50;

export interface MatrixFetchParams {
  apiKey?: string;
  profile: TravelMode;
  points: CoordinatePoint[];
}

export interface MatrixFetchResult {
  data: MatrixData;
  warnings: string[];
  error?: string;
}

export interface RouteGeometryParams {
  apiKey: string;
  profile: TravelMode;
  points: CoordinatePoint[];
}

export interface RouteGeometryResult {
  coordinates: [number, number][];
  warnings: string[];
  error?: string;
}

const isValidResponseMatrix = (matrix: unknown): matrix is number[][] => {
  if (!Array.isArray(matrix)) {
    return false;
  }
  return matrix.every((row) => Array.isArray(row));
};

const buildFallbackMatrix = (params: MatrixFetchParams): MatrixFetchResult => {
  const distances = buildHaversineMatrix(params.points);
  return {
    data: {
      distances,
      durations: undefined,
      profile: params.profile,
      sourceIds: params.points.map((point) => point.id),
      destinationIds: params.points.map((point) => point.id),
      provider: 'haversine',
    },
    warnings: ['Fell back to Haversine distances. Results are approximations and ignore routing constraints.'],
  };
};

export const fetchMatrix = async (params: MatrixFetchParams): Promise<MatrixFetchResult> => {
  const { apiKey, profile, points } = params;

  if (!apiKey) {
    return buildFallbackMatrix(params);
  }

  const locations = points.map((point) => [point.longitude, point.latitude]);
  const size = points.length;
  // Cells already fetched (this session or earlier) come from the cache; only the missing rows
  // and columns are requested.
  const { distances, durations, keys, blocks } = await readCachedMatrix(orsMatrixCache, profile, points);

  for (const block of blocks) {
    // ORS caps a matrix request at ORS_MAX_MATRIX_ELEMENTS cells (sources x destinations):
    // larger blocks are split into groups of source rows, each against every destination.
    const rowsPerRequest = Math.max(1, Math.floor(ORS_MAX_MATRIX_ELEMENTS / block.destinations.length));
    for (const tile of tileBlock(block, rowsPerRequest, block.destinations.length)) {
      const { sources, destinations } = tile;
      const body: Record<string, unknown> = {
        locations,
        metrics: ['distance', 'duration'],
        units: 'm',
      };
      if (sources.length < size) body.sources = sources;
      if (destinations.length < size) body.destinations = destinations;

      const response = await fetch(ORS_BASE_URL + profile, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const fallback = buildFallbackMatrix(params);
        return {
          data: fallback.data,
          warnings: fallback.warnings,
          error: 'OpenRouteService matrix failed (HTTP ' + response.status + '): ' + describeOrsError(response.status, errorText).message,
        };
      }

      const payload = await response.json();
      const blockDistances = payload && payload.distances;
      const blockDurations = payload && payload.durations;
      if (!isValidResponseMatrix(blockDistances) || blockDistances.length !== sources.length) {
        const fallback = buildFallbackMatrix(params);
        return {
          data: fallback.data,
          warnings: fallback.warnings,
          error: 'OpenRouteService matrix payload was invalid or incomplete.',
        };
      }
      const hasDurations = isValidResponseMatrix(blockDurations) && blockDurations.length === sources.length;
      const fresh: [string, PairValue][] = [];
      sources.forEach((i, row) => {
        destinations.forEach((j, column) => {
          if (i === j) return;
          const distance = blockDistances[row][column];
          const duration = hasDurations ? blockDurations[row][column] : undefined;
          // ORS returns null for unroutable pairs.
          const d = typeof distance === 'number' && Number.isFinite(distance) ? distance : null;
          const s = typeof duration === 'number' && Number.isFinite(duration) ? duration : null;
          distances[i][j] = d ?? Infinity;
          durations[i][j] = s ?? (d === null ? Infinity : undefined);
          if (d !== null || distance === null) fresh.push([keys[i][j], { d, s }]);
        });
      });
      await orsMatrixCache.setMany(fresh);
    }
  }

  const durationsComplete = durations.every((row) => row.every((value) => value !== undefined));
  const data: MatrixData = {
    distances,
    durations: durationsComplete ? (durations as number[][]) : undefined,
    profile,
    sourceIds: points.map((point) => point.id),
    destinationIds: points.map((point) => point.id),
    provider: 'openrouteservice',
  };

  return {
    data,
    warnings: [],
  };
};

const ORS_DIRECTIONS_URL = 'https://api.heigit.org/openrouteservice/v2/directions/';

const decodePolyline = (polyline: string, precision = 5): [number, number][] => {
  const coordinates: [number, number][] = [];
  const factor = Math.pow(10, precision);
  let index = 0;
  let lat = 0;
  let lon = 0;

  const polylineLength = polyline.length;

  while (index < polylineLength) {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      byte = polyline.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = (result & 1) ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    result = 0;
    shift = 0;

    do {
      byte = polyline.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLon = (result & 1) ? ~(result >> 1) : result >> 1;
    lon += deltaLon;

    coordinates.push([lat / factor, lon / factor]);
  }

  return coordinates;
};

/** ORS snaps each waypoint to a road within this radius (metres) unless told otherwise. */
const ORS_DEFAULT_SNAP_RADIUS = 350;
/**
 * Radius (metres) tried again for a stop ORS could not snap. A finite value rather than -1
 * (unlimited), which can make the public API's proxy time out with an HTTP 500.
 */
const ORS_WIDE_SNAP_RADIUS = 2000;
/** Upper bound on directions requests for one itinerary, to stay well under the ORS rate limit. */
const ORS_MAX_DIRECTIONS_REQUESTS = 30;

interface OrsFailure {
  status: number;
  message: string;
  /** Index (in the request) of a waypoint with no road nearby (ORS error 2010). */
  point?: number;
  /** Indexes (in the request) of two waypoints with no route between them (ORS error 2009). */
  leg?: [number, number];
}

type DirectionsOutcome = { geometry: [number, number][]; warnings: string[] } | { failure: OrsFailure };

/** Human-readable message from an ORS error body, which is JSON like {"error":{"code":2010,"message":"..."}}. */
const describeOrsError = (status: number, body: string): { code?: number; message: string } => {
  try {
    const error = JSON.parse(body)?.error;
    if (typeof error === 'string') return { message: error };
    if (error && typeof error.message === 'string') return { code: typeof error.code === 'number' ? error.code : undefined, message: error.message };
  } catch {
    // Not JSON: use the raw text below.
  }
  const text = body.trim();
  return { message: text && text.length < 200 ? text : 'HTTP ' + status };
};

const parseOrsFailure = (status: number, body: string): OrsFailure => {
  const { code, message } = describeOrsError(status, body);
  const failure: OrsFailure = { status, message };
  if (code === 2010) {
    const match = /coordinate (\d+)/.exec(message);
    if (match) failure.point = Number(match[1]);
  } else if (code === 2009) {
    const match = /between points (\d+)\D.*?and (\d+)\D/.exec(message + ' ');
    if (match) failure.leg = [Number(match[1]), Number(match[2])];
  }
  return failure;
};

const straightLine = (points: CoordinatePoint[]): [number, number][] => points.map((point) => [point.latitude, point.longitude]);

const stopName = (point: CoordinatePoint) => '“' + (point.label?.trim() || point.latitude.toFixed(5) + ', ' + point.longitude.toFixed(5)) + '”';

const requestDirections = async (
  params: RouteGeometryParams,
  points: CoordinatePoint[],
  radiuses?: number[]
): Promise<DirectionsOutcome> => {
  const body: Record<string, unknown> = {
    coordinates: points.map((point) => [point.longitude, point.latitude]),
    instructions: false,
    units: 'm',
  };
  if (radiuses) body.radiuses = radiuses;
  const response = await fetch(ORS_DIRECTIONS_URL + params.profile, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: params.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    return { failure: parseOrsFailure(response.status, await response.text()) };
  }

  const payload = await response.json();
  const route = payload?.routes?.[0];
  const geometryPayload = route?.geometry;
  let geometry: [number, number][] | undefined;
  const warnings: string[] = [];

  if (Array.isArray(geometryPayload)) {
    geometry = geometryPayload
      .map((pair: unknown) => {
        if (!Array.isArray(pair) || pair.length < 2) {
          return undefined;
        }
        const [lon, lat] = pair as [number, number];
        return [lat, lon] as [number, number];
      })
      .filter((pair): pair is [number, number] => Array.isArray(pair));
  } else if (typeof geometryPayload === 'string') {
    try {
      const precisionHint = typeof route?.geometry_format === 'string' && route.geometry_format.includes('6') ? 6 : 5;
      geometry = decodePolyline(geometryPayload, precisionHint);
    } catch (error) {
      warnings.push('Failed to decode route geometry polyline.');
    }
  }

  if (!geometry || geometry.length === 0) {
    return { failure: { status: response.status, message: 'the response did not contain a usable route geometry' } };
  }

  // Drop consecutive duplicates only: a loop legitimately revisits its first coordinate.
  geometry = geometry.filter((pair, index) => {
    if (index === 0) return true;
    const previous = geometry![index - 1];
    return pair[0].toFixed(6) !== previous[0].toFixed(6) || pair[1].toFixed(6) !== previous[1].toFixed(6);
  });
  return { geometry, warnings };
};

interface SegmentContext {
  /** Whether retrying an unroutable stop with an unlimited snapping radius is still worth a request. */
  tryWiderRadius: boolean;
  /** Directions requests still allowed for this itinerary. */
  budget: number;
  warnings: string[];
  errors: string[];
}

const addOnce = (list: string[], message: string) => {
  if (!list.includes(message)) list.push(message);
};

/** One directions request, unless this itinerary has used up its request budget. */
const requestWithinBudget = async (
  params: RouteGeometryParams,
  points: CoordinatePoint[],
  context: SegmentContext,
  radiuses?: number[]
): Promise<DirectionsOutcome> => {
  if (context.budget <= 0) {
    return { failure: { status: 429, message: 'too many directions requests for one route; try again in a minute' } };
  }
  context.budget -= 1;
  try {
    return await requestDirections(params, points, radiuses);
  } catch (error) {
    return { failure: { status: 0, message: error instanceof Error ? error.message : 'network error' } };
  }
};

/**
 * Road geometry through the ordered points. When ORS cannot route a stop (no road within its
 * snapping radius) or a leg (no route at all), only the legs touching it are drawn as straight
 * lines; the rest of the itinerary is still requested, in smaller pieces, and drawn on roads.
 */
const routeSegment = async (
  params: RouteGeometryParams,
  points: CoordinatePoint[],
  context: SegmentContext
): Promise<[number, number][]> => {
  if (points.length < 2) return straightLine(points);

  const cacheKey = params.profile + '|' + points.map((point) => coordinateKey(point.latitude, point.longitude)).join(';');
  const cached = await orsDirectionsCache.get(cacheKey);
  if (cached) return cached;

  let outcome = await requestWithinBudget(params, points, context);

  if ('failure' in outcome && outcome.failure.point !== undefined && context.tryWiderRadius) {
    // The stop is off the road network (a beach, a trail, a park): look for a road further
    // away before giving up on it.
    const point = outcome.failure.point;
    const retry = await requestWithinBudget(
      params,
      points,
      context,
      points.map((_, index) => (index === point ? ORS_WIDE_SNAP_RADIUS : ORS_DEFAULT_SNAP_RADIUS))
    );
    if ('geometry' in retry) outcome = retry;
    else context.tryWiderRadius = false;
  }

  if ('geometry' in outcome) {
    outcome.warnings.forEach((warning) => addOnce(context.warnings, warning));
    if (outcome.warnings.length === 0) await orsDirectionsCache.set(cacheKey, outcome.geometry);
    return outcome.geometry;
  }

  const { failure } = outcome;
  const { point, leg } = failure;
  if (point !== undefined && point >= 0 && point < points.length) {
    addOnce(
      context.warnings,
      'No road found near stop ' + stopName(points[point]) + ' for this travel mode, so the legs to and from it are drawn as straight lines.'
    );
    const before = await routeSegment(params, points.slice(0, point), context);
    const after = await routeSegment(params, points.slice(point + 1), context);
    return [...before, straightLine([points[point]])[0], ...after];
  }
  if (leg && leg[0] >= 0 && leg[0] < leg[1] && leg[1] < points.length) {
    addOnce(
      context.warnings,
      'No route found between ' + stopName(points[leg[0]]) + ' and ' + stopName(points[leg[1]]) + ', so that leg is drawn as a straight line.'
    );
    const before = await routeSegment(params, points.slice(0, leg[0] + 1), context);
    const after = await routeSegment(params, points.slice(leg[1]), context);
    return [...before, ...after];
  }

  // A server-side failure (the public API's proxy sometimes answers HTTP 500 for a whole
  // itinerary) or a network error: route each half separately, so that only the part that keeps
  // failing is drawn as straight lines.
  const serverSide = failure.status === 0 || failure.status >= 500;
  if (serverSide && points.length > 2 && context.budget > 0) {
    const middle = Math.floor(points.length / 2);
    const before = await routeSegment(params, points.slice(0, middle + 1), context);
    const after = await routeSegment(params, points.slice(middle), context);
    return [...before, ...after];
  }
  if (serverSide && points.length === 2) {
    addOnce(
      context.warnings,
      'No detailed route between ' + stopName(points[0]) + ' and ' + stopName(points[1]) + ', so that leg is drawn as a straight line.'
    );
    addOnce(context.errors, 'OpenRouteService directions failed (HTTP ' + failure.status + '): ' + failure.message);
    return straightLine(points);
  }

  addOnce(context.warnings, 'Detailed route unavailable; drawing straight lines between stops instead.');
  addOnce(context.errors, 'OpenRouteService directions failed (HTTP ' + failure.status + '): ' + failure.message);
  return straightLine(points);
};

/**
 * Route geometry through the ordered points. Itineraries longer than the ORS waypoint limit are
 * requested in consecutive chunks (each starting where the previous one ended) and stitched.
 */
export const fetchRouteGeometry = async (params: RouteGeometryParams): Promise<RouteGeometryResult> => {
  const { points } = params;
  const context: SegmentContext = { tryWiderRadius: true, budget: ORS_MAX_DIRECTIONS_REQUESTS, warnings: [], errors: [] };
  const coordinates: [number, number][] = [];
  if (points.length < 2) return { coordinates: straightLine(points), warnings: [] };
  for (let start = 0; start < points.length - 1; start += ORS_MAX_DIRECTIONS_WAYPOINTS - 1) {
    const chunk = points.slice(start, start + ORS_MAX_DIRECTIONS_WAYPOINTS);
    const geometry = await routeSegment(params, chunk, context);
    coordinates.push(...(coordinates.length > 0 ? geometry.slice(1) : geometry));
  }
  return {
    coordinates,
    warnings: context.warnings,
    error: context.errors.length > 0 ? context.errors.join(' ') : undefined,
  };
};
