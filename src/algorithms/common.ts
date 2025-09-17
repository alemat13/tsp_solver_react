import { CoordinatePoint, SolveResult } from '../types';

export interface Totals {
  totalDistance: number;
  totalDuration?: number;
}

export const computeTotals = (route: number[], distances: number[][], durations?: number[][]): Totals => {
  let totalDistance = 0;
  let totalDuration: number | undefined;

  if (durations) {
    totalDuration = 0;
  }

  for (let i = 0; i < route.length - 1; i += 1) {
    const from = route[i];
    const to = route[i + 1];
    totalDistance += distances[from][to];
    if (durations && typeof totalDuration === 'number') {
      totalDuration += durations[from][to];
    }
  }

  return { totalDistance, totalDuration };
};

export const deriveResult = (
  points: CoordinatePoint[],
  route: number[],
  totals: Totals,
  strategy: SolveResult['strategy'],
  warnings: string[]
): SolveResult => {
  const orderedPoints = route.map((index) => points[index]);
  const orderedIds = orderedPoints.map((point) => point.id);

  return {
    orderedPoints,
    orderedIds,
    totalDistance: totals.totalDistance,
    totalDuration: totals.totalDuration,
    strategy,
    warnings,
  };
};
