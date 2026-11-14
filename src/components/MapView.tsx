import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { CoordinatePoint } from '../types';
import { UserPosition } from '../hooks/useGeolocation';
import { StopActions, StopMenuItems } from './StopMenu';
import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER: [number, number] = [46.6, 2.4];
const DEFAULT_ZOOM = 6;

export interface MapInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MapViewProps {
  points: CoordinatePoint[];
  /** Solved route (may end with the start again for a loop). */
  route?: CoordinatePoint[];
  startId?: string;
  endId?: string;
  polyline?: [number, number][];
  addMode: boolean;
  onAddPoint: (latitude: number, longitude: number) => void;
  /** Screen area hidden by floating UI, so fitted content stays visible. */
  insets: MapInsets;
  /** Increment to re-fit the view on all points. */
  fitRequest: number;
  /** Point to pan to (e.g. just added or tapped in the list). */
  focus?: { id: string; nonce: number };
  /** The user's live position, shown as a blue dot. */
  myLocation?: UserPosition;
  /** Increment to centre the view on `myLocation`. */
  locateRequest?: number;
  /** Add the user's position as a stop (optionally as the start). */
  onUseMyLocation?: (asStart: boolean) => void;
  /** Actions offered in the popup that opens when a stop marker is tapped. */
  stopActions?: StopActions;
}

type PinKind = 'start' | 'end' | 'both' | 'stop' | 'off';

interface StopMarker {
  point: CoordinatePoint;
  text: string;
  kind: PinKind;
  /** Position in the solved route (1-based). */
  routeIndex?: number;
}

const pinIcon = (text: string, kind: PinKind, highlighted: boolean) =>
  L.divIcon({
    className: 'pin-wrapper',
    html: '<div class="pin pin--' + kind + (highlighted ? ' pin--focus' : '') + '"><span>' + text + '</span></div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    tooltipAnchor: [0, -16],
  });

const MapEvents = ({ addMode, onAddPoint }: { addMode: boolean; onAddPoint: MapViewProps['onAddPoint'] }) => {
  useMapEvents({
    click: (event) => {
      if (addMode) onAddPoint(event.latlng.lat, event.latlng.lng);
    },
    // Long-press on touch screens, right-click on desktop.
    contextmenu: (event) => onAddPoint(event.latlng.lat, event.latlng.lng),
  });
  return null;
};

const paddingOptions = (insets: MapInsets): L.FitBoundsOptions => ({
  paddingTopLeft: [insets.left + 40, insets.top + 40],
  paddingBottomRight: [insets.right + 40, insets.bottom + 40],
  maxZoom: 16,
});

/** Map centre that puts `position` in the middle of the area not covered by floating UI. */
const visibleCenter = (map: L.Map, position: L.LatLngExpression, zoom: number, insets: MapInsets) => {
  const { top, bottom, left, right } = insets;
  const target = map.project(position, zoom);
  const offset = L.point((left - right) / 2, (top - bottom) / 2);
  return map.unproject(target.subtract(offset), zoom);
};

