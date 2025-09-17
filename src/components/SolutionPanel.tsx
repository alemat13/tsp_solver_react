import { SolveResult } from '../types';

export interface SolutionPanelProps {
  isLoading: boolean;
  error?: string;
  result?: SolveResult;
  warnings: string[];
  algorithmNotes: string[];
  matrixProvider?: string;
}

const formatDistance = (distance: number | undefined) => {
  if (!distance || distance <= 0) {
    return '0 km';
  }
  const kilometres = distance / 1000;
  return kilometres >= 100
    ? kilometres.toFixed(1) + ' km'
    : kilometres.toFixed(2) + ' km';
};

const formatDuration = (seconds: number | undefined) => {
  if (!seconds || seconds <= 0) {
    return 'N/A';
  }
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return hours + ' h ' + minutes + ' min';
  }
  return minutes + ' min';
};

export const SolutionPanel = ({
  isLoading,
  error,
  result,
  warnings,
  algorithmNotes,
  matrixProvider,
}: SolutionPanelProps) => {
  return (
    <section className="panel">
      <h2 className="panel__title">Itinerary</h2>
      {isLoading && <p className="status">Computing optimal route...</p>}
      {!isLoading && error && <p className="status status--error">{error}</p>}
      {!isLoading && !error && !result && <p className="status">Provide locations and run the solver to view the itinerary.</p>}
      {!isLoading && result && (
        <>
          <div className="summary">
            <div>
              <span className="summary__label">Strategy</span>
              <span className="summary__value">{result.strategy}</span>
            </div>
            <div>
              <span className="summary__label">Total distance</span>
              <span className="summary__value">{formatDistance(result.totalDistance)}</span>
            </div>
            <div>
              <span className="summary__label">Estimated duration</span>
              <span className="summary__value">{formatDuration(result.totalDuration)}</span>
            </div>
            <div>
              <span className="summary__label">Matrix provider</span>
              <span className="summary__value">{matrixProvider || 'Not available'}</span>
            </div>
          </div>
          <ol className="itinerary">
            {result.orderedPoints.map((point, index) => (
              <li key={point.id}>
                <div className="itinerary__step">
                  <span className="itinerary__index">{index + 1}</span>
                  <div className="itinerary__details">
                    <span className="itinerary__label">{point.label}</span>
                    <span className="itinerary__coords">
                      {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      {algorithmNotes.length > 0 && (
        <div className="notes">
          <h3>Notes</h3>
          <ul>
            {algorithmNotes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="warnings">
          <h3>Warnings</h3>
          <ul>
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};
