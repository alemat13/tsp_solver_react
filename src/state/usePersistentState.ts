import { useEffect, useState } from 'react';
import { CoordinatePoint, OptimizationObjective, SolverMode, TravelMode } from '../types';
import { parseCoordinateLines } from '../utils/coordinateParser';

export interface Settings {
  googleApiKey: string;
  orsApiKey: string;
  travelMode: TravelMode;
  solverMode: SolverMode;
  objective: OptimizationObjective;
  exactTimeLimitSeconds: number;
}

export interface StopsState {
  points: CoordinatePoint[];
  startId?: string;
  /** No end means a loop back to the start. */
  endId?: string;
}

export interface PersistedState {
  settings: Settings;
  stops: StopsState;
}

export const DEFAULT_SETTINGS: Settings = {
  googleApiKey: '',
  orsApiKey: '',
  travelMode: 'driving-car',
  solverMode: 'auto',
  objective: 'distance',
  exactTimeLimitSeconds: 15,
};

export const STORAGE_KEY = 'tsp-solver-state-v2';
const LEGACY_STORAGE_KEY = 'tsp-solver-settings-v1';

const isTravelMode = (value: unknown): value is TravelMode =>
  ['driving-car', 'driving-hgv', 'cycling-regular', 'cycling-electric', 'foot-walking', 'foot-hiking', 'transit'].includes(value as string);
const isSolverMode = (value: unknown): value is SolverMode =>
  ['auto', 'exact', 'brute-force', 'heuristic', 'genetic'].includes(value as string);

const sanitizeSettings = (value: Partial<Settings> | undefined): Settings => ({
  googleApiKey: typeof value?.googleApiKey === 'string' ? value.googleApiKey : '',
  orsApiKey: typeof value?.orsApiKey === 'string' ? value.orsApiKey : '',
  travelMode: isTravelMode(value?.travelMode) ? value!.travelMode : 'driving-car',
  solverMode: isSolverMode(value?.solverMode) ? value!.solverMode : 'auto',
  objective: value?.objective === 'duration' ? 'duration' : 'distance',
  exactTimeLimitSeconds:
    typeof value?.exactTimeLimitSeconds === 'number' && value.exactTimeLimitSeconds > 0 ? value.exactTimeLimitSeconds : 15,
});

const isPoint = (value: unknown): value is CoordinatePoint => {
  const point = value as CoordinatePoint;
  return !!point && typeof point.id === 'string' && typeof point.label === 'string' &&
    Number.isFinite(point.latitude) && Number.isFinite(point.longitude);
};

const sanitizeStops = (value: Partial<StopsState> | undefined): StopsState => {
  const points = (Array.isArray(value?.points) ? value!.points.filter(isPoint) : []).map(({ disabled, ...point }) =>
    disabled === true ? { ...point, disabled: true } : point
  );
  const has = (id?: string) => !!id && points.some((point) => point.id === id);
  return {
    points,
    startId: has(value?.startId) ? value!.startId : undefined,
    endId: has(value?.endId) ? value!.endId : undefined,
  };
};

export interface ActiveStops {
  /** Stops that take part in the route (disabled ones left out). */
  points: CoordinatePoint[];
  /** Start/end actually used: a disabled start or end is ignored until it is re-enabled. */
  startId?: string;
  endId?: string;
  startDisabled: boolean;
  endDisabled: boolean;
}

/** The part of the stop list that is sent to the matrix and the solver. */
export const activeStops = ({ points, startId, endId }: StopsState): ActiveStops => {
  const active = points.filter((point) => !point.disabled);
  const isActive = (id?: string) => !!id && active.some((point) => point.id === id);
  const startDisabled = !!startId && !isActive(startId);
  const endDisabled = !!endId && !isActive(endId);
  const start = startDisabled ? undefined : startId;
  let end = endDisabled ? undefined : endId;
  // A one-way trip ending where it starts would be a loop.
  if (end && end === start) end = undefined;
  return { points: active, startId: start, endId: end, startDisabled, endDisabled };
};

const readStorage = (key: string): unknown => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
};

export const loadPersistedState = (): PersistedState => {
  if (typeof window === 'undefined') return { settings: DEFAULT_SETTINGS, stops: { points: [] } };
  const current = readStorage(STORAGE_KEY) as Partial<PersistedState> | undefined;
  if (current) {
    return { settings: sanitizeSettings(current.settings), stops: sanitizeStops(current.stops) };
  }
  // Migrate the previous text-based format (raw "lat, lon, label" lines).
  const legacy = readStorage(LEGACY_STORAGE_KEY) as (Partial<Settings> & { rawInput?: string }) | undefined;
  if (legacy) {
    const points = legacy.rawInput ? parseCoordinateLines(legacy.rawInput).points : [];
    return { settings: sanitizeSettings(legacy), stops: { points } };
  }
  return { settings: DEFAULT_SETTINGS, stops: { points: [] } };
};

/** Keeps settings and stops in React state and mirrors them to localStorage. */
export const usePersistentState = () => {
  const [state, setState] = useState<PersistedState>(loadPersistedState);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage may be unavailable (private mode, quota); the app keeps working in memory.
    }
  }, [state]);

  return [state, setState] as const;
};

let idCounter = 0;
export const newPointId = () => 'p-' + Date.now().toString(36) + '-' + (idCounter++).toString(36);
