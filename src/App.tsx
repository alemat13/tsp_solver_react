import { useCallback, useMemo, useState } from 'react';
import { CoordinateInput } from './components/CoordinateInput';
import { OptionsForm } from './components/OptionsForm';
import { SolutionPanel } from './components/SolutionPanel';
import { MapView } from './components/MapView';
import { parseCoordinateLines } from './utils/coordinateParser';
import { useLocalStorage } from './hooks/useLocalStorage';
import { fetchMatrix } from './services/openRouteService';
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

  const [points, setPoints] = useState<CoordinatePoint[]>([]);
  const [selectedStartId, setSelectedStartId] = useState<string | undefined>(undefined);
  const [selectedEndId, setSelectedEndId] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [solution, setSolution] = useState<SolveResult | undefined>(undefined);
  const [algorithmNotes, setAlgorithmNotes] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [matrixProvider, setMatrixProvider] = useState<string | undefined>(undefined);

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
    return points.some((point) => point.id === selectedStartId) ? selectedStartId : undefined;
  }, [points, selectedStartId]);

  const resolvedEndId = useMemo(() => {
    return points.some((point) => point.id === selectedEndId) ? selectedEndId : undefined;
  }, [points, selectedEndId]);

  const runSolver = useCallback(
    async (pointCollection: CoordinatePoint[], parseWarnings: string[]) => {
      setIsLoading(true);
      setError(undefined);
      setSolution(undefined);
      setWarnings([]);
      setMatrixProvider(undefined);
      setAlgorithmNotes([]);

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

        const aggregatedWarnings: string[] = [];
        aggregatedWarnings.push.apply(aggregatedWarnings, parseWarnings);
        aggregatedWarnings.push.apply(aggregatedWarnings, matrixResult.warnings);
        aggregatedWarnings.push.apply(aggregatedWarnings, adaptiveResult.warnings);
        if (matrixResult.error) {
          aggregatedWarnings.push(matrixResult.error);
        }

        setWarnings(aggregatedWarnings);
        setAlgorithmNotes(adaptiveResult.notes);
      } catch (solverError) {
        const message = solverError instanceof Error ? solverError.message : 'Unexpected error while solving the itinerary.';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [apiKey, travelMode, resolvedStartId, resolvedEndId]
  );

  const handleParseAndSolve = async () => {
    const parseResult = parseCoordinateLines(rawInput);

    if (parseResult.errors.length > 0) {
      setError(parseResult.errors.join('\n'));
      setPoints([]);
      setSolution(undefined);
      setWarnings(parseResult.warnings.concat(parseResult.errors));
      return;
    }

    if (parseResult.points.length < 2) {
      const message = 'Provide at least two valid coordinates to compute an itinerary.';
      setError(message);
      setPoints(parseResult.points);
      setSolution(undefined);
      setWarnings(parseResult.warnings.concat([message]));
      return;
    }

    setPoints(parseResult.points);
    await runSolver(parseResult.points, parseResult.warnings);
  };

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
          <CoordinateInput value={rawInput} onChange={handleRawInputChange} onParse={handleParseAndSolve} disabled={isLoading} />
          <OptionsForm
            apiKey={apiKey}
            onApiKeyChange={handleApiKeyChange}
            travelMode={travelMode}
            onTravelModeChange={handleTravelModeChange}
            points={points}
            startId={resolvedStartId}
            endId={resolvedEndId}
            onStartChange={setSelectedStartId}
            onEndChange={setSelectedEndId}
          />
        </div>
        <div className="layout__column layout__column--results">
          <SolutionPanel
            isLoading={isLoading}
            error={error}
            result={solution}
            warnings={warnings}
            algorithmNotes={algorithmNotes}
            matrixProvider={matrixProvider}
          />
          <div className="panel map-panel">
            <h2 className="panel__title">Map preview</h2>
            <div className="map-container">
              <MapView points={points} orderedIds={solution ? solution.orderedIds : []} />
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
