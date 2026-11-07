import { downloadTextFile } from './exportRoute';
import type { HtmlReportInput } from './exportHtml';

/**
 * Builds and downloads the standalone HTML itinerary. Loaded on demand so Leaflet's sources
 * (inlined into the file) and the HTML builder stay out of the main bundle.
 */
export const downloadHtmlReport = async (input: HtmlReportInput) => {
  const [{ buildHtmlReport }, leafletJs, leafletCss] = await Promise.all([
    import('./exportHtml'),
    import('leaflet/dist/leaflet.js?raw').then((module) => module.default),
    import('leaflet/dist/leaflet.css?raw').then((module) => module.default),
  ]);
  const date = (input.generatedAt ?? new Date()).toISOString().slice(0, 10);
  downloadTextFile('route-' + date + '.html', buildHtmlReport(input, { leafletJs, leafletCss }), 'text/html');
};
