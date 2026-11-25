import { CoordinatePoint, OptimizationObjective, SolverMode, TravelMode } from '../types';
import type { Settings, StopsState } from './usePersistentState';

/**
 * Route parameters carried in the page URL (query string), so that a link can open the
 * planner with a given list of stops and options. API keys are never put in the URL.
 *
 *   ?mode=foot-walking&stop=48.8584,2.2945,Eiffel%20Tower&stop=48.8606,2.3376,Louvre&start=1&end=2
 *
 * See README.md ("Link to a route") for the full format.
 */
export interface UrlRoute {
  /** Present only when the URL lists at least one valid stop. */
  stops?: StopsState;
  settings: Partial<Pick<Settings, 'travelMode' | 'solverMode' | 'objective' | 'exactTimeLimitSeconds'>>;
  /** `solve=1`: optimise the route as soon as the page opens. */
  autoSolve: boolean;
}

const TRAVEL_MODE_ALIASES: Record<string, TravelMode> = {
  'driving-car': 'driving-car',
  car: 'driving-car',
  driving: 'driving-car',
  drive: 'driving-car',
  'driving-hgv': 'driving-hgv',
  truck: 'driving-hgv',
  hgv: 'driving-hgv',
  'cycling-regular': 'cycling-regular',
  bike: 'cycling-regular',
  bicycle: 'cycling-regular',
  cycling: 'cycling-regular',
  'cycling-electric': 'cycling-electric',
  'e-bike': 'cycling-electric',
  ebike: 'cycling-electric',
  'foot-walking': 'foot-walking',
  walk: 'foot-walking',
  walking: 'foot-walking',
  foot: 'foot-walking',
  'foot-hiking': 'foot-hiking',
  hike: 'foot-hiking',
  hiking: 'foot-hiking',
  transit: 'transit',
  'public-transport': 'transit',
};

const SOLVER_MODES: SolverMode[] = ['auto', 'exact', 'brute-force', 'heuristic', 'genetic'];
const OBJECTIVES: OptimizationObjective[] = ['distance', 'duration'];
const TRUE_VALUES = ['1', 'true', 'yes', ''];

/** Parses a 1-based stop index ("1" is the first stop); returns a 0-based index or undefined. */
const parseIndex = (value: string | null, count: number): number | undefined => {
  if (value === null) return undefined;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'first') return count ? 0 : undefined;
  if (trimmed === 'last') return count ? count - 1 : undefined;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const index = Number(trimmed) - 1;
  return index >= 0 && index < count ? index : undefined;
};

/** `lat,lng[,label]`; the label may itself contain commas. */
const parseStop = (value: string, position: number, makeId: () => string): CoordinatePoint | undefined => {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,([\s\S]*))?$/);
  if (!match) return undefined;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  const label = match[3]?.trim() || 'Stop ' + position;
  return { id: makeId(), label, latitude, longitude };
};

export const parseRouteUrl = (search: string, makeId: () => string): UrlRoute => {
  const params = new URLSearchParams(search);
  const settings: UrlRoute['settings'] = {};

  const mode = params.get('mode')?.trim().toLowerCase();
  if (mode && TRAVEL_MODE_ALIASES[mode]) settings.travelMode = TRAVEL_MODE_ALIASES[mode];
  const solver = params.get('solver')?.trim().toLowerCase() as SolverMode | undefined;
  if (solver && SOLVER_MODES.includes(solver)) settings.solverMode = solver;
  const objective = params.get('objective')?.trim().toLowerCase() as OptimizationObjective | undefined;
  if (objective && OBJECTIVES.includes(objective)) settings.objective = objective;
  const timeLimit = Number(params.get('timeLimit'));
  if (params.has('timeLimit') && Number.isFinite(timeLimit) && timeLimit > 0) settings.exactTimeLimitSeconds = timeLimit;

  const points: CoordinatePoint[] = [];
  // Indexes in the URL refer to the stops as listed there; invalid stops are dropped, so map them.
  const urlIndexToPoint = new Map<number, number>();
  params.getAll('stop').forEach((value, urlIndex) => {
    const point = parseStop(value, points.length + 1, makeId);
    if (!point) return;
    urlIndexToPoint.set(urlIndex, points.length);
    points.push(point);
  });

  const urlStopCount = params.getAll('stop').length;
  const pointAt = (value: string | null) => {
    const urlIndex = parseIndex(value, urlStopCount);
    const index = urlIndex === undefined ? undefined : urlIndexToPoint.get(urlIndex);
    return index === undefined ? undefined : points[index];
  };

  let stops: StopsState | undefined;
  if (points.length) {
    (params.get('skip') || '')
      .split(',')
      .map((value) => pointAt(value))
      .forEach((point) => point && (point.disabled = true));
    const startId = pointAt(params.get('start'))?.id;
    let endId = pointAt(params.get('end'))?.id;
    if (endId === startId) endId = undefined;
    stops = { points, startId, endId };
  }

  const solve = params.get('solve');
  return { stops, settings, autoSolve: solve !== null && TRUE_VALUES.includes(solve.trim().toLowerCase()) };
};

const formatCoordinate = (value: number) => String(Number(value.toFixed(6)));

/** Keeps commas readable; everything else that needs it is percent-encoded. */
const encode = (value: string) => encodeURIComponent(value).replace(/%2C/gi, ',');

/** Builds the query string (with the leading "?", or "" when there is nothing to share). */
export const buildRouteSearch = (settings: Settings, stops: StopsState): string => {
  const parts: string[] = [
    'mode=' + settings.travelMode,
    'objective=' + settings.objective,
    'solver=' + settings.solverMode,
  ];
  if (settings.solverMode === 'auto' || settings.solverMode === 'exact') parts.push('timeLimit=' + settings.exactTimeLimitSeconds);
  const { points, startId, endId } = stops;
  points.forEach((point) => {
    parts.push('stop=' + formatCoordinate(point.latitude) + ',' + formatCoordinate(point.longitude) + ',' + encode(point.label));
  });
  const position = (id?: string) => (id ? points.findIndex((point) => point.id === id) + 1 : 0);
  if (position(startId)) parts.push('start=' + position(startId));
  if (position(endId)) parts.push('end=' + position(endId));
  const skipped = points.flatMap((point, i) => (point.disabled ? [i + 1] : []));
  if (skipped.length) parts.push('skip=' + skipped.join(','));
  return '?' + parts.join('&');
};

/** Parameters this module owns; anything else already in the URL is left alone. */
const ROUTE_PARAMS = ['mode', 'objective', 'solver', 'timeLimit', 'stop', 'start', 'end', 'skip', 'solve'];

/** Replaces the route parameters of `search`, keeping unrelated ones (e.g. utm_*). */
export const mergeRouteSearch = (search: string, routeSearch: string): string => {
  const others = search
    .replace(/^\?/, '')
    .split('&')
    .filter((part) => part && !ROUTE_PARAMS.includes(decodeURIComponent(part.split('=')[0].replace(/\+/g, ' '))));
  const route = routeSearch.replace(/^\?/, '');
  const all = [...others, ...(route ? route.split('&') : [])];
  return all.length ? '?' + all.join('&') : '';
};
