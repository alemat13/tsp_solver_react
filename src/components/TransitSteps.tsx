import { Bus, CableCar, ChevronDown, ChevronRight, Footprints, LucideIcon, Ship, TrainFront, TrainFrontTunnel, TramFront } from 'lucide-react';
import { TransitLeg, TransitRide } from '../types';
import { formatDistance, formatDuration } from '../ui/format';

const VEHICLE_ICONS: Record<string, LucideIcon> = {
  BUS: Bus,
  INTERCITY_BUS: Bus,
  TROLLEYBUS: Bus,
  SHARE_TAXI: Bus,
  SUBWAY: TrainFrontTunnel,
  METRO_RAIL: TrainFrontTunnel,
  TRAM: TramFront,
  LIGHT_RAIL: TramFront,
  MONORAIL: TramFront,
  RAIL: TrainFront,
  HEAVY_RAIL: TrainFront,
  COMMUTER_TRAIN: TrainFront,
  HIGH_SPEED_TRAIN: TrainFront,
  LONG_DISTANCE_TRAIN: TrainFront,
  FERRY: Ship,
  CABLE_CAR: CableCar,
  GONDOLA_LIFT: CableCar,
  FUNICULAR: CableCar,
};

export const vehicleIcon = (type: string | undefined): LucideIcon => (type && VEHICLE_ICONS[type]) || Bus;

/** Clock time of a ride end: Google's localised text (stop time zone) or the browser's format. */
export const formatClock = (localized: string | undefined, iso: string | undefined): string | undefined => {
  if (localized) return localized;
  if (!iso) return undefined;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const LineBadge = ({ ride }: { ride: TransitRide }) => {
  const Icon = vehicleIcon(ride.vehicleType);
  const style = ride.color ? { background: ride.color, color: ride.textColor || '#fff', borderColor: ride.color } : undefined;
  return (
    <span className="line-badge" style={style} title={[ride.vehicleName, ride.lineName].filter(Boolean).join(' · ') || undefined}>
      <Icon size={13} aria-hidden />
      {ride.line}
    </span>
  );
};

export const TransitSteps = ({ leg }: { leg: TransitLeg }) => {
  const rides = leg.steps.filter((step) => step.ride).map((step) => step.ride as TransitRide);
  const first = rides[0];
  const last = rides[rides.length - 1];
  const leave = first && formatClock(first.departureText, first.departureTime);
  const arrive = last && formatClock(last.arrivalText, last.arrivalTime);

  return (
    <details className="transit">
      <summary className="transit__summary">
        <span className="transit__chips">
          {leg.steps.map((step, index) => (
            <span key={index} className="transit__chip">
              {index > 0 && <ChevronRight size={12} className="transit__sep" aria-hidden />}
              {step.ride ? (
                <LineBadge ride={step.ride} />
              ) : (
                <span className="walk-badge" title="Walk">
                  <Footprints size={13} aria-label="Walk" />
                  {step.duration ? Math.max(1, Math.round(step.duration / 60)) : ''}
                </span>
              )}
            </span>
          ))}
        </span>
        <span className="transit__times">
          {rides.length === 0 ? 'Walk only' : leave && arrive ? leave + ' – ' + arrive : formatDuration(leg.duration)}
        </span>
        <ChevronDown size={14} className="transit__chevron" aria-hidden />
      </summary>
      <ol className="transit__steps">
        {leg.steps.map((step, index) => {
          if (!step.ride) {
            return (
              <li key={index} className="transit__step transit__step--walk">
                <Footprints size={16} className="transit__icon" aria-hidden />
                <span>
                  Walk {formatDuration(step.duration)}
                  {step.distance ? ' · ' + formatDistance(step.distance) : ''}
                </span>
              </li>
            );
          }
          const ride = step.ride;
          const Icon = vehicleIcon(ride.vehicleType);
          const departure = formatClock(ride.departureText, ride.departureTime);
          const arrival = formatClock(ride.arrivalText, ride.arrivalTime);
          return (
            <li key={index} className="transit__step">
              <Icon size={16} className="transit__icon" aria-hidden />
              <div className="transit__ride">
                <div className="transit__line">
                  <LineBadge ride={ride} />
                  {ride.headsign && <span className="transit__headsign">towards {ride.headsign}</span>}
                </div>
                <div className="transit__stop">
                  <time>{departure ?? '–'}</time>
                  <span>{ride.departureStop ?? 'Departure stop'}</span>
                </div>
                <div className="transit__stop">
                  <time>{arrival ?? '–'}</time>
                  <span>{ride.arrivalStop ?? 'Arrival stop'}</span>
                </div>
                <small className="transit__meta">
                  {[
                    ride.vehicleName,
                    ride.stopCount !== undefined ? ride.stopCount + (ride.stopCount === 1 ? ' stop' : ' stops') : undefined,
                    step.duration ? formatDuration(step.duration) : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  {ride.agency && (
                    <>
                      {' · '}
                      {ride.agencyUrl ? (
                        <a href={ride.agencyUrl} target="_blank" rel="noreferrer">
                          {ride.agency}
                        </a>
                      ) : (
                        ride.agency
                      )}
                    </>
                  )}
                </small>
              </div>
            </li>
          );
        })}
      </ol>
    </details>
  );
};
