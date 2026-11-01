import { SolveResult } from '../types';

export const formatDistance = (meters: number | undefined): string => {
  if (meters === undefined || !Number.isFinite(meters)) return '–';
  if (meters < 1000) return Math.round(meters) + ' m';
  const km = meters / 1000;
  return (km >= 100 ? km.toFixed(0) : km.toFixed(1)) + ' km';
};

export const formatDuration = (seconds: number | undefined): string => {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return '–';
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return minutes + ' min';
  return hours + ' h ' + String(minutes).padStart(2, '0') + ' min';
};

export const formatCoords = (latitude: number, longitude: number) => latitude.toFixed(5) + ', ' + longitude.toFixed(5);

export type OptimalityKind = 'optimal' | 'bounded' | 'unknown';

export const describeOptimality = (result: SolveResult): { kind: OptimalityKind; label: string } => {
  if (result.provenOptimal) return { kind: 'optimal', label: 'Proven optimal' };
  const value = result.objectiveValue ?? result.totalDistance;
  if (typeof result.lowerBound === 'number' && value > 0) {
    const gap = Math.max(0, (value - result.lowerBound) / value);
    return { kind: 'bounded', label: 'Within ' + (gap * 100).toFixed(1) + '% of optimal' };
  }
  return { kind: 'unknown', label: 'Good route (not proven optimal)' };
};

export const STRATEGY_LABELS: Record<SolveResult['strategy'], string> = {
  exact: 'Exact',
  'brute-force': 'Brute force',
  heuristic: 'Heuristic',
  genetic: 'Genetic',
};
