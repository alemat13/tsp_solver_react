import { CoordinatePoint } from '../types';

const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const coordinate = (value: number) => value.toFixed(6);

/** Ordered stops plus the detailed road geometry (falls back to straight lines between stops). */
export interface ExportableRoute {
  name: string;
  stops: CoordinatePoint[];
  geometry?: [number, number][];
}

const trackOf = (route: ExportableRoute): [number, number][] =>
  route.geometry && route.geometry.length > 1 ? route.geometry : route.stops.map((stop) => [stop.latitude, stop.longitude]);

/** GPX 1.1: one numbered waypoint per stop, a route (rte) through the stops and a track (trk) of the geometry. */
export const buildGpx = (route: ExportableRoute): string => {
  const waypoints = route.stops
    .map(
      (stop, index) =>
        `  <wpt lat="${coordinate(stop.latitude)}" lon="${coordinate(stop.longitude)}"><name>${escapeXml(index + 1 + '. ' + stop.label)}</name></wpt>`
    )
    .join('\n');
  const routePoints = route.stops
    .map((stop) => `    <rtept lat="${coordinate(stop.latitude)}" lon="${coordinate(stop.longitude)}"><name>${escapeXml(stop.label)}</name></rtept>`)
    .join('\n');
  const trackPoints = trackOf(route)
    .map(([lat, lon]) => `      <trkpt lat="${coordinate(lat)}" lon="${coordinate(lon)}"></trkpt>`)
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="TSP Solver" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${escapeXml(route.name)}</name></metadata>`,
    waypoints,
    `  <rte><name>${escapeXml(route.name)}</name>`,
    routePoints,
    '  </rte>',
    `  <trk><name>${escapeXml(route.name)}</name><trkseg>`,
    trackPoints,
    '  </trkseg></trk>',
    '</gpx>',
    '',
  ].join('\n');
};

/** KML 2.2 (Google Earth / My Maps): numbered placemarks and a line string for the route. */
export const buildKml = (route: ExportableRoute): string => {
  const placemarks = route.stops
    .map(
      (stop, index) =>
        `    <Placemark><name>${escapeXml(index + 1 + '. ' + stop.label)}</name><Point><coordinates>${coordinate(stop.longitude)},${coordinate(stop.latitude)},0</coordinates></Point></Placemark>`
    )
    .join('\n');
  const line = trackOf(route)
    .map(([lat, lon]) => `${coordinate(lon)},${coordinate(lat)},0`)
    .join(' ');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '  <Document>',
    `    <name>${escapeXml(route.name)}</name>`,
    '    <Style id="route"><LineStyle><color>ffeb6325</color><width>4</width></LineStyle></Style>',
    placemarks,
    `    <Placemark><name>${escapeXml(route.name)}</name><styleUrl>#route</styleUrl><LineString><tessellate>1</tessellate><coordinates>${line}</coordinates></LineString></Placemark>`,
    '  </Document>',
    '</kml>',
    '',
  ].join('\n');
};

/** Google Maps accepts at most 9 intermediate waypoints per directions link. */
export const GOOGLE_MAPS_MAX_STOPS = 11;

const GOOGLE_TRAVEL_MODES: Record<string, string> = {
  'driving-car': 'driving',
  'driving-hgv': 'driving',
  'cycling-regular': 'bicycling',
  'cycling-electric': 'bicycling',
  'foot-walking': 'walking',
  'foot-hiking': 'walking',
  transit: 'transit',
};

/**
 * Google Maps directions links for the ordered stops, split into consecutive legs of at most
 * GOOGLE_MAPS_MAX_STOPS stops (each leg starts where the previous one ended).
 */
export const buildGoogleMapsLinks = (stops: CoordinatePoint[], travelMode: string): string[] => {
  if (stops.length < 2) return [];
  const mode = GOOGLE_TRAVEL_MODES[travelMode] ?? 'driving';
  const links: string[] = [];
  for (let start = 0; start < stops.length - 1; start += GOOGLE_MAPS_MAX_STOPS - 1) {
    const leg = stops.slice(start, start + GOOGLE_MAPS_MAX_STOPS);
    const format = (stop: CoordinatePoint) => coordinate(stop.latitude) + ',' + coordinate(stop.longitude);
    const params = new URLSearchParams({
      api: '1',
      origin: format(leg[0]),
      destination: format(leg[leg.length - 1]),
      travelmode: mode,
    });
    if (leg.length > 2) params.set('waypoints', leg.slice(1, -1).map(format).join('|'));
    links.push('https://www.google.com/maps/dir/?' + params.toString());
  }
  return links;
};

/** Triggers a file download in the browser. */
export const downloadTextFile = (fileName: string, content: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
