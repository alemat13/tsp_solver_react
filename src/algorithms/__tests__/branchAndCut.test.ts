import { describe, expect, it } from 'vitest';
import highsLoader from 'highs';
import { HighsLike, solveBranchAndCut } from '../branchAndCut';
import { solveExact } from '../exact';
import { buildPathProblem } from '../pathProblem';
import { solveWithMode } from '../solve';
import { CoordinatePoint, SolveRequest } from '../../types';

const loadHighs = () => highsLoader() as unknown as Promise<HighsLike>;

const buildRequest = (size: number, seed: number, asymmetric = false): SolveRequest => {
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const points: CoordinatePoint[] = Array.from({ length: size }, (_, i) => ({
    id: 'p' + i,
    label: 'P' + i,
    latitude: random() * 100,
    longitude: random() * 100,
  }));
  const distances = points.map((a) =>
    points.map((b) => Math.round(Math.hypot(a.latitude - b.latitude, a.longitude - b.longitude) * 100 * (asymmetric && a.id < b.id ? 1.25 : 1)))
  );
  return {
    points,
    matrix: { distances, profile: 'driving-car', provider: 'haversine', sourceIds: [], destinationIds: [] },
  };
};

describe('branch-and-cut (HiGHS)', () => {
  const cases: [string, Partial<SolveRequest>][] = [
    ['loop', {}],
    ['open path start -> end', { startId: 'p1', endId: 'p6' }],
    ['open path, end only', { endId: 'p6' }],
  ];
  for (const asymmetric of [false, true]) {
    for (const [name, extra] of cases) {
      it(`matches Held-Karp: ${name}${asymmetric ? ' (asymmetric)' : ''}`, async () => {
        const request = { ...buildRequest(14, 17, asymmetric), ...extra };
        const outcome = solveBranchAndCut(buildPathProblem(request), await loadHighs(), { timeLimitMs: 30000 });
        expect(outcome.provenOptimal).toBe(true);
        expect(outcome.cost).toBeCloseTo(solveExact(request).totalDistance, 6);
      });
    }
  }

  it('proves optimality on 40 points through solveWithMode', async () => {
    const request = { ...buildRequest(40, 5), startId: 'p0', endId: 'p9' };
    const { result, notes } = await solveWithMode('exact', request, { loadHighs });
    expect(result.provenOptimal).toBe(true);
    expect(result.strategy).toBe('exact');
    expect(result.orderedIds[0]).toBe('p0');
    expect(result.orderedIds[result.orderedIds.length - 1]).toBe('p9');
    expect(new Set(result.orderedIds).size).toBe(40);
    expect(notes[0]).toContain('optimal');
  }, 60000);

  it('falls back to the heuristic when HiGHS cannot be loaded', async () => {
    const request = buildRequest(25, 9);
    const { result } = await solveWithMode('exact', request, { loadHighs: () => Promise.reject(new Error('offline')) });
    expect(result.strategy).toBe('heuristic');
    expect(result.warnings.join(' ')).toContain('HiGHS');
    expect(result.orderedIds.length).toBe(26);
  });
});
