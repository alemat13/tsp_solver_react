import { CoordinatePoint } from '../types';

/**
 * Stops that the routing service cannot connect to most other stops: typically a stop on an
 * island, or far from any road usable with the chosen travel mode. A stop counts as cut off
 * when more than half of its pairs (in either direction) have no route.
 */
export const findCutOffStops = (points: CoordinatePoint[], distances: number[][]): CoordinatePoint[] => {
  const size = points.length;
  if (size < 3) return [];
  return points.filter((_, i) => {
    let missing = 0;
    for (let j = 0; j < size; j += 1) {
      if (j === i) continue;
      if (!Number.isFinite(distances[i]?.[j]) || !Number.isFinite(distances[j]?.[i])) missing += 1;
    }
    return missing > (size - 1) / 2;
  });
};
