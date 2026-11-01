import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardPaste, Loader2, Maximize2, MousePointerClick, Route, Settings2, Sparkles, Trash2, X } from 'lucide-react';
import { MapInsets, MapView } from './components/MapView';
import { Sheet, SheetSnap } from './components/Sheet';
import { StopSearch } from './components/StopSearch';
import { StopList, TripTypeSwitch } from './components/StopList';
import { Leg, ResultView } from './components/ResultView';
import { SettingsDialog } from './components/SettingsDialog';
import { ImportDialog } from './components/ImportDialog';
import { useMediaQuery } from './hooks/useMediaQuery';
import { newPointId, Settings, usePersistentState } from './state/usePersistentState';
import { GeocodeResult, reverseGeocode } from './services/geocoding';
import { fetchMatrix as fetchORSMatrix, fetchRouteGeometry as fetchORSRouteGeometry } from './services/openRouteService';
import { fetchMatrix as fetchGoogleMatrix, fetchRouteGeometry as fetchGoogleRouteGeometry } from './services/googleMapsService';
import { solveInBackground } from './services/solverClient';
import { describeBruteForceEstimate } from './utils/solverEstimate';
import { TRAVEL_MODES, travelModeOption } from './ui/travelModes';
import { CoordinatePoint, MatrixData, SolveResult } from './types';
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
  const [{ settings, stops }, setState] = usePersistentState();
  const { points, startId, endId } = stops;
  const desktop = useMediaQuery('(min-width: 900px)');

  const [tab, setTab] = useState<'stops' | 'result'>('stops');
  const [snap, setSnap] = useState<SheetSnap>('half');
  const [sheetCover, setSheetCover] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const [focus, setFocus] = useState<{ id: string; nonce: number }>();

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

  const removePoint = (id: string) =>
    updateStops((current) => ({
      points: current.points.filter((point) => point.id !== id),
      startId: current.startId === id ? undefined : current.startId,
      endId: current.endId === id ? undefined : current.endId,
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
    const candidate = [...points].reverse().find((point) => point.id !== startId);
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

  const solve = async () => {
    const { travelMode, solverMode, objective, googleApiKey, orsApiKey, exactTimeLimitSeconds } = settings;
    const preWarnings: string[] = [];
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

      let geometry: [number, number][] = result.orderedPoints.map((point) => [point.latitude, point.longitude]);
      const provider = matrixResult.data.provider;
      const key = provider === 'google' ? googleApiKey : orsApiKey;
      if (key && provider !== 'haversine') {
        try {
          const geometryResult =
            provider === 'google'
              ? await fetchGoogleRouteGeometry({ apiKey: googleApiKey, profile: travelMode, points: result.orderedPoints })
              : await fetchORSRouteGeometry({ apiKey: orsApiKey, profile: travelMode, points: result.orderedPoints });
          if (geometryResult.coordinates.length > 1) geometry = geometryResult.coordinates;
          warnings.push(...geometryResult.warnings);
          if (geometryResult.error) warnings.push(geometryResult.error);
        } catch (routeError) {
          warnings.push('Detailed route geometry unavailable: ' + (routeError instanceof Error ? routeError.message : 'unknown error'));
        }
      }

      setSolution({
        result,
        notes,
        warnings,
        legs: computeLegs(result.orderedPoints, matrixResult.data, points),
        provider: PROVIDER_LABELS[provider],
        geometry,
      });
      setTab('result');
      setFitRequest((count) => count + 1);
      if (!desktop) setSnap('half');
    } catch (solveError) {
      setError(solveError instanceof Error ? solveError.message : 'Unexpected error while solving the route.');
    } finally {
      setIsSolving(false);
    }
  };

  const insets: MapInsets = useMemo(
    () => (desktop ? { top: 0, right: 56, bottom: 0, left: 0 } : { top: 64, right: 0, bottom: sheetCover, left: 0 }),
    [desktop, sheetCover]
  );

  const isLoop = !endId;
  const mode = travelModeOption(settings.travelMode);
  const missingKey = mode.provider === 'google' ? !settings.googleApiKey : !settings.orsApiKey;
  const canSolve = points.length >= 2 && !isSolving;
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
          Stops <span className="tabs__count">{points.length}</span>
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
            <Sparkles size={20} /> {points.length < 2 ? 'Add at least 2 stops' : 'Optimise ' + points.length + ' stops'}
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
      </div>

      <Sheet docked={desktop} snap={snap} onSnapChange={setSnap} onCoverChange={setSheetCover} header={header} footer={tab === 'stops' ? footer : resultFooter}>
        {tab === 'stops' && (
          <div className="stops-tab">
            <StopSearch
              orsApiKey={settings.orsApiKey}
              focus={points.length ? [points[points.length - 1].latitude, points[points.length - 1].longitude] : undefined}
              onAdd={handleSearchAdd}
              onFocusChange={(focused) => focused && !desktop && setSnap('full')}
            />
            {error && <div className="callout callout--error">{error}</div>}
            {points.length === 0 ? (
              <div className="empty">
                <p className="empty__title">Where are you going?</p>
                <p>Search for an address, tap the map with <MousePointerClick size={14} /> (or long-press it), or import a list of coordinates.</p>
                <button type="button" className="button" onClick={() => setImportOpen(true)}>
                  <ClipboardPaste size={16} /> Import a list
                </button>
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
                <StopList
                  points={points}
                  startId={startId}
                  endId={endId}
                  onSetStart={setStart}
                  onSetEnd={setEnd}
                  onRename={renamePoint}
                  onRemove={removePoint}
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

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onChange={updateSettings} pointCount={points.length} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} hasStops={points.length > 0} onImport={importPoints} exportText={exportText} />
    </div>
  );
};

export default App;
