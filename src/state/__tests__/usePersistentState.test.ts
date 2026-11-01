import { loadPersistedState, STORAGE_KEY } from '../usePersistentState';

describe('loadPersistedState', () => {
  beforeEach(() => window.localStorage.clear());

  it('returns defaults when nothing is stored', () => {
    const state = loadPersistedState();
    expect(state.stops.points).toEqual([]);
    expect(state.settings.travelMode).toBe('driving-car');
  });

  it('migrates the legacy text-based storage', () => {
    window.localStorage.setItem(
      'tsp-solver-settings-v1',
      JSON.stringify({ rawInput: '48.85837, 2.29448, Tour Eiffel\n48.86061, 2.33764, Louvre', orsApiKey: 'abc', objective: 'duration' })
    );
    const state = loadPersistedState();
    expect(state.stops.points.map((point) => point.label)).toEqual(['Tour Eiffel', 'Louvre']);
    expect(state.settings.orsApiKey).toBe('abc');
    expect(state.settings.objective).toBe('duration');
  });

  it('drops invalid points and dangling start/end ids', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        settings: { travelMode: 'teleport' },
        stops: { points: [{ id: 'a', label: 'A', latitude: 1, longitude: 2 }, { id: 'b' }], startId: 'a', endId: 'zzz' },
      })
    );
    const state = loadPersistedState();
    expect(state.stops.points).toHaveLength(1);
    expect(state.stops.startId).toBe('a');
    expect(state.stops.endId).toBeUndefined();
    expect(state.settings.travelMode).toBe('driving-car');
  });
});
