import { ChangeEvent } from 'react';
import { CoordinatePoint, TravelMode } from '../types';

export interface OptionsFormProps {
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  travelMode: TravelMode;
  onTravelModeChange: (mode: TravelMode) => void;
  points: CoordinatePoint[];
  startId?: string;
  endId?: string;
  onStartChange: (value?: string) => void;
  onEndChange: (value?: string) => void;
}

const TRAVEL_MODE_OPTIONS: { label: string; value: TravelMode; description: string }[] = [
  { label: 'Driving (car)', value: 'driving-car', description: 'Standard road network with car assumptions.' },
  { label: 'Driving (heavy goods)', value: 'driving-hgv', description: 'Heavy vehicles with road restrictions.' },
  { label: 'Cycling (regular)', value: 'cycling-regular', description: 'Bike-friendly routes over roads and paths.' },
  { label: 'Cycling (electric)', value: 'cycling-electric', description: 'E-bike profile considering slopes.' },
  { label: 'Walking', value: 'foot-walking', description: 'Pedestrian routes, sidewalks and footpaths.' },
  { label: 'Hiking', value: 'foot-hiking', description: 'Hiking trails with elevation-aware routing.' },
];

export const OptionsForm = ({
  apiKey,
  onApiKeyChange,
  travelMode,
  onTravelModeChange,
  points,
  startId,
  endId,
  onStartChange,
  onEndChange,
}: OptionsFormProps) => {
  const handleTravelModeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onTravelModeChange(event.target.value as TravelMode);
  };

  const handleStartChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onStartChange(event.target.value || undefined);
  };

  const handleEndChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onEndChange(event.target.value || undefined);
  };

  return (
    <section className="panel">
      <h2 className="panel__title">Routing Options</h2>
      <div className="field-group">
        <label className="field">
          <span className="field__label">OpenRouteService API key</span>
          <input
            type="password"
            value={apiKey}
            placeholder="Enter your API key"
            onChange={(event) => onApiKeyChange(event.target.value)}
            autoComplete="off"
          />
          <span className="field__hint">Stored locally in your browser only.</span>
        </label>
      </div>
      <div className="field-group">
        <label className="field">
          <span className="field__label">Travel mode</span>
          <select value={travelMode} onChange={handleTravelModeChange}>
            {TRAVEL_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="field__hint">
            {TRAVEL_MODE_OPTIONS.find((option) => option.value === travelMode)?.description || ''}
          </p>
        </label>
      </div>
      <div className="field-grid">
        <label className="field">
          <span className="field__label">Start point (optional)</span>
          <select value={startId || ''} onChange={handleStartChange}>
            <option value="">Automatic</option>
            {points.map((point) => (
              <option key={point.id} value={point.id}>
                {point.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">End point (optional)</span>
          <select value={endId || ''} onChange={handleEndChange}>
            <option value="">Automatic</option>
            {points.map((point) => (
              <option key={point.id} value={point.id}>
                {point.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
};
