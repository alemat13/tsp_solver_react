import { describe, expect, it } from 'vitest';
import { solveHeuristic } from '../heuristic';
import { CoordinatePoint, SolveRequest } from '../../types';

/**
 * Regression: 29 stops along the Riviera, three of them on an island that a car cannot reach.
 * ORS returns metre distances with decimals and null for the island legs, which the solvers
 * price with a large penalty. Rounding errors in the local search's prefix sums then made a
 * move and its inverse both look improving, and the search looped forever.
 */
const buildIslandRequest = (seed: number): SolveRequest => {
  let state = seed;
  const random = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  const points: CoordinatePoint[] = Array.from({ length: 29 }, (_, i) => ({
    id: 'p' + i,
    label: 'P' + i,
    latitude: 43 + random() * 0.8,
    longitude: 6 + random() * 1.5,
  }));
  const island = (i: number) => i >= 25 && i <= 27;
  const distances = points.map((a, i) =>
    points.map((b, j) => {
      if (i === j) return 0;
      if (island(i) !== island(j) || (island(i) && (i === 26 || j === 26))) return Infinity;
      const metres = Math.hypot((a.latitude - b.latitude) * 111_000, (a.longitude - b.longitude) * 80_000);
      return Math.round(metres * (1.2 + random() * 0.4) * 10) / 10;
    })
  );
  return {
    points,
    startId: 'p28',
    matrix: { distances, profile: 'driving-car', provider: 'openrouteservice', sourceIds: [], destinationIds: [] },
  };
};

describe('local search with unreachable stops', () => {
  it('terminates quickly on large penalties with decimal distances', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const started = Date.now();
      const result = solveHeuristic(buildIslandRequest(seed), { timeLimitMs: 200 });
      expect(result.orderedIds).toHaveLength(30); // round trip: start repeated at the end
      expect(Date.now() - started).toBeLessThan(5000);
    }
  });
});
