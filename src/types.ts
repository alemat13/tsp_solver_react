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

export type OptimizationObjective = 'distance' | 'duration';

export interface SolveRequest {
  points: CoordinatePoint[];
  matrix: MatrixData;
  startId?: string;
  endId?: string;
  /** What to minimise; 'duration' needs matrix.durations (falls back to distance). */
  objective?: OptimizationObjective;
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
  /** Value of the minimised objective (distance or duration) for this route. */
  objectiveValue?: number;
  /** True when the route is proven optimal. */
  provenOptimal?: boolean;
}

export type SolverMode = 'auto' | 'exact' | 'brute-force' | 'heuristic' | 'genetic';

/** One public-transport ride within a leg. */
export interface TransitRide {
  /** Short line name shown on vehicles ("42", "M1"); falls back to the long name. */
  line: string;
  lineName?: string;
  /** Line colour (#rrggbb) and text colour, when the agency publishes them. */
  color?: string;
  textColor?: string;
  /** Google vehicle type: BUS, SUBWAY, TRAM, RAIL, HEAVY_RAIL, FERRY, ... */
  vehicleType?: string;
  /** Localised vehicle name ("Bus", "Subway"). */
  vehicleName?: string;
  headsign?: string;
  agency?: string;
  agencyUrl?: string;
  departureStop?: string;
  arrivalStop?: string;
  /** RFC 3339 timestamps. */
  departureTime?: string;
  arrivalTime?: string;
  /** Local clock times as Google formats them for the stop's time zone ("1:05 PM", "13:05"). */
  departureText?: string;
  arrivalText?: string;
  stopCount?: number;
}

export interface TransitStep {
  kind: 'walk' | 'transit';
  /** Seconds. */
  duration?: number;
  /** Metres. */
  distance?: number;
  ride?: TransitRide;
}

export interface TransitLeg {
  /** Seconds, including waits. */
  duration?: number;
  /** Metres. */
  distance?: number;
  steps: TransitStep[];
}
