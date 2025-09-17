import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { CoordinatePoint } from '../types';
import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER: [number, number] = [48.8566, 2.3522];
const DEFAULT_ZOOM = 5;

const markerIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41],
});

L.Marker.prototype.options.icon = markerIcon;

export interface MapViewProps {
  points: CoordinatePoint[];
  orderedIds: string[];
  polyline?: [number, number][];
}

const BoundsUpdater = ({ coordinates }: { coordinates: [number, number][] }) => {
  const map = useMap();
  const lastKeyRef = useRef<string | undefined>();

  useEffect(() => {
    if (!coordinates.length) {
      return;
    }

    const key = coordinates.map((coord) => coord[0].toFixed(6) + ',' + coord[1].toFixed(6)).join('|');
    if (lastKeyRef.current === key) {
      return;
    }

    lastKeyRef.current = key;

    if (coordinates.length === 1) {
      const [lat, lon] = coordinates[0];
      map.setView([lat, lon], Math.max(map.getZoom(), 13));
      return;
    }

    const latLngs = coordinates.map(([lat, lon]) => new L.LatLng(lat, lon));
    const bounds = L.latLngBounds(latLngs);
    map.fitBounds(bounds, { padding: [32, 32] });
  }, [map, coordinates]);

  return null;
};

export const MapView = ({ points, orderedIds, polyline }: MapViewProps) => {
  const orderedPoints = useMemo(() => {
    if (!orderedIds.length) {
      return points;
    }
    const lookup = new Map<string, CoordinatePoint>();
    points.forEach((point) => lookup.set(point.id, point));
    return orderedIds
      .map((id) => lookup.get(id))
      .filter((point): point is CoordinatePoint => Boolean(point));
  }, [points, orderedIds]);

  const positions = useMemo(
    () => orderedPoints.map((point) => [point.latitude, point.longitude] as [number, number]),
    [orderedPoints]
  );

  const sourcePositions = useMemo(
    () => points.map((point) => [point.latitude, point.longitude] as [number, number]),
    [points]
  );

  const polylinePositions = useMemo(() => {
    if (polyline && polyline.length > 1) {
      return polyline;
    }
    if (positions.length > 1) {
      return positions;
    }
    return sourcePositions;
  }, [polyline, positions, sourcePositions]);

  const boundsCoordinates = useMemo(() => {
    if (polylinePositions.length > 1) {
      return polylinePositions;
    }
    if (sourcePositions.length > 0) {
      return sourcePositions;
    }
    return [] as [number, number][];
  }, [polylinePositions, sourcePositions]);

  const bounds = useMemo(() => {
    if (!boundsCoordinates.length) {
      return undefined;
    }
    const latLngs = boundsCoordinates.map(([lat, lon]) => new L.LatLng(lat, lon));
    return L.latLngBounds(latLngs);
  }, [boundsCoordinates]);

  const center = bounds ? bounds.getCenter() : L.latLng(DEFAULT_CENTER[0], DEFAULT_CENTER[1]);

  return (
    <div className="map-view">
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={DEFAULT_ZOOM}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
      >
        <BoundsUpdater coordinates={boundsCoordinates} />
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {polylinePositions.length > 1 && (
          <Polyline positions={polylinePositions} color="#2563eb" weight={4} opacity={0.7} />
        )}
        {positions.map((position, index) => {
          const point = orderedPoints[index];
          const isStart = index === 0;
          const isEnd = index === positions.length - 1;
          const color = isStart ? '#16a34a' : isEnd ? '#dc2626' : '#1f2937';
          const radius = isStart || isEnd ? 10 : 7;
          return (
            <CircleMarker
              key={point ? point.id : index.toString()}
              center={position}
              radius={radius}
              color={color}
              fillColor={color}
              fillOpacity={0.9}
              weight={2}
            >
              <Tooltip direction="top">
                <div>
                  <strong>{point ? point.label : 'Waypoint'}</strong>
                  <div>Order: {index + 1}</div>
                  <div>
                    {position[0].toFixed(5)}, {position[1].toFixed(5)}
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
};
