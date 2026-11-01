import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { CoordinatePoint } from '../types';
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
}

type PinKind = 'start' | 'end' | 'both' | 'stop';

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

const ViewController = ({
  coordinates,
  insets,
  fitRequest,
  focusPosition,
}: {
  coordinates: [number, number][];
  insets: MapInsets;
  fitRequest: number;
  focusPosition?: { position: [number, number]; nonce: number };
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
    const { top, bottom, left, right } = insetsRef.current;
    // Pan so the point lands in the centre of the visible (uncovered) area.
    const size = map.getSize();
    const target = map.project(focusPosition.position, map.getZoom());
    const offset = L.point((left - right) / 2, (top - bottom) / 2);
    const center = map.unproject(target.subtract(offset), map.getZoom());
    if (size.x > 0) map.panTo(center, { animate: true });
  }, [map, focusPosition]);

  // The container size changes when the side panel / sheet layout changes.
  useEffect(() => {
    const timer = window.setTimeout(() => map.invalidateSize(), 50);
    return () => window.clearTimeout(timer);
  }, [map, insets.left, insets.right]);

  return null;
};

export const MapView = ({ points, route, startId, endId, polyline, addMode, onAddPoint, insets, fitRequest, focus }: MapViewProps) => {
  const markers = useMemo(() => {
    if (route && route.length) {
      const seen = new Set<string>();
      const list: { point: CoordinatePoint; text: string; kind: PinKind }[] = [];
      const isLoop = route.length > 1 && route[0].id === route[route.length - 1].id;
      route.forEach((point, index) => {
        if (seen.has(point.id)) return;
        seen.add(point.id);
        const isFirst = index === 0;
        const isLast = index === route.length - 1;
        const kind: PinKind = isFirst && isLoop ? 'both' : isFirst ? 'start' : isLast ? 'end' : 'stop';
        list.push({ point, text: String(index + 1), kind });
      });
      return list;
    }
    return points.map((point, index) => {
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
        <ViewController coordinates={fitCoordinates} insets={insets} fitRequest={fitRequest} focusPosition={focusPosition} />
        {line.length > 1 && (
          <>
            <Polyline positions={line} pathOptions={{ color: '#ffffff', weight: 9, opacity: 0.9 }} />
            <Polyline positions={line} pathOptions={{ color: '#4f46e5', weight: 5, opacity: 0.95 }} />
          </>
        )}
        {markers.map(({ point, text, kind }) => (
          <Marker
            key={point.id}
            position={[point.latitude, point.longitude]}
            icon={pinIcon(text, kind, focus?.id === point.id)}
            zIndexOffset={kind === 'stop' ? 0 : 500}
          >
            <Tooltip direction="top">{point.label}</Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};
