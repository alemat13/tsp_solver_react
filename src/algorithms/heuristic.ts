import { SolveRequest, SolveResult } from '../types';
import { computeTotals, deriveResult } from './common';

const computeAverageDistances = (distances: number[][]): number[] => {
  const averages: number[] = new Array(distances.length).fill(0);
  for (let i = 0; i < distances.length; i += 1) {
    let sum = 0;
    for (let j = 0; j < distances.length; j += 1) {
      if (i === j) {
        continue;
      }
      sum += distances[i][j];
    }
    averages[i] = sum / Math.max(1, distances.length - 1);
  }
  return averages;
};

const generateStartCandidates = (
  distances: number[][],
  fixedStart: number | undefined,
  fixedEnd: number | undefined
): number[] => {
  if (typeof fixedStart === 'number') {
    return [fixedStart];
  }

  const size = distances.length;
  const indices = Array.from({ length: size }, (_, index) => index).filter((index) => index !== fixedEnd);
  if (indices.length === 0) {
    return fixedEnd !== undefined ? [fixedEnd] : [0];
  }

  const averages = computeAverageDistances(distances);
  const sortedByAverage = indices.slice().sort((a, b) => averages[a] - averages[b]);

  const candidateSet: number[] = [];
  const addCandidate = (index?: number) => {
    if (typeof index !== 'number') {
      return;
    }
    if (candidateSet.includes(index)) {
      return;
    }
    candidateSet.push(index);
  };

  addCandidate(sortedByAverage[0]);
  addCandidate(sortedByAverage[sortedByAverage.length - 1]);
  addCandidate(sortedByAverage[Math.floor(sortedByAverage.length / 2)]);

  for (let i = 0; i < sortedByAverage.length && candidateSet.length < 5; i += 1) {
    addCandidate(sortedByAverage[i]);
  }

  return candidateSet;
};

const buildNearestNeighbourRoute = (size: number, distances: number[][], startIndex: number, fixedEnd?: number): number[] => {
  const unvisited = new Set<number>();
  for (let i = 0; i < size; i += 1) {
    if (i !== startIndex && (typeof fixedEnd !== 'number' || i !== fixedEnd)) {
      unvisited.add(i);
    }
  }

  const route: number[] = [startIndex];

  while (unvisited.size > 0) {
    const current = route[route.length - 1];
    let bestCandidate: number | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    unvisited.forEach((candidate) => {
      if (typeof fixedEnd === 'number' && candidate === fixedEnd && unvisited.size > 1) {
        return;
      }
      const distance = distances[current][candidate];
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCandidate = candidate;
      }
    });

    if (bestCandidate === undefined) {
      break;
    }

    route.push(bestCandidate);
    unvisited.delete(bestCandidate);
  }

  if (typeof fixedEnd === 'number' && route[route.length - 1] !== fixedEnd) {
    route.push(fixedEnd);
  }

  return route;
};

const twoOptSwap = (route: number[], i: number, k: number): number[] => {
  const start = route.slice(0, i);
  const middle = route.slice(i, k + 1).reverse();
  const end = route.slice(k + 1);
  return start.concat(middle, end);
};

const optimiseWithTwoOpt = (route: number[], distances: number[][], iterations: number, lockedStart?: boolean, lockedEnd?: boolean): number[] => {
  let improved = route.slice();

  for (let pass = 0; pass < iterations; pass += 1) {
    let improvementMade = false;
    for (let i = 1; i < improved.length - 2; i += 1) {
      if (lockedStart && i === 1) {
        continue;
      }
      for (let k = i + 1; k < improved.length - 1; k += 1) {
        if (lockedEnd && k + 1 >= improved.length - 1) {
          continue;
        }
        const a = improved[i - 1];
        const b = improved[i];
        const c = improved[k];
        const d = improved[k + 1];

        const currentDistance = distances[a][b] + distances[c][d];
        const swappedDistance = distances[a][c] + distances[b][d];

        if (swappedDistance < currentDistance - 1e-6) {
          improved = twoOptSwap(improved, i, k);
          improvementMade = true;
        }
      }
    }
    if (!improvementMade) {
      break;
    }
  }

  return improved;
};

export const solveHeuristic = (request: SolveRequest): SolveResult => {
  const { points, matrix, startId, endId } = request;
  const size = points.length;

  if (size < 2) {
    return {
      orderedPoints: points,
      orderedIds: points.map((point) => point.id),
      totalDistance: 0,
      totalDuration: 0,
      strategy: 'heuristic',
      warnings: ['Provide at least two locations to optimise an itinerary.'],
    };
  }

  const idToIndex = new Map<string, number>();
  points.forEach((point, index) => {
    idToIndex.set(point.id, index);
  });

  const fixedStart = startId ? idToIndex.get(startId) : undefined;
  const fixedEnd = endId ? idToIndex.get(endId) : undefined;

  if (typeof fixedStart === 'number' && typeof fixedEnd === 'number' && fixedStart === fixedEnd && size > 1) {
    const warnings = ['Start and end points are identical; treating itinerary as a loop.'];
    const startIndex = fixedStart;
    const initialRoute = buildNearestNeighbourRoute(size, matrix.distances, startIndex);
    const improvedRoute = optimiseWithTwoOpt(initialRoute, matrix.distances, 12, true, true);
    const totals = computeTotals(improvedRoute.concat([startIndex]), matrix.distances, matrix.durations);
    const loopRoute = improvedRoute.concat([startIndex]);
    return deriveResult(points, loopRoute, totals, 'heuristic', warnings);
  }

  const lockedStart = typeof fixedStart === 'number';
  const lockedEnd = typeof fixedEnd === 'number';

  const candidateStarts = generateStartCandidates(matrix.distances, fixedStart, fixedEnd);

  let bestRoute: number[] | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestTotals = { totalDistance: Number.POSITIVE_INFINITY, totalDuration: undefined as number | undefined };

  candidateStarts.forEach((startIndex) => {
    const baseRoute = buildNearestNeighbourRoute(size, matrix.distances, startIndex, fixedEnd);
    const refinedRoute = optimiseWithTwoOpt(baseRoute.slice(), matrix.distances, 24, lockedStart, lockedEnd);
    const totals = computeTotals(refinedRoute, matrix.distances, matrix.durations);

    if (totals.totalDistance < bestScore) {
      bestScore = totals.totalDistance;
      bestRoute = refinedRoute;
      bestTotals = totals;
    }
  });

  const route = bestRoute || buildNearestNeighbourRoute(size, matrix.distances, candidateStarts[0], fixedEnd);
  const totals = bestRoute ? bestTotals : computeTotals(route, matrix.distances, matrix.durations);

  const warnings: string[] = candidateStarts.length > 1 ? ['Heuristic evaluated multiple starting tours to refine the route.'] : [];

  return deriveResult(points, route, totals, 'heuristic', warnings);
};
