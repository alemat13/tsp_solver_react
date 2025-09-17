import { useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip } from 'react-leaflet';
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

  const positions = orderedPoints.map((point) => [point.latitude, point.longitude] as [number, number]);

  const polylinePositions = polyline && polyline.length > 1 ? polyline : positions;

  const boundsSource = polylinePositions.length > 1
    ? polylinePositions.map((position) => new L.LatLng(position[0], position[1]))
    : points.map((point) => new L.LatLng(point.latitude, point.longitude));

  const bounds = boundsSource.length > 0 ? L.latLngBounds(boundsSource) : undefined;
  const center = bounds ? bounds.getCenter() : L.latLng(DEFAULT_CENTER[0], DEFAULT_CENTER[1]);

  const containerProps = bounds ? { bounds } : {};

  return (
    <div className="map-view">
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={DEFAULT_ZOOM}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
        {...containerProps}
      >
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
