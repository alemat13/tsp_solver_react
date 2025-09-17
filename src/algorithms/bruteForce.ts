import { SolveRequest, SolveResult } from '../types';
import { computeTotals, deriveResult } from './common';

export const solveBruteForce = (request: SolveRequest): SolveResult => {
  const { points, matrix, startId, endId } = request;
  const size = points.length;
  if (size < 2) {
    return {
      orderedPoints: points,
      orderedIds: points.map((point) => point.id),
      totalDistance: 0,
      totalDuration: 0,
      strategy: 'brute-force',
      warnings: ['Provide at least two locations to optimise an itinerary.'],
    };
  }

  const idToIndex = new Map<string, number>();
  points.forEach((point, index) => {
    idToIndex.set(point.id, index);
  });

  const startIndex = startId ? idToIndex.get(startId) : undefined;
  const endIndex = endId ? idToIndex.get(endId) : undefined;

  const indices = points.map((_, index) => index);
  const startCandidates =
    typeof startIndex === 'number'
      ? [startIndex]
      : indices.filter((index) => (typeof endIndex === 'number' ? index !== endIndex : true));

  const fixedEnd = typeof endIndex === 'number' ? endIndex : undefined;

  let bestRoute: number[] | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestDuration: number | undefined;

  const visit = (current: number[], remaining: number[]) => {
    if (remaining.length === 0) {
      const completeRoute = fixedEnd !== undefined && current[current.length - 1] !== fixedEnd
        ? current.concat([fixedEnd])
        : current.slice();

      const totals = computeTotals(completeRoute, matrix.distances, matrix.durations);
      if (totals.totalDistance < bestDistance) {
        bestDistance = totals.totalDistance;
        bestDuration = totals.totalDuration;
        bestRoute = completeRoute;
      }
      return;
    }

    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];
      if (fixedEnd !== undefined && candidate === fixedEnd && remaining.length > 1) {
        continue;
      }

      const nextRemaining = remaining.slice(0, i).concat(remaining.slice(i + 1));
      visit(current.concat([candidate]), nextRemaining);
    }
  };

  startCandidates.forEach((start) => {
    const baseRemaining = indices.filter((index) => index !== start && index !== fixedEnd);
    const initialRoute = [start];

    if (fixedEnd !== undefined && start === fixedEnd) {
      return;
    }

    if (baseRemaining.length === 0) {
      const finalRoute = fixedEnd !== undefined ? initialRoute.concat([fixedEnd]) : initialRoute;
      const totals = computeTotals(finalRoute, matrix.distances, matrix.durations);
      if (totals.totalDistance < bestDistance) {
        bestDistance = totals.totalDistance;
        bestDuration = totals.totalDuration;
        bestRoute = finalRoute;
      }
      return;
    }

    const initialRemaining = baseRemaining.concat(fixedEnd !== undefined ? [fixedEnd] : []);
    visit(initialRoute, initialRemaining);
  });

  const resolvedRoute = bestRoute || indices;
  const totals = computeTotals(resolvedRoute, matrix.distances, matrix.durations);

  return deriveResult(points, resolvedRoute, {
    totalDistance: bestDistance === Number.POSITIVE_INFINITY ? totals.totalDistance : bestDistance,
    totalDuration: bestDuration === undefined ? totals.totalDuration : bestDuration,
  }, 'brute-force', []);
};
