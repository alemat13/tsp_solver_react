import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ClipboardPaste, Link2, Loader2, LocateFixed, Maximize2, MousePointerClick, Route, Settings2, Sparkles, Trash2, X } from 'lucide-react';
import { MapInsets, MapView } from './components/MapView';
import { Sheet, SheetSnap } from './components/Sheet';
import { StopSearch } from './components/StopSearch';
import { StopList, TripTypeSwitch } from './components/StopList';
import { Leg, ResultView } from './components/ResultView';
import { SettingsDialog } from './components/SettingsDialog';
import { ImportDialog } from './components/ImportDialog';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useGeolocation } from './hooks/useGeolocation';
import { activeStops, newPointId, Settings, usePersistentState } from './state/usePersistentState';
import { GeocodeResult, reverseGeocode } from './services/geocoding';
import { fetchMatrix as fetchORSMatrix, fetchRouteGeometry as fetchORSRouteGeometry } from './services/openRouteService';
import { fetchMatrix as fetchGoogleMatrix, fetchRouteGeometry as fetchGoogleRouteGeometry } from './services/googleMapsService';
import { solveInBackground } from './services/solverClient';
import { describeBruteForceEstimate } from './utils/solverEstimate';
import { TRAVEL_MODES, travelModeOption } from './ui/travelModes';
import { CoordinatePoint, MatrixData, SolveResult, TransitLeg } from './types';
import './App.css';

interface Solution {
  result: SolveResult;
  notes: string[];
  warnings: string[];
  legs: Leg[];
  provider: string;
  geometry: [number, number][];
}

const PROVIDER_LABELS: Record<MatrixData['provider'], string> = {
  openrouteservice: 'OpenRouteService',
  google: 'Google Maps',
  haversine: 'straight-line',
};

const MY_LOCATION_LABEL = 'My location';

const computeLegs = (route: CoordinatePoint[], matrix: MatrixData, points: CoordinatePoint[]): Leg[] => {
  const index = new Map(points.map((point, i) => [point.id, i]));
  return route.slice(0, -1).map((point, i) => {
    const from = index.get(point.id);
    const to = index.get(route[i + 1].id);
    if (from === undefined || to === undefined) return {};
    return { distance: matrix.distances[from]?.[to], duration: matrix.durations?.[from]?.[to] };
  });
};

