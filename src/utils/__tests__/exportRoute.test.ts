import { buildGoogleMapsLinks, buildGpx, buildKml } from '../exportRoute';

const stops = Array.from({ length: 23 }, (_, i) => ({ id: 'p' + i, label: i === 0 ? 'Café & Co <1>' : 'Stop ' + i, latitude: 48.8 + i / 1000, longitude: 2.3 }));

describe('route export', () => {
  it('builds GPX with waypoints, route and track', () => {
    const gpx = buildGpx({ name: 'Test', stops: stops.slice(0, 3), geometry: [[48.8, 2.3], [48.81, 2.31]] });
    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx.match(/<wpt /g)).toHaveLength(3);
    expect(gpx.match(/<rtept /g)).toHaveLength(3);
    expect(gpx.match(/<trkpt /g)).toHaveLength(2);
    expect(gpx).toContain('Café &amp; Co &lt;1&gt;');
  });

  it('builds KML with lon,lat order', () => {
    const kml = buildKml({ name: 'Test', stops: stops.slice(0, 2) });
    expect(kml).toContain('<coordinates>2.300000,48.800000,0</coordinates>');
    expect(kml).toContain('<LineString>');
  });

  it('splits Google Maps links into legs of at most 11 stops', () => {
    const links = buildGoogleMapsLinks(stops, 'foot-walking');
    expect(links).toHaveLength(3); // 23 stops: 0-10, 10-20, 20-22
    const first = new URL(links[0]);
    expect(first.searchParams.get('travelmode')).toBe('walking');
    expect(first.searchParams.get('waypoints')?.split('|')).toHaveLength(9);
    expect(new URL(links[1]).searchParams.get('origin')).toBe(first.searchParams.get('destination'));
  });
});
