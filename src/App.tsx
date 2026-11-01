import { useCallback, useEffect, useMemo, useState } from 'react';
import { CoordinateInput } from './components/CoordinateInput';
import { OptionsForm } from './components/OptionsForm';
import { SolutionPanel } from './components/SolutionPanel';
import { MapView } from './components/MapView';
import { parseCoordinateLines } from './utils/coordinateParser';
import { useLocalStorage } from './hooks/useLocalStorage';
import { fetchMatrix as fetchORSMatrix, fetchRouteGeometry as fetchORSRouteGeometry } from './services/openRouteService';
import { fetchMatrix as fetchGoogleMatrix, fetchRouteGeometry as fetchGoogleRouteGeometry } from './services/googleMapsService';
import { describeBruteForceEstimate } from './utils/solverEstimate';
import { solveInBackground } from './services/solverClient';
import { CoordinatePoint, OptimizationObjective, SolveResult, SolverMode, TravelMode } from './types';
import './App.css';

interface StorageState {
  googleApiKey: string;
  orsApiKey: string;
  rawInput: string;
  travelMode: TravelMode;
  solverMode: SolverMode;
  objective: OptimizationObjective;
  exactTimeLimitSeconds: number;
}

const initialStorageState: StorageState = {
  googleApiKey: '',
  orsApiKey: '',
  rawInput: '',
  travelMode: 'driving-car',
  solverMode: 'auto',
  objective: 'distance',
  exactTimeLimitSeconds: 15,
};

const STORAGE_KEY = 'tsp-solver-settings-v1';

const loadStorageState = (value: StorageState | undefined): StorageState => {
  if (!value) {
    return initialStorageState;
  }
  return {
    googleApiKey: value.googleApiKey || '',
    orsApiKey: value.orsApiKey || '',
    rawInput: value.rawInput || '',
    travelMode: value.travelMode || 'driving-car',
    solverMode: value.solverMode || 'auto',
    objective: value.objective === 'duration' ? 'duration' : 'distance',
    exactTimeLimitSeconds: value.exactTimeLimitSeconds > 0 ? value.exactTimeLimitSeconds : 15,
  };
};

