import { CoordinatePoint, MatrixData, TravelMode } from '../types';
import { buildHaversineMatrix } from '../utils/distance';

const ORS_BASE_URL = 'https://api.openrouteservice.org/v2/matrix/';

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

  const body = {
    locations,
    metrics: ['distance', 'duration'],
    units: 'm',
  };

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
  const distances = payload && payload.distances;
  const durations = payload && payload.durations;

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
    durations: isValidResponseMatrix(durations) ? durations : undefined,
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
