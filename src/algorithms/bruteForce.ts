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

  const startIndex = typeof startId === 'string' ? idToIndex.get(startId) : undefined;
  const endIndex = typeof endId === 'string' ? idToIndex.get(endId) : undefined;
  const isLoopRoute = typeof startIndex === 'number' && typeof endIndex === 'number' && startIndex === endIndex;

  const indices = points.map((_, index) => index);

  const startCandidates =
    typeof startIndex === 'number'
      ? [startIndex]
      : indices.filter((index) => (typeof endIndex === 'number' ? index !== endIndex : true));

  const fixedEnd = !isLoopRoute && typeof endIndex === 'number' ? endIndex : undefined;

  let bestRoute: number[] | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestDuration: number | undefined;
  const resultWarnings: string[] = [];

  if (isLoopRoute && size > 1) {
    resultWarnings.push('Start and end points are identical; treating itinerary as a loop.');
  }

  const visit = (current: number[], remaining: number[], loopStart?: number) => {
    if (remaining.length === 0) {
      let completeRoute: number[];
      if (isLoopRoute) {
        const startNode = loopStart ?? current[0];
        completeRoute = current[current.length - 1] === startNode ? current.slice() : current.concat([startNode]);
      } else if (fixedEnd !== undefined && current[current.length - 1] !== fixedEnd) {
        completeRoute = current.concat([fixedEnd]);
      } else {
        completeRoute = current.slice();
      }

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
      if (!isLoopRoute && fixedEnd !== undefined && candidate === fixedEnd && remaining.length > 1) {
        continue;
      }

      const nextRemaining = remaining.slice(0, i).concat(remaining.slice(i + 1));
      visit(current.concat([candidate]), nextRemaining, loopStart);
    }
  };

  startCandidates.forEach((start) => {
    if (!isLoopRoute && fixedEnd !== undefined && start === fixedEnd) {
      return;
    }

    const baseRemaining = indices.filter((index) => index !== start && index !== fixedEnd);
    const initialRoute = [start];

    if (baseRemaining.length === 0) {
      let finalRoute = initialRoute.slice();
      if (isLoopRoute && finalRoute[finalRoute.length - 1] !== start) {
        finalRoute = finalRoute.concat([start]);
      } else if (!isLoopRoute && fixedEnd !== undefined && finalRoute[finalRoute.length - 1] !== fixedEnd) {
        finalRoute = finalRoute.concat([fixedEnd]);
      }

      const totals = computeTotals(finalRoute, matrix.distances, matrix.durations);
      if (totals.totalDistance < bestDistance) {
        bestDistance = totals.totalDistance;
        bestDuration = totals.totalDuration;
        bestRoute = finalRoute;
      }
      return;
    }

    const initialRemaining = fixedEnd !== undefined ? baseRemaining.concat([fixedEnd]) : baseRemaining.slice();
    visit(initialRoute, initialRemaining, start);
  });

  let resolvedRoute: number[];
  if (bestRoute) {
    resolvedRoute = bestRoute.slice();
  } else {
    resolvedRoute = indices.slice();
    if (!isLoopRoute && fixedEnd !== undefined && resolvedRoute[resolvedRoute.length - 1] !== fixedEnd) {
      resolvedRoute.push(fixedEnd);
    }
    if (isLoopRoute && resolvedRoute.length > 0 && resolvedRoute[resolvedRoute.length - 1] !== resolvedRoute[0]) {
      resolvedRoute.push(resolvedRoute[0]);
    }
  }

  const totals = computeTotals(resolvedRoute, matrix.distances, matrix.durations);
  const finalTotals = {
    totalDistance: bestDistance === Number.POSITIVE_INFINITY ? totals.totalDistance : bestDistance,
    totalDuration: bestDuration === undefined ? totals.totalDuration : bestDuration,
  };

  return deriveResult(points, resolvedRoute, finalTotals, 'brute-force', resultWarnings);
};
