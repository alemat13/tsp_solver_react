import { describe, expect, it } from 'vitest';
import { solveBruteForce } from '../bruteForce';
import { solveExact } from '../exact';
import { solveGenetic } from '../genetic';
import { solveHeuristic } from '../heuristic';
import { solveHeldKarpPath } from '../heldKarp';
import { buildPathProblem, pathCost } from '../pathProblem';
import { CoordinatePoint, MatrixData, SolveRequest } from '../../types';

const createRandom = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

const buildRequest = (size: number, seed: number, asymmetric = false): SolveRequest => {
  const random = createRandom(seed);
  const points: CoordinatePoint[] = Array.from({ length: size }, (_, i) => ({
    id: 'p' + i,
    label: 'P' + i,
    latitude: random() * 100,
    longitude: random() * 100,
  }));
  const distances = points.map((a) =>
    points.map((b) => Math.hypot(a.latitude - b.latitude, a.longitude - b.longitude) * (asymmetric && a.id < b.id ? 1.3 : 1))
  );
  const matrix: MatrixData = {
    distances,
    profile: 'driving-car',
    provider: 'haversine',
    sourceIds: points.map((p) => p.id),
    destinationIds: points.map((p) => p.id),
  };
  return { points, matrix };
};

const variants = (request: SolveRequest): [string, SolveRequest][] => [
  ['loop', request],
  ['loop with start', { ...request, startId: 'p2' }],
  ['loop start = end', { ...request, startId: 'p2', endId: 'p2' }],
  ['open path start -> end', { ...request, startId: 'p1', endId: 'p4' }],
  ['open path, end only', { ...request, endId: 'p4' }],
];

const checkShape = (request: SolveRequest, ids: string[]) => {
  const n = request.points.length;
  const isLoop = request.endId === undefined || request.endId === request.startId;
  expect(new Set(ids).size).toBe(n);
  expect(ids.length).toBe(isLoop ? n + 1 : n);
  if (isLoop) expect(ids[0]).toBe(ids[ids.length - 1]);
  if (request.startId) expect(ids[0]).toBe(request.startId);
  if (request.endId) expect(ids[ids.length - 1]).toBe(request.endId);
};

describe('exact solver (Held-Karp)', () => {
  for (const asymmetric of [false, true]) {
    for (const [name, request] of variants(buildRequest(8, 7, asymmetric))) {
      it(`matches brute force: ${name}${asymmetric ? ' (asymmetric)' : ''}`, () => {
        const exact = solveExact(request);
        const brute = solveBruteForce(request);
        checkShape(request, exact.orderedIds);
        expect(exact.totalDistance).toBeCloseTo(brute.totalDistance, 6);
      });
    }
  }

  it('solves 17 points quickly', () => {
    const request = buildRequest(17, 3);
    const started = Date.now();
    const result = solveExact(request);
    checkShape(request, result.orderedIds);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('heuristic and genetic solvers', () => {
  for (const asymmetric of [false, true]) {
    for (const [name, request] of variants(buildRequest(14, 11, asymmetric))) {
      it(`return valid near-optimal routes: ${name}${asymmetric ? ' (asymmetric)' : ''}`, () => {
        const optimum = solveExact(request).totalDistance;
        // Fixed iteration budget (no wall-clock limit) so the result does not depend on machine load.
        const heuristic = solveHeuristic(request, { timeLimitMs: Number.POSITIVE_INFINITY, maxIterations: 300 });
        const genetic = solveGenetic(request);
        checkShape(request, heuristic.orderedIds);
        checkShape(request, genetic.orderedIds);
        expect(heuristic.totalDistance).toBeLessThanOrEqual(optimum * 1.02 + 1e-9);
        // The genetic solver uses Math.random: keep a margin so the test is not flaky.
        expect(genetic.totalDistance).toBeLessThanOrEqual(optimum * 1.2 + 1e-9);
      });
    }
  }

  it('Held-Karp path cost equals the reported optimum', () => {
    const request = buildRequest(10, 5);
    const problem = buildPathProblem(request);
    const path = solveHeldKarpPath(problem);
    expect(pathCost(path, problem.cost)).toBeCloseTo(solveExact(request).totalDistance, 6);
  });
});

describe('objective and unreachable pairs', () => {
  it('optimises travel time when asked', async () => {
    const { solveWithMode } = await import('../solve');
    const request = buildRequest(9, 21);
    // Durations favour a different order than distances.
    const durations = request.matrix.distances.map((row, i) => row.map((value, j) => (i === j ? 0 : ((i * 7 + j * 3) % 11) + 1)));
    const withDurations = { ...request, matrix: { ...request.matrix, durations } };
    const byTime = await solveWithMode('exact', { ...withDurations, objective: 'duration' });
    const byDistance = await solveWithMode('exact', withDurations);
    expect(byTime.result.totalDuration).toBeLessThanOrEqual(byDistance.result.totalDuration as number);
    expect(byTime.result.objectiveValue).toBeCloseTo(byTime.result.totalDuration as number, 6);
    expect(byTime.notes.join(' ')).toContain('travel time');
    const bruteByTime = await solveWithMode('brute-force', { ...withDurations, objective: 'duration' });
    expect(bruteByTime.result.objectiveValue).toBeCloseTo(byTime.result.objectiveValue as number, 6);
  });

  it('avoids unreachable legs (Infinity) when an alternative exists', () => {
    const request = buildRequest(8, 4);
    const distances = request.matrix.distances.map((row) => row.slice());
    distances[0][1] = Infinity;
    distances[1][0] = Infinity;
    const blocked = { ...request, matrix: { ...request.matrix, distances } };
    for (const result of [solveExact(blocked), solveHeuristic(blocked)]) {
      expect(Number.isFinite(result.totalDistance)).toBe(true);
    }
  });
});
