export type TravelMode =
  | 'driving-car'
  | 'driving-hgv'
  | 'cycling-regular'
  | 'cycling-electric'
  | 'foot-walking'
  | 'foot-hiking';

export interface CoordinatePoint {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
}

export type DistanceMatrix = number[][];

export interface MatrixData {
  distances: DistanceMatrix;
  durations?: DistanceMatrix;
  profile: TravelMode;
  sourceIds: string[];
  destinationIds: string[];
  provider: 'openrouteservice' | 'haversine';
}

export interface SolveRequest {
  points: CoordinatePoint[];
  matrix: MatrixData;
  startId?: string;
  endId?: string;
}

export interface SolveResult {
  orderedPoints: CoordinatePoint[];
  orderedIds: string[];
  totalDistance: number;
  totalDuration?: number;
  strategy: 'brute-force' | 'heuristic';
  warnings: string[];
}

export type SolverMode = 'auto' | 'brute-force' | 'heuristic';
