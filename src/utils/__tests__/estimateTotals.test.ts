import { describe, expect, it } from 'vitest';
import { DETOUR_FACTOR, estimateTotals } from '../estimateTotals';
import { haversineDistance } from '../distance';

const a = { id: 'a', label: 'A', latitude: 43.0, longitude: 6.0 };
const b = { id: 'b', label: 'B', latitude: 43.1, longitude: 6.0 };
const c = { id: 'c', label: 'C', latitude: 43.1, longitude: 6.1 };

describe('estimateTotals', () => {
  it('adds nothing when every leg is routed', () => {
    const totals = estimateTotals([a, b, c], [{ distance: 1000, duration: 100 }, { distance: 2000, duration: 200 }]);
    expect(totals.distance).toEqual({ total: 3000, routed: 3000, estimated: 0 });
    expect(totals.duration).toEqual({ total: 300, routed: 300, estimated: 0 });
  });

  it('estimates unrouted legs from the straight line and the routed average speed', () => {
    const totals = estimateTotals([a, b, c], [{ distance: 1000, duration: 100 }, { distance: Infinity, duration: Infinity }]);
    const estimatedDistance = haversineDistance(b, c) * DETOUR_FACTOR;
    expect(totals.distance.routed).toBe(1000);
    expect(totals.distance.estimated).toBeCloseTo(estimatedDistance);
    expect(totals.duration?.routed).toBe(100);
    expect(totals.duration?.estimated).toBeCloseTo(estimatedDistance / 10); // 10 m/s routed average
  });

  it('gives no duration when no leg has one', () => {
    expect(estimateTotals([a, b], [{ distance: 1000 }]).duration).toBeUndefined();
  });
});
