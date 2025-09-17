import { useCallback, useEffect, useMemo, useState } from 'react';
import { CoordinateInput } from './components/CoordinateInput';
import { OptionsForm } from './components/OptionsForm';
import { SolutionPanel } from './components/SolutionPanel';
import { MapView } from './components/MapView';
import { parseCoordinateLines } from './utils/coordinateParser';
import { useLocalStorage } from './hooks/useLocalStorage';
import { fetchMatrix, fetchRouteGeometry } from './services/openRouteService';
import { solveAdaptiveTsp } from './algorithms/adaptive';
import { CoordinatePoint, SolveResult, TravelMode } from './types';
import './App.css';

interface StorageState {
  apiKey: string;
  rawInput: string;
  travelMode: TravelMode;
}

const initialStorageState: StorageState = {
  apiKey: '',
  rawInput: '',
  travelMode: 'driving-car',
};

const STORAGE_KEY = 'tsp-solver-settings-v1';

const loadStorageState = (value: StorageState | undefined): StorageState => {
  if (!value) {
    return initialStorageState;
  }
  return {
    apiKey: value.apiKey || '',
    rawInput: value.rawInput || '',
    travelMode: value.travelMode || 'driving-car',
  };
};

export const App = () => {
  const [storedState, setStoredState] = useLocalStorage<StorageState>(STORAGE_KEY, initialStorageState);

  const [rawInput, setRawInput] = useState<string>(loadStorageState(storedState).rawInput);
  const [apiKey, setApiKey] = useState<string>(loadStorageState(storedState).apiKey);
  const [travelMode, setTravelMode] = useState<TravelMode>(loadStorageState(storedState).travelMode);

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

  const parseResult = useMemo(() => parseCoordinateLines(rawInput), [rawInput]);
  const parsedPoints = parseResult.points;
  const parseWarnings = parseResult.warnings;
  const parseErrors = parseResult.errors;

  const updateStorage = useCallback(
    (next: Partial<StorageState>) => {
      const merged = {
        apiKey,
        rawInput,
        travelMode,
        ...next,
      };
      setStoredState(merged);
    },
    [apiKey, rawInput, travelMode, setStoredState]
  );

  const handleRawInputChange = (value: string) => {
    setRawInput(value);
    updateStorage({ rawInput: value });
  };

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    updateStorage({ apiKey: value });
  };

  const handleTravelModeChange = (mode: TravelMode) => {
    setTravelMode(mode);
    updateStorage({ travelMode: mode });
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
        const matrixResult = await fetchMatrix({ apiKey, profile: travelMode, points: pointCollection });
        const startId = pointCollection.some((point) => point.id === resolvedStartId) ? resolvedStartId : undefined;
        const endId = pointCollection.some((point) => point.id === resolvedEndId) ? resolvedEndId : undefined;

        const adaptiveResult = solveAdaptiveTsp({
          points: pointCollection,
          matrix: matrixResult.data,
          startId,
          endId,
        });

        setSolution(adaptiveResult);
        setMatrixProvider(matrixResult.data.provider === 'openrouteservice' ? 'OpenRouteService' : 'Haversine fallback');

        const aggregatedSolverWarnings: string[] = [];
        aggregatedSolverWarnings.push.apply(aggregatedSolverWarnings, matrixResult.warnings);
        aggregatedSolverWarnings.push.apply(aggregatedSolverWarnings, adaptiveResult.warnings);
        if (matrixResult.error) {
          aggregatedSolverWarnings.push(matrixResult.error);
        }

        setSolverWarnings(aggregatedSolverWarnings);
        setAlgorithmNotes(adaptiveResult.notes);

        let geometryWarnings: string[] = [];
        let geometryCoordinates: [number, number][] = adaptiveResult.orderedPoints.map((point) => [point.latitude, point.longitude]);

        if (matrixResult.data.provider === 'openrouteservice' && apiKey) {
          try {
            const geometryResult = await fetchRouteGeometry({
              apiKey,
              profile: travelMode,
              points: adaptiveResult.orderedPoints,
            });
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
    [apiKey, travelMode, resolvedStartId, resolvedEndId]
  );

  const handleSolve = async () => {
    if (parseErrors.length > 0) {
      return;
    }

    if (parsedPoints.length < 2) {
      return;
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
  }, [rawInput]);

  useEffect(() => {
    if (selectedStartId && !parsedPoints.some((point) => point.id === selectedStartId)) {
      setSelectedStartId(undefined);
    }
    if (selectedEndId && !parsedPoints.some((point) => point.id === selectedEndId)) {
      setSelectedEndId(undefined);
    }
  }, [parsedPoints, selectedStartId, selectedEndId]);

  const combinedWarnings = useMemo(() => {
    return [...parseWarnings, ...solverWarnings, ...routeWarnings];
  }, [parseWarnings, solverWarnings, routeWarnings]);

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
            apiKey={apiKey}
            onApiKeyChange={handleApiKeyChange}
            travelMode={travelMode}
            onTravelModeChange={handleTravelModeChange}
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
          Need an API key? Create one at
          <a href="https://openrouteservice.org/" target="_blank" rel="noreferrer"> openrouteservice.org</a>.
        </p>
      </footer>
    </div>
  );
};

export default App;