const ViewController = ({
  coordinates,
  insets,
  fitRequest,
  focusPosition,
  myLocation,
  locateRequest,
}: {
  coordinates: [number, number][];
  insets: MapInsets;
  fitRequest: number;
  focusPosition?: { position: [number, number]; nonce: number };
  myLocation?: UserPosition;
  locateRequest?: number;
}) => {
  const map = useMap();
  const insetsRef = useRef(insets);
  insetsRef.current = insets;
  const lastKey = useRef<string>('');

  const key = coordinates.map(([lat, lon]) => lat.toFixed(5) + ',' + lon.toFixed(5)).join('|') + '#' + fitRequest;

  useEffect(() => {
    if (!coordinates.length || key === lastKey.current) return;
    lastKey.current = key;
    map.invalidateSize();
    if (coordinates.length === 1) {
      map.setView(coordinates[0], Math.max(map.getZoom(), 14));
      return;
    }
    map.fitBounds(L.latLngBounds(coordinates), paddingOptions(insetsRef.current));
  }, [map, key, coordinates]);

  useEffect(() => {
    if (!focusPosition) return;
    // Pan so the point lands in the centre of the visible (uncovered) area.
    const center = visibleCenter(map, focusPosition.position, map.getZoom(), insetsRef.current);
    if (map.getSize().x > 0) map.panTo(center, { animate: true });
  }, [map, focusPosition]);

  const locationRef = useRef(myLocation);
  locationRef.current = myLocation;
  const hasLocation = !!myLocation;
  useEffect(() => {
    const location = locationRef.current;
    if (!locateRequest || !location) return;
    const position: [number, number] = [location.latitude, location.longitude];
    const zoom = Math.max(map.getZoom(), 16);
    map.flyTo(visibleCenter(map, position, zoom, insetsRef.current), zoom, { duration: 0.8 });
  }, [map, locateRequest, hasLocation]);

  // The container size changes when the side panel / sheet layout changes.
  useEffect(() => {
    const timer = window.setTimeout(() => map.invalidateSize(), 50);
    return () => window.clearTimeout(timer);
  }, [map, insets.left, insets.right]);

  return null;
};

const MyLocationActions = ({ onUse }: { onUse: (asStart: boolean) => void }) => {
  const map = useMap();
  const use = (asStart: boolean) => {
    map.closePopup();
    onUse(asStart);
  };
  return (
    <div className="my-location-popup__actions">
      <button type="button" className="button button--primary" onClick={() => use(true)}>
        Start here
      </button>
      <button type="button" className="button" onClick={() => use(false)}>
        Add as stop
      </button>
    </div>
  );
};

const StopPopupContent = ({
  point,
  isStart,
  isEnd,
  routeIndex,
  actions,
}: {
  point: CoordinatePoint;
  isStart: boolean;
  isEnd: boolean;
  routeIndex?: number;
  actions: StopActions;
}) => {
  const map = useMap();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(point.label);
  const close = () => map.closePopup();
  const commit = () => {
    const label = draft.trim();
    if (label && label !== point.label) actions.onRename(point.id, label);
    setEditing(false);
  };
  const status = [
    isStart && isEnd ? 'Start & end' : isStart ? 'Start' : isEnd ? 'End' : undefined,
    point.disabled ? 'Skipped' : routeIndex !== undefined ? 'Stop ' + routeIndex + ' in the route' : undefined,
  ].filter(Boolean);
  return (
    <div className="stop-popup">
      {editing ? (
        <input
          className="stop__edit"
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') setEditing(false);
          }}
          aria-label="Stop name"
        />
      ) : (
        <strong className="stop-popup__title">{point.label}</strong>
      )}
      {status.length > 0 && <small className="stop-popup__status">{status.join(' · ')}</small>}
      <div className="stop-popup__menu" role="menu">
        <StopMenuItems
          point={point}
          isStart={isStart}
          isEnd={isEnd}
          actions={actions}
          onDone={close}
          onRename={() => {
            setDraft(point.label);
            setEditing(true);
          }}
        />
      </div>
    </div>
  );
};

