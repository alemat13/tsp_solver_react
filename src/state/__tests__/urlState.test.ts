import { buildRouteSearch, mergeRouteSearch, parseRouteUrl } from '../urlState';
import { DEFAULT_SETTINGS, loadInitialState, STORAGE_KEY } from '../usePersistentState';

let counter = 0;
const makeId = () => 'id' + counter++;

describe('parseRouteUrl', () => {
  beforeEach(() => (counter = 0));

  it('reads stops, start, end, skipped stops and options', () => {
    const route = parseRouteUrl(
      '?mode=walk&objective=duration&solver=exact&timeLimit=30' +
        '&stop=48.8584,2.2945,Eiffel%20Tower&stop=48.8606,2.3376,Louvre,%20Paris&stop=48.853,2.3499&start=2&end=3&skip=1&solve=1',
      makeId
    );
    expect(route.settings).toEqual({ travelMode: 'foot-walking', objective: 'duration', solverMode: 'exact', exactTimeLimitSeconds: 30 });
    expect(route.stops!.points.map((p) => [p.label, p.latitude, p.longitude, !!p.disabled])).toEqual([
      ['Eiffel Tower', 48.8584, 2.2945, true],
      ['Louvre, Paris', 48.8606, 2.3376, false],
      ['Stop 3', 48.853, 2.3499, false],
    ]);
    expect(route.stops!.startId).toBe('id1');
    expect(route.stops!.endId).toBe('id2');
    expect(route.autoSolve).toBe(true);
  });

  it('ignores invalid stops and values, keeping indexes relative to the URL', () => {
    const route = parseRouteUrl('?mode=teleport&stop=abc&stop=95,2,Nope&stop=1,2,A&stop=3,4,B&start=4&end=last&solver=magic', makeId);
    expect(route.settings).toEqual({});
    expect(route.stops!.points.map((p) => p.label)).toEqual(['A', 'B']);
    expect(route.stops!.startId).toBe(route.stops!.points[1].id);
    // end=last is the same stop as the start: a loop.
    expect(route.stops!.endId).toBeUndefined();
    expect(route.autoSolve).toBe(false);
  });

  it('accepts + as a space and has no stops when none are given', () => {
    expect(parseRouteUrl('?stop=1,2,Gare+de+Lyon', makeId).stops!.points[0].label).toBe('Gare de Lyon');
    expect(parseRouteUrl('?mode=car', makeId).stops).toBeUndefined();
  });
});

describe('buildRouteSearch', () => {
  it('round-trips through parseRouteUrl', () => {
    const settings = { ...DEFAULT_SETTINGS, travelMode: 'transit' as const, orsApiKey: 'secret-ors', googleApiKey: 'secret-google' };
    const stops = {
      points: [
        { id: 'a', label: 'Café & Co, 12 rue #3', latitude: 48.123456789, longitude: -2.5 },
        { id: 'b', label: 'B', latitude: 0, longitude: 0, disabled: true },
        { id: 'c', label: 'C', latitude: -33.9, longitude: 151.2 },
      ],
      startId: 'c',
      endId: 'a',
    };
    const search = buildRouteSearch(settings, stops);
    expect(search).not.toContain('secret');
    expect(search).toContain('stop=48.123457,-2.5,Caf%C3%A9%20%26%20Co,%2012%20rue%20%233');
    const back = parseRouteUrl(search, makeId);
    expect(back.settings.travelMode).toBe('transit');
    expect(back.stops!.points.map((p) => p.label)).toEqual(['Café & Co, 12 rue #3', 'B', 'C']);
    expect(back.stops!.points[1].disabled).toBe(true);
    expect(back.stops!.startId).toBe(back.stops!.points[2].id);
    expect(back.stops!.endId).toBe(back.stops!.points[0].id);
  });
});

describe('mergeRouteSearch', () => {
  it('keeps unrelated parameters and drops solve', () => {
    expect(mergeRouteSearch('?utm_source=app&solve=1&stop=1,2', '?mode=driving-car')).toBe('?utm_source=app&mode=driving-car');
  });
});

describe('loadInitialState', () => {
  beforeEach(() => window.localStorage.clear());

  it('lets URL stops replace saved ones but keeps saved API keys', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        settings: { ...DEFAULT_SETTINGS, orsApiKey: 'k', travelMode: 'foot-hiking' },
        stops: { points: [{ id: 'x', label: 'Saved', latitude: 1, longitude: 1 }] },
      })
    );
    const { state, autoSolve } = loadInitialState('?mode=bike&stop=1,2,From%20link&stop=3,4&solve');
    expect(state.settings.orsApiKey).toBe('k');
    expect(state.settings.travelMode).toBe('cycling-regular');
    expect(state.stops.points.map((p) => p.label)).toEqual(['From link', 'Stop 2']);
    expect(autoSolve).toBe(true);
  });

  it('keeps the saved stops when the URL has none', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ settings: DEFAULT_SETTINGS, stops: { points: [{ id: 'x', label: 'Saved', latitude: 1, longitude: 1 }] } })
    );
    const { state, autoSolve } = loadInitialState('?solve=1');
    expect(state.stops.points[0].label).toBe('Saved');
    expect(autoSolve).toBe(false);
  });
});
