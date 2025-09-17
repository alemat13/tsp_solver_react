import { useCallback, useEffect, useMemo, useState } from 'react';
import { CoordinateInput } from './components/CoordinateInput';
import { OptionsForm } from './components/OptionsForm';
import { SolutionPanel } from './components/SolutionPanel';
import { MapView } from './components/MapView';
import { parseCoordinateLines } from './utils/coordinateParser';
import { useLocalStorage } from './hooks/useLocalStorage';
import { fetchMatrix, fetchRouteGeometry } from './services/openRouteService';
import { solveAdaptiveTsp } from './algorithms/adaptive';
import { solveBruteForce } from './algorithms/bruteForce';
import { solveHeuristic } from './algorithms/heuristic';
import { describeBruteForceEstimate } from './utils/solverEstimate';
import { CoordinatePoint, SolveResult, SolverMode, TravelMode } from './types';
import './App.css';

interface StorageState {
  apiKey: string;
  rawInput: string;
  travelMode: TravelMode;
  solverMode: SolverMode;
}

const initialStorageState: StorageState = {
  apiKey: '',
  rawInput: '',
  travelMode: 'driving-car',
  solverMode: 'auto',
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
    solverMode: value.solverMode || 'auto',
  };
};

export const App = () => {
  const [storedState, setStoredState] = useLocalStorage<StorageState>(STORAGE_KEY, initialStorageState);

  const [rawInput, setRawInput] = useState<string>(loadStorageState(storedState).rawInput);
  const [apiKey, setApiKey] = useState<string>(loadStorageState(storedState).apiKey);
  const [travelMode, setTravelMode] = useState<TravelMode>(loadStorageState(storedState).travelMode);
  const [solverMode, setSolverMode] = useState<SolverMode>(loadStorageState(storedState).solverMode);

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
        apiKey,
        rawInput,
        travelMode,
        solverMode,
        ...next,
      };
      setStoredState(merged);
    },
    [apiKey, rawInput, travelMode, solverMode, setStoredState]
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

  const handleSolverModeChange = (mode: SolverMode) => {
    setSolverMode(mode);
    updateStorage({ solverMode: mode });
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

        let selectedResult: SolveResult;
        let notes: string[] = [];

        const aggregatedSolverWarnings: string[] = matrixResult.warnings.slice();

        if (solverMode === 'brute-force') {
          selectedResult = solveBruteForce({
            points: pointCollection,
            matrix: matrixResult.data,
            startId,
            endId,
          });
          notes = ['Brute force strategy selected explicitly by the user.'];
          if (pointCollection.length > 10) {
            aggregatedSolverWarnings.push('Brute force search may take significant time for ' + pointCollection.length + ' points.');
          }
        } else if (solverMode === 'heuristic') {
          selectedResult = solveHeuristic({
            points: pointCollection,
            matrix: matrixResult.data,
            startId,
            endId,
          });
          notes = ['Heuristic strategy selected explicitly by the user.'];
        } else {
          const adaptiveResult = solveAdaptiveTsp({
            points: pointCollection,
            matrix: matrixResult.data,
            startId,
            endId,
          });
          selectedResult = adaptiveResult;
          notes = adaptiveResult.notes;
        }

        setSolution(selectedResult);
        setMatrixProvider(matrixResult.data.provider === 'openrouteservice' ? 'OpenRouteService' : 'Haversine fallback');

        aggregatedSolverWarnings.push.apply(aggregatedSolverWarnings, selectedResult.warnings);
        if (matrixResult.error) {
          aggregatedSolverWarnings.push(matrixResult.error);
        }

        setSolverWarnings(aggregatedSolverWarnings);
        setAlgorithmNotes(notes);

        let geometryWarnings: string[] = [];
        let geometryCoordinates: [number, number][] = selectedResult.orderedPoints.map((point) => [point.latitude, point.longitude]);

        if (matrixResult.data.provider === 'openrouteservice' && apiKey) {
          try {
            const geometryResult = await fetchRouteGeometry({
              apiKey,
              profile: travelMode,
              points: selectedResult.orderedPoints,
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
    [apiKey, travelMode, resolvedStartId, resolvedEndId, solverMode]
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
  }, [rawInput, solverMode, travelMode]);

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
            apiKey={apiKey}
            onApiKeyChange={handleApiKeyChange}
            travelMode={travelMode}
            onTravelModeChange={handleTravelModeChange}
            solverMode={solverMode}
            onSolverModeChange={handleSolverModeChange}
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