export const MapView = ({
  points,
  route,
  startId,
  endId,
  polyline,
  addMode,
  onAddPoint,
  insets,
  fitRequest,
  focus,
  myLocation,
  locateRequest,
  onUseMyLocation,
  stopActions,
}: MapViewProps) => {
  const markers = useMemo<StopMarker[]>(() => {
    if (route && route.length) {
      const seen = new Set<string>();
      const list: StopMarker[] = [];
      const isLoop = route.length > 1 && route[0].id === route[route.length - 1].id;
      route.forEach((point, index) => {
        if (seen.has(point.id)) return;
        seen.add(point.id);
        const isFirst = index === 0;
        const isLast = index === route.length - 1;
        const kind: PinKind = isFirst && isLoop ? 'both' : isFirst ? 'start' : isLast ? 'end' : 'stop';
        list.push({ point, text: String(index + 1), kind, routeIndex: index + 1 });
      });
      // Skipped stops stay visible, greyed out, so they are easy to find and re-enable.
      points.forEach((point) => {
        if (point.disabled && !seen.has(point.id)) list.push({ point, text: '–', kind: 'off' });
      });
      return list;
    }
    return points.map((point, index) => {
      if (point.disabled) return { point, text: String(index + 1), kind: 'off' };
      const isStart = point.id === startId;
      const isEnd = point.id === endId;
      const kind: PinKind = isStart && (isEnd || !endId) ? 'both' : isStart ? 'start' : isEnd ? 'end' : 'stop';
      return { point, text: String(index + 1), kind };
    });
  }, [points, route, startId, endId]);

  const line = useMemo<[number, number][]>(() => {
    if (polyline && polyline.length > 1) return polyline;
    if (route && route.length > 1) return route.map((point) => [point.latitude, point.longitude]);
    return [];
  }, [polyline, route]);

  const fitCoordinates = useMemo<[number, number][]>(
    () => (line.length > 1 ? line : points.map((point) => [point.latitude, point.longitude])),
    [line, points]
  );

  const focusPosition = useMemo(() => {
    if (!focus) return undefined;
    const point = points.find((candidate) => candidate.id === focus.id);
    return point ? { position: [point.latitude, point.longitude] as [number, number], nonce: focus.nonce } : undefined;
  }, [focus, points]);

  return (
    <div className={'map-view' + (addMode ? ' map-view--adding' : '')}>
      <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} zoomControl={false} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <ZoomControl position="topright" />
        <MapEvents addMode={addMode} onAddPoint={onAddPoint} />
        <ViewController
          coordinates={fitCoordinates}
          insets={insets}
          fitRequest={fitRequest}
          focusPosition={focusPosition}
          myLocation={myLocation}
          locateRequest={locateRequest}
        />
        {myLocation && (
          <>
            <Circle
              center={[myLocation.latitude, myLocation.longitude]}
              radius={myLocation.accuracy}
              interactive={false}
              pathOptions={{ color: '#2563eb', weight: 1, opacity: 0.4, fillColor: '#3b82f6', fillOpacity: 0.12 }}
            />
            <CircleMarker
              center={[myLocation.latitude, myLocation.longitude]}
              radius={8}
              pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }}
              className="my-location"
            >
              <Popup>
                <div className="my-location-popup">
                  <strong>You are here</strong>
                  <small>±{Math.round(myLocation.accuracy)} m</small>
                  {onUseMyLocation && <MyLocationActions onUse={onUseMyLocation} />}
                </div>
              </Popup>
            </CircleMarker>
          </>
        )}
        {line.length > 1 && (
          <>
            <Polyline positions={line} pathOptions={{ color: '#ffffff', weight: 9, opacity: 0.9 }} />
            <Polyline positions={line} pathOptions={{ color: '#4f46e5', weight: 5, opacity: 0.95 }} />
          </>
        )}
        {markers.map(({ point, text, kind, routeIndex }) => (
          <Marker
            key={point.id}
            position={[point.latitude, point.longitude]}
            icon={pinIcon(text, kind, focus?.id === point.id)}
            zIndexOffset={kind === 'off' ? -500 : kind === 'stop' ? 0 : 500}
            eventHandlers={{
              // The name label is redundant once the menu is open (touch screens open both on tap).
              popupopen: (event) => window.setTimeout(() => (event.target as L.Marker).closeTooltip(), 0),
            }}
          >
            <Tooltip direction="top">{point.label + (kind === 'off' ? ' (skipped)' : '')}</Tooltip>
            {stopActions && (
              <Popup
                className="stop-popup-wrapper"
                minWidth={250}
                autoPanPaddingTopLeft={[insets.left + 16, insets.top + 16]}
                autoPanPaddingBottomRight={[insets.right + 16, insets.bottom + 16]}
              >
                <StopPopupContent
                  point={point}
                  isStart={point.id === startId}
                  isEnd={point.id === endId}
                  routeIndex={routeIndex}
                  actions={stopActions}
                />
              </Popup>
            )}
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};
