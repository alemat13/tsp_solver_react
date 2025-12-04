import { solveHeuristic } from '../heuristic';
import { CoordinatePoint, SolveRequest } from '../../types';

describe('heuristic', () => {
  const points: CoordinatePoint[] = [
    { id: 'a', label: 'A', latitude: 0, longitude: 0 },
    { id: 'b', label: 'B', latitude: 0, longitude: 1 },
    { id: 'c', label: 'C', latitude: 1, longitude: 1 },
    { id: 'd', label: 'D', latitude: 1, longitude: 0 },
  ];

  const getManhattanDistance = (p1: CoordinatePoint, p2: CoordinatePoint) => {
    return Math.abs(p1.latitude - p2.latitude) + Math.abs(p1.longitude - p2.longitude);
  };

  const matrix = {
    distances: points.map((p1) => points.map((p2) => getManhattanDistance(p1, p2))),
    durations: points.map((p1) => points.map((p2) => getManhattanDistance(p1, p2))),
  };

  it('should return a valid path', () => {
    const request: SolveRequest = { points, matrix };
    const { orderedPoints, totalDistance } = solveHeuristic(request);
    expect(orderedPoints[0].id).toBe('a');
    expect(orderedPoints[orderedPoints.length - 1].id).toBe('a');
    expect(orderedPoints.length).toBe(points.length + 1);
    expect(new Set(orderedPoints.map((p) => p.id))).toEqual(new Set(points.map((p) => p.id)));
    expect(totalDistance).toBeCloseTo(4);
  });

  it('should handle a single point', () => {
    const singlePoint = [points[0]];
    const singlePointMatrix = {
      distances: singlePoint.map((p1) => singlePoint.map((p2) => getManhattanDistance(p1, p2))),
      durations: singlePoint.map((p1) => singlePoint.map((p2) => getManhattanDistance(p1, p2))),
    };
    const request: SolveRequest = { points: singlePoint, matrix: singlePointMatrix };
    const { orderedPoints, totalDistance } = solveHeuristic(request);
    expect(orderedPoints.map((p) => p.id)).toEqual(['a']);
    expect(totalDistance).toBe(0);
  });

  it('should handle two points', () => {
    const twoPoints = [points[0], points[1]];
    const twoPointsMatrix = {
      distances: twoPoints.map((p1) => twoPoints.map((p2) => getManhattanDistance(p1, p2))),
      durations: twoPoints.map((p1) => twoPoints.map((p2) => getManhattanDistance(p1, p2))),
    };
    const request: SolveRequest = { points: twoPoints, matrix: twoPointsMatrix };
    const { orderedPoints, totalDistance } = solveHeuristic(request);
    expect(orderedPoints.map((p) => p.id)).toEqual(['a', 'b', 'a']);
    expect(totalDistance).toBeCloseTo(2);
  });

  it('should handle a fixed start and end point', () => {
    const request: SolveRequest = { points, matrix, startId: 'a', endId: 'd' };
    const { orderedPoints, totalDistance } = solveHeuristic(request);
    expect(orderedPoints.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(totalDistance).toBeCloseTo(3);
  });

  it('should handle a fixed start point', () => {
    const request: SolveRequest = { points, matrix, startId: 'b' };
    const { orderedPoints, totalDistance } = solveHeuristic(request);
    expect(orderedPoints.map((p) => p.id)).toEqual(['b', 'a', 'd', 'c', 'b']);
    expect(totalDistance).toBeCloseTo(4);
  });
});
