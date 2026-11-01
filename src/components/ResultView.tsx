import { AlertTriangle, CheckCircle2, ChevronDown, Download, ExternalLink, Gauge, Info } from 'lucide-react';
import { SolveResult, TransitLeg } from '../types';
import { TransitSteps } from './TransitSteps';
import { buildGoogleMapsLinks, buildGpx, buildKml, downloadTextFile } from '../utils/exportRoute';
import { describeOptimality, formatDistance, formatDuration, STRATEGY_LABELS } from '../ui/format';

export interface Leg {
  distance?: number;
  duration?: number;
  /** Step-by-step public-transport directions (transit mode with a Google key). */
  transit?: TransitLeg;
}

export interface ResultViewProps {
  result: SolveResult;
  legs: Leg[];
  notes: string[];
  warnings: string[];
  matrixProvider?: string;
  routeCoordinates: [number, number][];
  travelMode: string;
  onFocus: (id: string) => void;
}

export const ResultView = ({ result, legs, notes, warnings, matrixProvider, routeCoordinates, travelMode, onFocus }: ResultViewProps) => {
  const optimality = describeOptimality(result);
  const route = result.orderedPoints;
  const isLoop = route.length > 1 && route[0].id === route[route.length - 1].id;
  const googleLinks = buildGoogleMapsLinks(route, travelMode);

  const exportRoute = (format: 'gpx' | 'kml') => {
    const data = { name: 'Route (' + route.length + ' stops)', stops: route, geometry: routeCoordinates };
    if (format === 'gpx') downloadTextFile('route.gpx', buildGpx(data), 'application/gpx+xml');
    else downloadTextFile('route.kml', buildKml(data), 'application/vnd.google-earth.kml+xml');
  };

  return (
    <div className="result">
      <div className="stats">
        <div className="stat">
          <span className="stat__label">Distance</span>
          <span className="stat__value">{formatDistance(result.totalDistance)}</span>
        </div>
        {!!result.totalDuration && (
          <div className="stat">
            <span className="stat__label">Duration</span>
            <span className="stat__value">{formatDuration(result.totalDuration)}</span>
          </div>
        )}
        <div className="stat">
          <span className="stat__label">Stops</span>
          <span className="stat__value">{isLoop ? route.length - 1 : route.length}</span>
        </div>
      </div>

      <div className={'quality quality--' + optimality.kind}>
        {optimality.kind === 'optimal' ? <CheckCircle2 size={18} /> : <Gauge size={18} />}
        <span>
          <strong>{optimality.label}</strong>
          <small>
            {STRATEGY_LABELS[result.strategy]} · {matrixProvider || 'unknown distances'}
          </small>
        </span>
      </div>

      <div className="actions-row">
        {googleLinks.map((link, index) => (
          <a key={link} className="button button--primary" href={link} target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> {googleLinks.length > 1 ? 'Maps ' + (index + 1) + '/' + googleLinks.length : 'Open in Google Maps'}
          </a>
        ))}
        <button type="button" className="button" onClick={() => exportRoute('gpx')}>
          <Download size={16} /> GPX
        </button>
        <button type="button" className="button" onClick={() => exportRoute('kml')}>
          <Download size={16} /> KML
        </button>
      </div>

      {warnings.length > 0 && (
        <details className="callout callout--warning">
          <summary>
            <AlertTriangle size={16} /> {warnings.length === 1 ? '1 warning' : warnings.length + ' warnings'}
            <ChevronDown size={16} className="callout__chevron" />
          </summary>
          <ul>
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      )}

      {legs.some((leg) => leg.transit) && (
        <p className="transit-note">Transit times are for leaving now; each leg is planned on its own. Tap a leg for lines and stops.</p>
      )}

      <ol className="timeline">
        {route.map((point, index) => {
          const isFirst = index === 0;
          const isLast = index === route.length - 1;
          const leg = legs[index];
          return (
            <li key={point.id + '-' + index} className={'timeline__item' + (isFirst ? ' is-first' : '') + (isLast ? ' is-last' : '')}>
              <button type="button" className="timeline__stop" onClick={() => onFocus(point.id)}>
                <span className={'timeline__dot' + (isFirst ? ' timeline__dot--start' : isLast ? ' timeline__dot--end' : '')}>{isLast && isLoop ? '↺' : index + 1}</span>
                <span className="timeline__label">
                  {point.label}
                  {isFirst && <small>Start</small>}
                  {isLast && <small>{isLoop ? 'Back to start' : 'End'}</small>}
                </span>
              </button>
              {!isLast && leg && (
                <div className="timeline__leg">
                  {formatDistance(leg.distance)}
                  {leg.duration ? ' · ' + formatDuration(leg.duration) : ''}
                  {leg.transit && <TransitSteps leg={leg.transit} />}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {notes.length > 0 && (
        <details className="callout">
          <summary>
            <Info size={16} /> Solver details
            <ChevronDown size={16} className="callout__chevron" />
          </summary>
          <ul>
            {notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};
