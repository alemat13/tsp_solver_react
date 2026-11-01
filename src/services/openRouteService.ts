import { CoordinatePoint, MatrixData, TravelMode } from '../types';
import { buildHaversineMatrix } from '../utils/distance';

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
  // ORS caps a matrix request at ORS_MAX_MATRIX_ELEMENTS cells (sources x destinations):
  // larger inputs are split into blocks of source rows, each against every destination.
  const rowsPerRequest = Math.max(1, Math.floor(ORS_MAX_MATRIX_ELEMENTS / size));
  const distances: number[][] = [];
  const durations: number[][] = [];
  let durationsComplete = true;

  for (let first = 0; first < size; first += rowsPerRequest) {
    const sources = Array.from({ length: Math.min(rowsPerRequest, size - first) }, (_, k) => first + k);
    const body: Record<string, unknown> = {
      locations,
      metrics: ['distance', 'duration'],
      units: 'm',
    };
    if (sources.length < size) body.sources = sources;

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
        error: 'OpenRouteService responded with status ' + response.status + ': ' + errorText,
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
    distances.push(...blockDistances);
    if (isValidResponseMatrix(blockDurations) && blockDurations.length === sources.length) {
      durations.push(...blockDurations);
    } else {
      durationsComplete = false;
    }
  }

  if (!isValidResponseMatrix(distances)) {
    const fallback = buildFallbackMatrix(params);
    return {
      data: fallback.data,
      warnings: fallback.warnings,
      error: 'OpenRouteService matrix payload was invalid or incomplete.',
    };
  }

  const data: MatrixData = {
    distances,
    durations: durationsComplete ? durations : undefined,
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

const fetchRouteGeometryChunk = async (params: RouteGeometryParams): Promise<RouteGeometryResult> => {
  const { apiKey, profile, points } = params;

  if (points.length < 2) {
    return { coordinates: points.map((point) => [point.latitude, point.longitude]), warnings: [] };
  }

  const coordinates = points.map((point) => [point.longitude, point.latitude]);

  const response = await fetch(ORS_DIRECTIONS_URL + profile, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({
      coordinates,
      instructions: false,
      units: 'm',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return {
      coordinates: points.map((point) => [point.latitude, point.longitude]),
      warnings: ['Falling back to straight-line geometry while fetching detailed route.'],
      error: 'OpenRouteService directions responded with status ' + response.status + ': ' + errorText,
    };
  }

  const payload = await response.json();
  const route = payload?.routes?.[0];
  const geometryPayload = route?.geometry;
  let geometry: [number, number][] | undefined;
  let warnings: string[] = [];

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
    return {
      coordinates: points.map((point) => [point.latitude, point.longitude]),
      warnings: [...warnings, 'Detailed route geometry unavailable; displaying straight-line approximation.'],
      error: 'OpenRouteService directions response did not contain usable geometry.',
    };
  }

  // Drop consecutive duplicates only: a loop legitimately revisits its first coordinate.
  geometry = geometry.filter((pair, index) => {
    if (index === 0) return true;
    const previous = geometry![index - 1];
    return pair[0].toFixed(6) !== previous[0].toFixed(6) || pair[1].toFixed(6) !== previous[1].toFixed(6);
  });

  return {
    coordinates: geometry,
    warnings,
  };
};

/**
 * Route geometry through the ordered points. Itineraries longer than the ORS waypoint limit are
 * requested in consecutive chunks (each starting where the previous one ended) and stitched.
 */
export const fetchRouteGeometry = async (params: RouteGeometryParams): Promise<RouteGeometryResult> => {
  const { points } = params;
  if (points.length <= ORS_MAX_DIRECTIONS_WAYPOINTS) {
    return fetchRouteGeometryChunk(params);
  }
  const coordinates: [number, number][] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  for (let start = 0; start < points.length - 1; start += ORS_MAX_DIRECTIONS_WAYPOINTS - 1) {
    const chunk = points.slice(start, start + ORS_MAX_DIRECTIONS_WAYPOINTS);
    const result = await fetchRouteGeometryChunk({ ...params, points: chunk });
    coordinates.push(...(coordinates.length > 0 ? result.coordinates.slice(1) : result.coordinates));
    warnings.push(...result.warnings.filter((warning) => !warnings.includes(warning)));
    if (result.error) errors.push(result.error);
  }
  return { coordinates, warnings, error: errors.length > 0 ? errors.join(' ') : undefined };
};