export const App = () => {
  const [storedState, setStoredState] = useLocalStorage<StorageState>(STORAGE_KEY, initialStorageState);

  const [rawInput, setRawInput] = useState<string>(loadStorageState(storedState).rawInput);
  const [googleApiKey, setGoogleApiKey] = useState<string>(loadStorageState(storedState).googleApiKey);
  const [orsApiKey, setOrsApiKey] = useState<string>(loadStorageState(storedState).orsApiKey);
  const [travelMode, setTravelMode] = useState<TravelMode>(loadStorageState(storedState).travelMode);
  const [solverMode, setSolverMode] = useState<SolverMode>(loadStorageState(storedState).solverMode);
  const [objective, setObjective] = useState<OptimizationObjective>(loadStorageState(storedState).objective);
  const [exactTimeLimitSeconds, setExactTimeLimitSeconds] = useState<number>(loadStorageState(storedState).exactTimeLimitSeconds);

  const [selectedStartId, setSelectedStartId] = useState<string | undefined>(undefined);
  const [selectedEndId, setSelectedEndId] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [solution, setSolution] = useState<SolveResult | undefined>(undefined);
  const [algorithmNotes, setAlgorithmNotes] = useState<string[]>([]);
  const [solverWarnings, setSolverWarnings] = useState<string[]>([]);
  const [matrixProvider, setMatrixProvider] = useState<string | undefined>(undefined);
  const [routeCoordinates, setRouteCoordinates] = useState<[number, number][]>([]);
  const [routeWarnings, setRouteWarnings] = useState<string[]>([]);
  const [preSolveWarnings, setPreSolveWarnings] = useState<string[]>([]);

  const parseResult = useMemo(() => parseCoordinateLines(rawInput), [rawInput]);
  const parsedPoints = parseResult.points;
  const parseWarnings = parseResult.warnings;
  const parseErrors = parseResult.errors;

  const updateStorage = useCallback(
    (next: Partial<StorageState>) => {
      const merged = {
        googleApiKey,
        orsApiKey,
        rawInput,
        travelMode,
        solverMode,
        objective,
        exactTimeLimitSeconds,
        ...next,
      };
      setStoredState(merged);
    },
    [googleApiKey, orsApiKey, rawInput, travelMode, solverMode, objective, exactTimeLimitSeconds, setStoredState]
  );

  const handleRawInputChange = (value: string) => {
    setRawInput(value);
    updateStorage({ rawInput: value });
  };

  const handleGoogleApiKeyChange = (value: string) => {
    setGoogleApiKey(value);
    updateStorage({ googleApiKey: value });
  };

  const handleOrsApiKeyChange = (value: string) => {
    setOrsApiKey(value);
    updateStorage({ orsApiKey: value });
  };

  const handleTravelModeChange = (mode: TravelMode) => {
    setTravelMode(mode);
    updateStorage({ travelMode: mode });
  };

  const handleSolverModeChange = (mode: SolverMode) => {
    setSolverMode(mode);
    updateStorage({ solverMode: mode });
  };

  const handleObjectiveChange = (value: OptimizationObjective) => {
    setObjective(value);
    updateStorage({ objective: value });
  };

  const handleExactTimeLimitChange = (value: number) => {
    setExactTimeLimitSeconds(value);
    updateStorage({ exactTimeLimitSeconds: value });
  };

  const resolvedStartId = useMemo(() => {
    return parsedPoints.some((point) => point.id === selectedStartId) ? selectedStartId : undefined;
  }, [parsedPoints, selectedStartId]);

  const resolvedEndId = useMemo(() => {
    return parsedPoints.some((point) => point.id === selectedEndId) ? selectedEndId : undefined;
  }, [parsedPoints, selectedEndId]);

  const runSolver = useCallback(
    async (pointCollection: CoordinatePoint[]) => {
      setIsLoading(true);
      setError(undefined);
      setSolution(undefined);
      setSolverWarnings([]);
      setMatrixProvider(undefined);
      setAlgorithmNotes([]);
      setRouteCoordinates([]);
      setRouteWarnings([]);

      try {
        const matrixResult = travelMode === 'transit'
          ? await fetchGoogleMatrix({ apiKey: googleApiKey, profile: travelMode, points: pointCollection })
          : await fetchORSMatrix({ apiKey: orsApiKey, profile: travelMode, points: pointCollection });
        const startId = pointCollection.some((point) => point.id === resolvedStartId) ? resolvedStartId : undefined;
        const endId = pointCollection.some((point) => point.id === resolvedEndId) ? resolvedEndId : undefined;

        const aggregatedSolverWarnings: string[] = matrixResult.warnings.slice();
        if (solverMode === 'brute-force' && pointCollection.length > 10) {
          aggregatedSolverWarnings.push('Brute force search may take significant time for ' + pointCollection.length + ' points.');
        }

        const { result: selectedResult, notes } = await solveInBackground(solverMode, {
          points: pointCollection,
          matrix: matrixResult.data,
          startId,
          endId,
          objective,
        }, { exactTimeLimitMs: exactTimeLimitSeconds * 1000 });

        setSolution(selectedResult);
        const provider = matrixResult.data.provider;
        setMatrixProvider(
          provider === 'openrouteservice'
            ? 'OpenRouteService'
            : provider === 'google'
            ? 'Google Maps'
            : 'Haversine fallback'
        );

        aggregatedSolverWarnings.push.apply(aggregatedSolverWarnings, selectedResult.warnings);
        if (matrixResult.error) {
          aggregatedSolverWarnings.push(matrixResult.error);
        }

        setSolverWarnings(aggregatedSolverWarnings);
        setAlgorithmNotes(notes);

        let geometryWarnings: string[] = [];
        let geometryCoordinates: [number, number][] = selectedResult.orderedPoints.map((point) => [point.latitude, point.longitude]);

        const keyForProvider = matrixResult.data.provider === 'google' ? googleApiKey : orsApiKey;
        if (keyForProvider) {
          try {
            const geometryResult = matrixResult.data.provider === 'google'
              ? await fetchGoogleRouteGeometry({ apiKey: googleApiKey, profile: travelMode, points: selectedResult.orderedPoints })
              : await fetchORSRouteGeometry({ apiKey: orsApiKey, profile: travelMode, points: selectedResult.orderedPoints });
            geometryCoordinates = geometryResult.coordinates;
            geometryWarnings = geometryResult.warnings.slice();
            if (geometryResult.error) {
              geometryWarnings.push(geometryResult.error);
            }
          } catch (routeError) {
            const message = routeError instanceof Error ? routeError.message : 'Failed to fetch detailed route geometry.';
            geometryWarnings = ['Failed to fetch detailed route geometry.'];
            if (message !== geometryWarnings[0]) {
              geometryWarnings.push(message);
            }
          }
        }

        setRouteCoordinates(geometryCoordinates);
        setRouteWarnings(geometryWarnings);
      } catch (solverError) {
        const message = solverError instanceof Error ? solverError.message : 'Unexpected error while solving the itinerary.';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [googleApiKey, orsApiKey, travelMode, resolvedStartId, resolvedEndId, solverMode, objective, exactTimeLimitSeconds]
  );

  const handleSolve = async () => {
    if (parseErrors.length > 0) {
      return;
    }

    if (parsedPoints.length < 2) {
      return;
    }

    if (solverMode === 'brute-force') {
      const estimate = describeBruteForceEstimate(parsedPoints.length);
      const warningMessage =
        'Brute force mode may take approximately ' +
        estimate +
        '. This can block your browser while the search explores every permutation.';

      const proceed =
        typeof window !== 'undefined'
          ? window.confirm(
              warningMessage +
                '\n\nClick “OK” to proceed anyway, or “Cancel” to abort and choose another strategy.'
            )
          : true;

      if (!proceed) {
        setPreSolveWarnings([warningMessage + ' Solver cancelled by user.']);
        return;
      }

      setPreSolveWarnings([warningMessage]);
    } else {
      setPreSolveWarnings([]);
    }

    await runSolver(parsedPoints);
  };

  useEffect(() => {
    setSolution(undefined);
    setMatrixProvider(undefined);
    setAlgorithmNotes([]);
    setSolverWarnings([]);
    setRouteCoordinates([]);
    setRouteWarnings([]);
    setError(undefined);
    setPreSolveWarnings([]);
  }, [rawInput, solverMode, travelMode, objective]);

  useEffect(() => {
    if (selectedStartId && !parsedPoints.some((point) => point.id === selectedStartId)) {
      setSelectedStartId(undefined);
    }
    if (selectedEndId && !parsedPoints.some((point) => point.id === selectedEndId)) {
      setSelectedEndId(undefined);
    }
  }, [parsedPoints, selectedStartId, selectedEndId]);

  const combinedWarnings = useMemo(() => {
    return [...parseWarnings, ...preSolveWarnings, ...solverWarnings, ...routeWarnings];
  }, [parseWarnings, preSolveWarnings, solverWarnings, routeWarnings]);

  const effectiveError = error || (parseErrors.length > 0 ? parseErrors.join('\n') : undefined);

  const canSolve = !isLoading && parseErrors.length === 0 && parsedPoints.length >= 2;

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>Adaptive TSP Planner</h1>
          <p>Optimise routes with exact and heuristic solvers powered by OpenRouteService.</p>
        </div>
      </header>
      <main className="layout">
        <div className="layout__column layout__column--inputs">
          <CoordinateInput value={rawInput} onChange={handleRawInputChange} onSolve={handleSolve} disabled={!canSolve} />
          <OptionsForm
            googleApiKey={googleApiKey}
            onGoogleApiKeyChange={handleGoogleApiKeyChange}
            orsApiKey={orsApiKey}
            onOrsApiKeyChange={handleOrsApiKeyChange}
            travelMode={travelMode}
            onTravelModeChange={handleTravelModeChange}
            solverMode={solverMode}
            onSolverModeChange={handleSolverModeChange}
            objective={objective}
            onObjectiveChange={handleObjectiveChange}
            exactTimeLimitSeconds={exactTimeLimitSeconds}
            onExactTimeLimitChange={handleExactTimeLimitChange}
            points={parsedPoints}
            startId={resolvedStartId}
            endId={resolvedEndId}
            onStartChange={setSelectedStartId}
            onEndChange={setSelectedEndId}
          />
        </div>
        <div className="layout__column layout__column--results">
          <SolutionPanel
            isLoading={isLoading}
            error={effectiveError}
            result={solution}
            warnings={combinedWarnings}
            algorithmNotes={algorithmNotes}
            matrixProvider={matrixProvider}
            routeCoordinates={routeCoordinates}
            travelMode={travelMode}
          />
          <div className="panel map-panel">
            <h2 className="panel__title">Map preview</h2>
            <div className="map-container">
              <MapView
                points={parsedPoints}
                orderedIds={solution ? solution.orderedIds : []}
                polyline={routeCoordinates}
              />
            </div>
          </div>
        </div>
      </main>
      <footer className="app__footer">
        <p>
          Need an openrouteservice API key? Create a free HeiGIT account at
          <a href="https://account.heigit.org/signup" target="_blank" rel="noreferrer"> account.heigit.org</a>.
        </p>
      </footer>
    </div>
  );
};

export default App;
