import { buildHtmlReport, HtmlReportInput } from '../exportHtml';
import { SolveResult } from '../../types';

const points = [
  { id: 'a', label: 'Gare <Nord>', latitude: 48.8809, longitude: 2.3553 },
  { id: 'b', label: 'Louvre', latitude: 48.8606, longitude: 2.3376 },
  { id: 'c', label: 'Bastille', latitude: 48.8532, longitude: 2.3692 },
];

const result: SolveResult = {
  orderedPoints: [...points, points[0]],
  orderedIds: ['a', 'b', 'c', 'a'],
  totalDistance: 9000,
  totalDuration: 3000,
  strategy: 'exact',
  warnings: [],
  provenOptimal: true,
};

const input: HtmlReportInput = {
  result,
  travelMode: 'transit',
  matrixProvider: 'google',
  geometry: [[48.88, 2.35], [48.86, 2.33], [48.85, 2.36], [48.88, 2.35]],
  generatedAt: new Date('2026-11-06T10:00:00Z'),
  warnings: ['Something </script> odd'],
  legs: [
    {
      distance: 3000,
      duration: 900,
      transit: {
        duration: 900,
        steps: [
          { kind: 'walk', duration: 120, distance: 150 },
          {
            kind: 'transit',
            duration: 600,
            ride: {
              line: '7',
              color: '#FA9ABA',
              textColor: '#000000',
              vehicleType: 'SUBWAY',
              vehicleName: 'Metro',
              headsign: 'Villejuif',
              departureStop: 'Gare du Nord',
              arrivalStop: 'Palais Royal',
              departureText: '10:05',
              arrivalText: '10:15',
              stopCount: 6,
              agency: 'RATP',
              agencyUrl: 'javascript:alert(1)',
            },
          },
        ],
      },
    },
    { distance: 3000, duration: 1000 },
    { distance: 3000, duration: 1100 },
  ],
};

const assets = { leafletJs: 'window.L={}; "</script>";', leafletCss: '.leaflet-container{}' };

describe('HTML export', () => {
  const html = buildHtmlReport(input, assets);

  it('is a standalone page with Leaflet inlined', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('window.L={}');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
    // Inlined code cannot close its own script element early.
    expect(html.match(/<\/script>/g)).toHaveLength(3); // data, Leaflet, page script
  });

  it('lists every stop and leg, escaped', () => {
    expect(html).toContain('Gare &lt;Nord&gt;');
    expect(html.match(/class="item /g)).toHaveLength(4);
    expect(html).toContain('Back to start');
    expect(html).toContain('Proven optimal');
  });

  it('includes public transit steps', () => {
    expect(html).toContain('towards Villejuif');
    expect(html).toContain('Palais Royal');
    expect(html).toContain('6 stops');
    expect(html).toContain('background:#FA9ABA');
    expect(html).toContain('10:05 – 10:15');
    expect(html).toContain('RATP');
    expect(html).not.toContain('javascript:alert');
  });

  it('has a locate-me button and embeds route data as safe JSON', () => {
    expect(html).toContain('id="locate-btn"');
    expect(html).toContain('navigator.geolocation');
    const json = html.match(/<script id="route-data" type="application\/json">(.*?)<\/script>/s)?.[1];
    const data = JSON.parse(json!);
    expect(data.stops).toHaveLength(4);
    expect(data.stops[0].label).toBe('Gare <Nord>');
    expect(data.isLoop).toBe(true);
    expect(data.line).toHaveLength(4);
  });
});
