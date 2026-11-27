import { CoordinatePoint } from '../types';
import { haversineDistance } from './distance';

/** A total made of routed legs plus estimates for the legs the routing service could not route. */
export interface EstimatedTotal {
  total: number;
  /** Sum of the legs returned by the routing service. */
  routed: number;
  /** Sum of the estimates for the other legs (0 when every leg was routed). */
  estimated: number;
}

export interface LegValues {
  distance?: number;
  duration?: number;
}

/** Roads are rarely straight: an unrouted leg is assumed this much longer than the straight line. */
export const DETOUR_FACTOR = 1.3;
/** Speed used for unrouted legs when no routed leg gives one (metres per second, ~40 km/h). */
const FALLBACK_SPEED = 11;

const known = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * Totals of an itinerary (`route` in visiting order, `legs[i]` from route[i] to route[i + 1]).
 * A leg without a distance is estimated from the straight line times DETOUR_FACTOR; a leg without
 * a duration from its distance at the average speed of the routed legs. Returns no duration when
 * no leg has one (straight-line provider).
 */
export const estimateTotals = (
  route: CoordinatePoint[],
  legs: LegValues[]
): { distance: EstimatedTotal; duration?: EstimatedTotal; perLeg: { distance: number; duration: number }[] } => {
  const distance: EstimatedTotal = { total: 0, routed: 0, estimated: 0 };
  const duration: EstimatedTotal = { total: 0, routed: 0, estimated: 0 };
  let speedDistance = 0;
  let speedDuration = 0;
  for (const leg of legs) {
    if (known(leg.distance) && known(leg.duration) && leg.duration > 0) {
      speedDistance += leg.distance;
      speedDuration += leg.duration;
    }
  }
  const speed = speedDuration > 0 ? speedDistance / speedDuration : FALLBACK_SPEED;
  const hasDurations = legs.some((leg) => known(leg.duration));

  const perLeg: { distance: number; duration: number }[] = [];
  legs.forEach((leg, i) => {
    const from = route[i];
    const to = route[i + 1];
    let legDistance = leg.distance;
    if (known(legDistance)) distance.routed += legDistance;
    else {
      legDistance = from && to ? haversineDistance(from, to) * DETOUR_FACTOR : 0;
      distance.estimated += legDistance;
    }
    const legDuration = known(leg.duration) ? leg.duration : legDistance / speed;
    if (known(leg.duration)) duration.routed += legDuration;
    else duration.estimated += legDuration;
    perLeg.push({ distance: legDistance, duration: legDuration });
  });
  distance.total = distance.routed + distance.estimated;
  duration.total = duration.routed + duration.estimated;
  return { distance, duration: hasDurations ? duration : undefined, perLeg };
};