export const App = () => {
  const [{ settings, stops }, setState, autoSolve] = usePersistentState();
  const { points, startId, endId } = stops;
  // Skipped stops stay in the list but are left out of the matrix, the solver and every export.
  const active = useMemo(() => activeStops(stops), [stops]);
  const desktop = useMediaQuery('(min-width: 900px)');

  const [tab, setTab] = useState<'stops' | 'result'>('stops');
  const [snap, setSnap] = useState<SheetSnap>('half');
  const [sheetCover, setSheetCover] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const [focus, setFocus] = useState<{ id: string; nonce: number }>();
  const geolocation = useGeolocation();
  const [locateRequest, setLocateRequest] = useState(0);

  const [isSolving, setIsSolving] = useState(false);
  const [error, setError] = useState<string>();
  const [solution, setSolution] = useState<Solution>();

  const updateSettings = useCallback(
    (next: Partial<Settings>) => setState((state) => ({ ...state, settings: { ...state.settings, ...next } })),
    [setState]
  );

  const updateStops = useCallback(
    (update: (current: typeof stops) => typeof stops) => setState((state) => ({ ...state, stops: update(state.stops) })),
    [setState]
  );

  // Any change to the problem invalidates the computed route.
  useEffect(() => {
    setSolution(undefined);
    setError(undefined);
    setTab('stops');
  }, [points, startId, endId, settings.travelMode, settings.objective, settings.solverMode]);

  const focusOn = useCallback((id: string) => {
    setFocus({ id, nonce: Date.now() });
    if (!desktop) setSnap((current) => (current === 'full' ? 'half' : current));
  }, [desktop]);

  const addPoint = useCallback(
    (point: Omit<CoordinatePoint, 'id'>) => {
      const id = newPointId();
      updateStops((current) => ({ ...current, points: [...current.points, { ...point, id }] }));
      setFocus({ id, nonce: Date.now() });
      return id;
    },
    [updateStops]
  );

  const handleSearchAdd = (result: GeocodeResult) => {
    addPoint({ label: result.label, latitude: result.latitude, longitude: result.longitude });
  };

  const handleMapAdd = useCallback(
    async (latitude: number, longitude: number) => {
      const id = addPoint({ label: 'Point ' + (points.length + 1), latitude, longitude });
      const name = await reverseGeocode(latitude, longitude);
      if (name) {
        updateStops((current) => ({
          ...current,
          points: current.points.map((point) => (point.id === id ? { ...point, label: name } : point)),
        }));
      }
    },
    [addPoint, points.length, updateStops]
  );

  /** Centre the map on the user (asking for permission the first time). */
  const showMyLocation = () => {
    geolocation
      .start()
      .then(() => setLocateRequest((count) => count + 1))
      .catch(() => undefined);
  };

  /** Add (or move) the "My location" stop to the user's position, optionally as the start. */
  const addMyLocation = async (asStart: boolean) => {
    let position;
    try {
      position = geolocation.position ?? (await geolocation.start());
    } catch {
      return;
    }
    const { latitude, longitude } = position;
    const existing = points.find((point) => point.label === MY_LOCATION_LABEL);
    let id: string;
    if (existing) {
      id = existing.id;
      updateStops((current) => ({
        ...current,
        // Using my location again also brings back a skipped "My location" stop.
        points: current.points.map(({ disabled, ...point }) =>
          point.id === id ? { ...point, latitude, longitude } : disabled ? { ...point, disabled } : point
        ),
      }));
      setFocus({ id, nonce: Date.now() });
    } else {
      id = addPoint({ label: MY_LOCATION_LABEL, latitude, longitude });
    }
    if (asStart) setStart(id);
  };

  const removePoint = (id: string) =>
    updateStops((current) => ({
      points: current.points.filter((point) => point.id !== id),
      startId: current.startId === id ? undefined : current.startId,
      endId: current.endId === id ? undefined : current.endId,
    }));

  const togglePoint = (id: string, enabled: boolean) =>
    updateStops((current) => ({
      ...current,
      points: current.points.map((point) => {
        if (point.id !== id) return point;
        const { disabled: _disabled, ...rest } = point;
        return enabled ? rest : { ...rest, disabled: true };
      }),
    }));

  const setAllEnabled = (enabled: boolean) =>
    updateStops((current) => ({
      ...current,
      points: current.points.map(({ disabled: _disabled, ...rest }) => (enabled ? rest : { ...rest, disabled: true })),
    }));

  const renamePoint = (id: string, label: string) =>
    updateStops((current) => ({ ...current, points: current.points.map((point) => (point.id === id ? { ...point, label } : point)) }));

  const setStart = (id: string | undefined) =>
    updateStops((current) => ({ ...current, startId: id, endId: id && current.endId === id ? undefined : current.endId }));

  const setEnd = (id: string | undefined) =>
    updateStops((current) => ({
      ...current,
      // Ending where we start is a loop.
      endId: id && id === current.startId ? undefined : id,
    }));

  const setLoop = (loop: boolean) => {
    if (loop) {
      setEnd(undefined);
      return;
    }
    const candidate = [...points].reverse().find((point) => point.id !== startId && !point.disabled);
    if (candidate) setEnd(candidate.id);
  };

  const importPoints = (imported: CoordinatePoint[], mode: 'append' | 'replace') => {
    const fresh = imported.map((point) => ({ ...point, id: newPointId() }));
    updateStops((current) => (mode === 'replace' ? { points: fresh } : { ...current, points: [...current.points, ...fresh] }));
    setFitRequest((count) => count + 1);
  };

  const clearAll = () => {
    if (window.confirm('Remove all stops?')) updateStops(() => ({ points: [] }));
  };

  /** Incremented on every solve, so that a late route geometry never overwrites a newer result. */
  const solveToken = useRef(0);

  const solve = async () => {
    const { travelMode, solverMode, objective, googleApiKey, orsApiKey, exactTimeLimitSeconds } = settings;
    const { points, startId, endId } = active;
    const preWarnings: string[] = [];
    const skipped = stops.points.length - points.length;
    if (skipped > 0) preWarnings.push(skipped + ' skipped stop' + (skipped > 1 ? 's' : '') + ' left out of the route.');
    if (active.startDisabled) preWarnings.push('The start stop is skipped, so the route starts at whichever stop is best.');
    if (active.endDisabled) preWarnings.push('The end stop is skipped, so the route is a round trip.');
    if (solverMode === 'brute-force') {
      const estimate = describeBruteForceEstimate(points.length);
      if (!window.confirm('Brute force may take about ' + estimate + '. Continue?')) return;
      preWarnings.push('Brute force: estimated ' + estimate + '.');
    }

    setIsSolving(true);
    setError(undefined);
    setSolution(undefined);
    try {
      const matrixResult =
        travelMode === 'transit'
          ? await fetchGoogleMatrix({ apiKey: googleApiKey, profile: travelMode, points })
          : await fetchORSMatrix({ apiKey: orsApiKey, profile: travelMode, points });
      const { result, notes } = await solveInBackground(
        solverMode,
        { points, matrix: matrixResult.data, startId, endId, objective },
        { exactTimeLimitMs: exactTimeLimitSeconds * 1000 }
      );

      const warnings = [...preWarnings, ...matrixResult.warnings, ...result.warnings];
      if (matrixResult.error) warnings.push(matrixResult.error);

      const legs = computeLegs(result.orderedPoints, matrixResult.data, points);
      const provider = matrixResult.data.provider;
      const solved: Solution = {
        result,
        notes,
        warnings,
        legs,
        provider: PROVIDER_LABELS[provider],
        geometry: result.orderedPoints.map((point) => [point.latitude, point.longitude]),
      };
      // Show the order right away with straight lines; the road geometry follows when it arrives.
      const token = ++solveToken.current;
      setSolution(solved);
      setTab('result');
      setFitRequest((count) => count + 1);
      if (!desktop) setSnap('half');
      setIsSolving(false);

      const key = provider === 'google' ? googleApiKey : orsApiKey;
      if (key && provider !== 'haversine') {
        const routeWarnings: string[] = [];
        let geometry = solved.geometry;
        let transitLegs: (TransitLeg | undefined)[] | undefined;
        try {
          let geometryResult: { coordinates: [number, number][]; warnings: string[]; error?: string };
          if (provider === 'google') {
            const googleResult = await fetchGoogleRouteGeometry({ apiKey: googleApiKey, profile: travelMode, points: result.orderedPoints });
            transitLegs = googleResult.transitLegs;
            geometryResult = googleResult;
          } else {
            geometryResult = await fetchORSRouteGeometry({ apiKey: orsApiKey, profile: travelMode, points: result.orderedPoints });
          }
          if (geometryResult.coordinates.length > 1) geometry = geometryResult.coordinates;
          routeWarnings.push(...geometryResult.warnings);
          if (geometryResult.error) routeWarnings.push(geometryResult.error);
        } catch (routeError) {
          routeWarnings.push('Detailed route geometry unavailable: ' + (routeError instanceof Error ? routeError.message : 'unknown error'));
        }
        // Ignore the answer if the user has solved again (or cleared the result) meanwhile.
        if (token === solveToken.current) {
          setSolution((current) =>
            current === solved
              ? {
                  ...solved,
                  geometry,
                  warnings: [...solved.warnings, ...routeWarnings],
                  legs: legs.map((leg, i) => (transitLegs?.[i] ? { ...leg, transit: transitLegs[i] } : leg)),
                }
              : current
          );
        }
      }
    } catch (solveError) {
      setError(solveError instanceof Error ? solveError.message : 'Unexpected error while solving the route.');
    } finally {
      setIsSolving(false);
    }
  };

  // A link with `solve=1` optimises the route as soon as the page opens (once).
  const autoSolvePending = useRef(autoSolve);
  useEffect(() => {
    if (!autoSolvePending.current) return;
    autoSolvePending.current = false;
    void solve();
  });

  const [linkCopied, setLinkCopied] = useState(false);
  /** The address bar always holds the current route, so sharing it is sharing the route. */
  const shareLink = async () => {
    const url = window.location.href;
    if (!desktop && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'TSP Planner route', url });
        return;
      } catch (shareError) {
        if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setError('Could not copy the link. Copy it from the address bar instead.');
    }
  };

  const insets: MapInsets = useMemo(
    () => (desktop ? { top: 0, right: 56, bottom: 0, left: 0 } : { top: 64, right: 0, bottom: sheetCover, left: 0 }),
    [desktop, sheetCover]
  );

  const isLoop = !endId;
  const mode = travelModeOption(settings.travelMode);
  const missingKey = mode.provider === 'google' ? !settings.googleApiKey : !settings.orsApiKey;
  const activeCount = active.points.length;
  const skippedCount = points.length - activeCount;
  const canSolve = activeCount >= 2 && !isSolving;
  const exportText = points.map((point) => point.latitude.toFixed(6) + ', ' + point.longitude.toFixed(6) + ', ' + point.label).join('\n');

  const header = (
    <div className="panel-header">
      {desktop && (
        <div className="brand">
          <span className="brand__logo"><Route size={20} /></span>
          <span className="brand__name">TSP Planner</span>
          <button type="button" className="icon-button icon-button--ghost brand__settings" onClick={() => setSettingsOpen(true)} aria-label="Settings">
            <Settings2 size={20} />
          </button>
        </div>
      )}
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'stops'} className={tab === 'stops' ? 'is-active' : ''} onClick={() => setTab('stops')}>
          Stops <span className="tabs__count">{skippedCount ? activeCount + '/' + points.length : points.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'result'} className={tab === 'result' ? 'is-active' : ''} onClick={() => setTab('result')} disabled={!solution}>
          Route
        </button>
      </div>
    </div>
  );

  const footer = (
    <div className="solve-bar">
      {missingKey && (
        <button type="button" className="key-hint" onClick={() => setSettingsOpen(true)}>
          {mode.provider === 'google' ? 'Transit needs a Google key' : 'No API key: straight-line distances'} · <u>Add a key</u>
        </button>
      )}
      <button type="button" className="button button--primary button--large button--block" onClick={solve} disabled={!canSolve}>
        {isSolving ? (
          <>
            <Loader2 size={20} className="spin" /> Solving…
          </>
        ) : (
          <>
            <Sparkles size={20} />{' '}
            {activeCount >= 2
              ? 'Optimise ' + activeCount + ' stops'
              : points.length >= 2
                ? 'Include at least 2 stops'
                : 'Add at least 2 stops'}
          </>
        )}
      </button>
    </div>
  );

  const resultFooter = (
    <button type="button" className="button button--block" onClick={() => setTab('stops')}>
      Edit stops
    </button>
  );

  // Fit once the layout (sheet height / side panel) is known.
  useEffect(() => {
    const timer = window.setTimeout(() => setFitRequest((count) => count + 1), 350);
    return () => window.clearTimeout(timer);
  }, [desktop]);

  return (
    <div className={'app' + (desktop ? ' app--desktop' : ' app--mobile')}>
      <div className="app__map">
        <MapView
          points={points}
          route={solution?.result.orderedPoints}
          startId={startId}
          endId={endId}
          polyline={solution?.geometry}
          addMode={addMode}
          onAddPoint={handleMapAdd}
          insets={insets}
          fitRequest={fitRequest}
          focus={focus}
          myLocation={geolocation.position}
          locateRequest={locateRequest}
          onUseMyLocation={addMyLocation}
          stopActions={{ onSetStart: setStart, onSetEnd: setEnd, onRename: renamePoint, onRemove: removePoint, onToggle: togglePoint }}
        />
        {!desktop && (
          <div className="topbar">
            <div className="brand brand--floating">
              <span className="brand__logo"><Route size={18} /></span>
              <span className="brand__name">TSP Planner</span>
            </div>
            <button type="button" className="fab" onClick={() => setSettingsOpen(true)} aria-label="Settings">
              <Settings2 size={20} />
            </button>
          </div>
        )}
        <div className="map-tools" style={desktop ? undefined : { bottom: sheetCover + 12, opacity: snap === 'full' ? 0 : 1, pointerEvents: snap === 'full' ? 'none' : undefined }}>
          <button
            type="button"
            className={'fab' + (geolocation.status === 'on' ? ' fab--located' : '')}
            onClick={showMyLocation}
            aria-label="Show my location"
            title="Show my location"
          >
            {geolocation.status === 'locating' ? <Loader2 className="spin" size={20} /> : <LocateFixed size={20} />}
          </button>
          <button
            type="button"
            className={'fab' + (addMode ? ' fab--active' : '')}
            onClick={() => setAddMode((value) => !value)}
            aria-pressed={addMode}
            aria-label="Add stops by tapping the map"
            title="Add stops by tapping the map"
          >
            {addMode ? <X size={20} /> : <MousePointerClick size={20} />}
          </button>
          <button type="button" className="fab" onClick={() => setFitRequest((count) => count + 1)} aria-label="Show all stops" title="Show all stops" disabled={!points.length}>
            <Maximize2 size={20} />
          </button>
        </div>
        {addMode && <div className="map-banner" style={desktop ? undefined : { top: 72 }}>Tap the map to add a stop</div>}
        {!addMode && geolocation.error && (
          <button type="button" className="map-banner map-banner--error" style={desktop ? undefined : { top: 72 }} onClick={geolocation.clearError}>
            {geolocation.error}
          </button>
        )}
      </div>

      <Sheet docked={desktop} snap={snap} onSnapChange={setSnap} onCoverChange={setSheetCover} header={header} footer={tab === 'stops' ? footer : resultFooter}>
        {tab === 'stops' && (
          <div className="stops-tab">
            <StopSearch
              orsApiKey={settings.orsApiKey}
              focus={points.length ? [points[points.length - 1].latitude, points[points.length - 1].longitude] : undefined}
              onAdd={handleSearchAdd}
              onLocate={() => addMyLocation(!startId)}
              locating={geolocation.status === 'locating'}
              onFocusChange={(focused) => focused && !desktop && setSnap('full')}
            />
            {error && <div className="callout callout--error">{error}</div>}
            {points.length === 0 ? (
              <div className="empty">
                <p className="empty__title">Where are you going?</p>
                <p>Search for an address, tap the map with <MousePointerClick size={14} /> (or long-press it), or import a list of coordinates.</p>
                <div className="empty__actions">
                  <button type="button" className="button" onClick={() => addMyLocation(true)} disabled={geolocation.status === 'locating'}>
                    {geolocation.status === 'locating' ? <Loader2 className="spin" size={16} /> : <LocateFixed size={16} />} Start from my location
                  </button>
                  <button type="button" className="button" onClick={() => setImportOpen(true)}>
                    <ClipboardPaste size={16} /> Import a list
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="modes" role="radiogroup" aria-label="Travel mode">
                  {TRAVEL_MODES.map((option) => {
                    const Icon = option.icon;
                    const active = option.value === settings.travelMode;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={'mode' + (active ? ' is-active' : '')}
                        onClick={() => updateSettings({ travelMode: option.value })}
                        title={option.label}
                      >
                        <Icon size={18} aria-hidden />
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="stops-toolbar">
                  <TripTypeSwitch isLoop={isLoop} onChange={setLoop} disabled={points.length < 2} />
                  <button
                    type="button"
                    className={'icon-button' + (linkCopied ? ' icon-button--done' : '')}
                    onClick={shareLink}
                    aria-label={linkCopied ? 'Link copied' : 'Share a link to this route'}
                    title={linkCopied ? 'Link copied' : 'Share a link to this route'}
                  >
                    {linkCopied ? <Check size={18} /> : <Link2 size={18} />}
                  </button>
                  <button type="button" className="icon-button" onClick={() => setImportOpen(true)} aria-label="Import a list" title="Import / export a list">
                    <ClipboardPaste size={18} />
                  </button>
                  <button type="button" className="icon-button" onClick={clearAll} aria-label="Remove all stops" title="Remove all stops">
                    <Trash2 size={18} />
                  </button>
                </div>
                <p className="trip-summary">
                  {isLoop
                    ? startId
                      ? 'Round trip: starts and ends at “' + points.find((p) => p.id === startId)?.label + '”.'
                      : 'Round trip back to the start (pick it with ⋮ if needed).'
                    : 'One way to “' + points.find((p) => p.id === endId)?.label + '”' + (startId ? ', from “' + points.find((p) => p.id === startId)?.label + '”.' : ', from any stop.')}
                </p>
                {(active.startDisabled || active.endDisabled) && (
                  <div className="callout callout--warning">
                    {active.startDisabled && active.endDisabled
                      ? 'Start and end are skipped: the route will be a round trip from the best stop.'
                      : active.startDisabled
                        ? 'The start is skipped: the route will start at whichever stop is best.'
                        : 'The end is skipped: the route will be a round trip until you include it again.'}
                  </div>
                )}
                {skippedCount > 0 && (
                  <div className="stops-skipped">
                    <span>
                      {skippedCount} skipped stop{skippedCount > 1 ? 's' : ''}, not in the route
                    </span>
                    <button type="button" className="link-button" onClick={() => setAllEnabled(true)}>
                      Include all
                    </button>
                  </div>
                )}
                <StopList
                  points={points}
                  startId={startId}
                  endId={endId}
                  onSetStart={setStart}
                  onSetEnd={setEnd}
                  onRename={renamePoint}
                  onRemove={removePoint}
                  onToggle={togglePoint}
                  onFocus={focusOn}
                />
              </>
            )}
          </div>
        )}
        {tab === 'result' && solution && (
          <ResultView
            result={solution.result}
            legs={solution.legs}
            notes={solution.notes}
            warnings={solution.warnings}
            matrixProvider={solution.provider}
            routeCoordinates={solution.geometry}
            travelMode={settings.travelMode}
            onFocus={focusOn}
          />
        )}
      </Sheet>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onChange={updateSettings} pointCount={activeCount} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} hasStops={points.length > 0} onImport={importPoints} exportText={exportText} />
    </div>
  );
};

export default App;
