import { CoordinatePoint, DistanceMatrix } from '../types';

const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export const haversineDistance = (a: CoordinatePoint, b: CoordinatePoint): number => {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);

  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);

  const computation = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  const angularDistance = 2 * Math.atan2(Math.sqrt(computation), Math.sqrt(1 - computation));

  return EARTH_RADIUS_KM * angularDistance * 1000; // convert to meters
};

export const buildHaversineMatrix = (points: CoordinatePoint[]): DistanceMatrix => {
  const size = points.length;
  const matrix: DistanceMatrix = Array.from({ length: size }, () => Array(size).fill(0));

  for (let i = 0; i < size; i += 1) {
    for (let j = i + 1; j < size; j += 1) {
      const distance = haversineDistance(points[i], points[j]);
      matrix[i][j] = distance;
      matrix[j][i] = distance;
    }
  }

  return matrix;
};
