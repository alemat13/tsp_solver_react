export type TravelMode =
  | 'driving-car'
  | 'driving-hgv'
  | 'cycling-regular'
  | 'cycling-electric'
  | 'foot-walking'
  | 'foot-hiking'
  | 'transit';

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
  provider: 'openrouteservice' | 'haversine' | 'google';
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
  strategy: 'brute-force' | 'exact' | 'heuristic' | 'genetic';
  warnings: string[];
  /** Proven lower bound on the optimal distance (exact solvers). */
  lowerBound?: number;
  /** True when the route is proven optimal. */
  provenOptimal?: boolean;
}

export type SolverMode = 'auto' | 'exact' | 'brute-force' | 'heuristic' | 'genetic';
