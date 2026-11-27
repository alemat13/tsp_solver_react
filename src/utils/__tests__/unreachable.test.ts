import { describe, expect, it } from 'vitest';
import { findCutOffStops } from '../unreachable';

const points = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: id.toUpperCase(), latitude: 0, longitude: 0 }));
const I = Infinity;

describe('findCutOffStops', () => {
  it('flags stops with no route to most other stops, in either direction', () => {
    const distances = [
      [0, 1, 1, I, 1],
      [1, 0, 1, I, I],
      [1, 1, 0, I, 1],
      [I, I, I, 0, I],
      [1, I, 1, 1, 0], // e -> d exists but d -> e does not
    ];
    expect(findCutOffStops(points, distances).map((point) => point.id)).toEqual(['d']);
  });

  it('ignores a single missing pair', () => {
    const distances: number[][] = points.map((_, i) => points.map((__, j) => (i === j ? 0 : 1)));
    distances[0][1] = I;
    expect(findCutOffStops(points, distances)).toEqual([]);
  });
});
