import { activeStops, loadPersistedState, STORAGE_KEY } from '../usePersistentState';

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

describe('skipped stops', () => {
  beforeEach(() => window.localStorage.clear());

  const point = (id: string, disabled?: boolean) => ({ id, label: id.toUpperCase(), latitude: 1, longitude: 2, ...(disabled ? { disabled } : {}) });

  it('keeps the disabled flag across reloads and drops junk values', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ stops: { points: [point('a', true), { ...point('b'), disabled: 'yes' }, point('c')] } })
    );
    const { points } = loadPersistedState().stops;
    expect(points.map((p) => p.disabled)).toEqual([true, undefined, undefined]);
    expect('disabled' in points[1]).toBe(false);
  });

  it('leaves skipped stops out of the solved problem', () => {
    const active = activeStops({ points: [point('a'), point('b', true), point('c')], startId: 'a', endId: 'c' });
    expect(active.points.map((p) => p.id)).toEqual(['a', 'c']);
    expect(active).toMatchObject({ startId: 'a', endId: 'c', startDisabled: false, endDisabled: false });
  });

  it('ignores a skipped start or end until it is included again', () => {
    const skippedStart = activeStops({ points: [point('a', true), point('b'), point('c')], startId: 'a', endId: 'c' });
    expect(skippedStart).toMatchObject({ startId: undefined, endId: 'c', startDisabled: true, endDisabled: false });

    const skippedEnd = activeStops({ points: [point('a'), point('b'), point('c', true)], startId: 'a', endId: 'c' });
    expect(skippedEnd).toMatchObject({ startId: 'a', endId: undefined, startDisabled: false, endDisabled: true });
  });
});
