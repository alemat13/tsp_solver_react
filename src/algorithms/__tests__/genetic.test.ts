import { solveGenetic, orderCrossover } from '../genetic';
import { SolveRequest, MatrixData } from '../../types';

// Helper to create a simple distance matrix for n points where distance is 1 between different points
const createDistanceMatrix = (n: number): number[][] => {
  const matrix: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const row: number[] = [];
    for (let j = 0; j < n; j += 1) {
      row.push(i === j ? 0 : 1);
    }
    matrix.push(row);
  }
  return matrix;
};

const points = [
  { id: 'a', label: 'A', latitude: 0, longitude: 0 },
  { id: 'b', label: 'B', latitude: 0, longitude: 1 },
  { id: 'c', label: 'C', latitude: 1, longitude: 0 },
  { id: 'd', label: 'D', latitude: 1, longitude: 1 },
];

const matrix: MatrixData = {
  distances: createDistanceMatrix(points.length),
  durations: undefined,
  profile: 'driving-car' as const,
  sourceIds: points.map(p => p.id),
  destinationIds: points.map(p => p.id),
  provider: 'haversine',
};

describe('genetic algorithm', () => {
  it('returns a valid route for a simple problem', () => {
    const request: SolveRequest = {
      points,
      matrix,
    };
    const result = solveGenetic(request);
    // Should return all points exactly once (or looped if start/end not fixed)
    expect(result.orderedIds.length).toBe(points.length);
    const uniqueIds = new Set(result.orderedIds);
    expect(uniqueIds.size).toBe(points.length);
    // Total distance should be a finite number
    expect(result.totalDistance).toBeGreaterThanOrEqual(0);
  });

  it('orderCrossover produces a valid permutation', () => {
    const parent1 = [0, 1, 2, 3];
    const parent2 = [3, 2, 1, 0];
    const child = orderCrossover(parent1, parent2);
    expect(child.length).toBe(parent1.length);
    const set = new Set(child);
    expect(set.size).toBe(parent1.length);
    // All values should be within the original range
    for (const v of child) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(parent1.length);
    }
  });

  it('handles identical start and end points without error', () => {
    const request: SolveRequest = {
      points,
      matrix,
      startId: points[0].id,
      endId: points[0].id,
    };
    const result = solveGenetic(request);
    // Should return a closed loop: start appears at both start and end
    expect(result.orderedIds.length).toBe(points.length + 1);
    expect(result.orderedIds[0]).toBe(points[0].id);
    expect(result.orderedIds[result.orderedIds.length - 1]).toBe(points[0].id);
    const uniqueIds = new Set(result.orderedIds);
    expect(uniqueIds.size).toBe(points.length);
    // No undefined entries
    expect(result.orderedIds).not.toContain(undefined);
  });
});
