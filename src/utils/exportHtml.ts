import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Footprints, LucideIcon } from 'lucide-react';
import { CoordinatePoint, SolveResult, TransitLeg, TransitRide, TravelMode } from '../types';
import { describeOptimality, formatDistance, formatDuration, STRATEGY_LABELS } from '../ui/format';
import { travelModeOption } from '../ui/travelModes';
import { formatClock, vehicleIcon } from '../components/TransitSteps';
import { buildGoogleMapsLinks } from './exportRoute';

/**
 * Standalone HTML export: a single file with the whole itinerary (stops, legs, public-transport
 * steps) and an interactive Leaflet map. Everything is inlined (Leaflet included); only the map
 * tiles are fetched from the network. The page can locate the reader with the Geolocation API.
 */

export interface HtmlReportLeg {
  distance?: number;
  duration?: number;
  transit?: TransitLeg;
}

export interface HtmlReportInput {
  result: SolveResult;
  legs: HtmlReportLeg[];
  travelMode: TravelMode | string;
  matrixProvider?: string;
  geometry: [number, number][];
  warnings?: string[];
  /** Defaults to now. */
  generatedAt?: Date;
}

export interface HtmlReportAssets {
  leafletJs: string;
  leafletCss: string;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Keeps inlined code from closing its own <script>/<style> element. */
const inlineSafe = (code: string, tag: 'script' | 'style') => code.replace(new RegExp('</' + tag, 'gi'), '<\\/' + tag);

/** JSON that is safe inside a <script> element. */
const jsonForScript = (value: unknown) =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const icon = (Icon: LucideIcon, size = 14) => renderToStaticMarkup(createElement(Icon, { size, 'aria-hidden': true }));

const safeColor = (value: string | undefined) => (value && /^#[0-9a-f]{3,8}$/i.test(value) ? value : undefined);

const lineBadge = (ride: TransitRide) => {
  const color = safeColor(ride.color);
  const style = color ? ` style="background:${color};border-color:${color};color:${safeColor(ride.textColor) || '#fff'}"` : '';
  const title = [ride.vehicleName, ride.lineName].filter(Boolean).join(' · ');
  return `<span class="line-badge"${style}${title ? ` title="${escapeHtml(title)}"` : ''}>${icon(vehicleIcon(ride.vehicleType), 13)}${escapeHtml(ride.line)}</span>`;
};

const walkBadge = (duration?: number) =>
  `<span class="walk-badge" title="Walk">${icon(Footprints, 13)}${duration ? Math.max(1, Math.round(duration / 60)) : ''}</span>`;

const transitHtml = (leg: TransitLeg) => {
  const rides = leg.steps.filter((step) => step.ride).map((step) => step.ride as TransitRide);
  const first = rides[0];
  const last = rides[rides.length - 1];
  const leave = first && formatClock(first.departureText, first.departureTime);
  const arrive = last && formatClock(last.arrivalText, last.arrivalTime);
  const times = rides.length === 0 ? 'Walk only' : leave && arrive ? leave + ' – ' + arrive : formatDuration(leg.duration);
  const chips = leg.steps
    .map((step, index) => (index > 0 ? '<span class="sep">›</span>' : '') + (step.ride ? lineBadge(step.ride) : walkBadge(step.duration)))
    .join('');
  const steps = leg.steps
    .map((step) => {
      if (!step.ride) {
        return `<li class="tstep tstep--walk">${icon(Footprints, 16)}<span>Walk ${escapeHtml(formatDuration(step.duration))}${
          step.distance ? ' · ' + escapeHtml(formatDistance(step.distance)) : ''
        }</span></li>`;
      }
      const ride = step.ride;
      const meta = [
        ride.vehicleName,
        ride.stopCount !== undefined ? ride.stopCount + (ride.stopCount === 1 ? ' stop' : ' stops') : undefined,
        step.duration ? formatDuration(step.duration) : undefined,
      ]
        .filter(Boolean)
        .map((part) => escapeHtml(String(part)));
      if (ride.agency) {
        const agency = escapeHtml(ride.agency);
        meta.push(ride.agencyUrl && /^https?:\/\//i.test(ride.agencyUrl) ? `<a href="${escapeHtml(ride.agencyUrl)}" target="_blank" rel="noreferrer">${agency}</a>` : agency);
      }
      return `<li class="tstep">${icon(vehicleIcon(ride.vehicleType), 16)}<div class="tride">
  <div class="tline">${lineBadge(ride)}${ride.headsign ? `<span class="headsign">towards ${escapeHtml(ride.headsign)}</span>` : ''}</div>
  <div class="tstop"><time>${escapeHtml(formatClock(ride.departureText, ride.departureTime) ?? '–')}</time><span>${escapeHtml(ride.departureStop ?? 'Departure stop')}</span></div>
  <div class="tstop"><time>${escapeHtml(formatClock(ride.arrivalText, ride.arrivalTime) ?? '–')}</time><span>${escapeHtml(ride.arrivalStop ?? 'Arrival stop')}</span></div>
  <small class="tmeta">${meta.join(' · ')}</small>
</div></li>`;
    })
    .join('\n');
  return `<details class="transit" open>
<summary><span class="chips">${chips}</span><span class="ttimes">${escapeHtml(times)}</span></summary>
<ol class="tsteps">
${steps}
</ol>
</details>`;
};

const GOOGLE_MODES: Record<string, string> = {
  'driving-car': 'driving',
  'driving-hgv': 'driving',
  'cycling-regular': 'bicycling',
  'cycling-electric': 'bicycling',
  'foot-walking': 'walking',
  'foot-hiking': 'walking',
  transit: 'transit',
};

/** Google Maps directions from the reader's current location to one stop. */
const directionsTo = (stop: CoordinatePoint, travelMode: string) =>
  'https://www.google.com/maps/dir/?' +
  new URLSearchParams({ api: '1', destination: stop.latitude.toFixed(6) + ',' + stop.longitude.toFixed(6), travelmode: GOOGLE_MODES[travelMode] ?? 'driving' }).toString();

export const buildHtmlReport = (input: HtmlReportInput, assets: HtmlReportAssets): string => {
  const { result, legs, travelMode, matrixProvider, geometry } = input;
  const route = result.orderedPoints;
  const isLoop = route.length > 1 && route[0].id === route[route.length - 1].id;
  const stopCount = isLoop ? route.length - 1 : route.length;
  const mode = travelModeOption(travelMode as TravelMode);
  const optimality = describeOptimality(result);
  const generatedAt = input.generatedAt ?? new Date();
  const title = 'Route · ' + stopCount + ' stops · ' + mode.label;
  const googleLinks = buildGoogleMapsLinks(route, travelMode);
  const hasTransit = legs.some((leg) => leg.transit);

  const items = route
    .map((point, index) => {
      const isFirst = index === 0;
      const isLast = index === route.length - 1;
      const leg = legs[index];
      const kind = isFirst ? 'start' : isLast ? 'end' : 'stop';
      const badge = isLast && isLoop ? '↺' : String(index + 1);
      const role = isFirst ? 'Start' : isLast ? (isLoop ? 'Back to start' : 'End') : '';
      const legHtml =
        !isLast && leg
          ? `<div class="leg"><span class="leg__summary">${escapeHtml(formatDistance(leg.distance))}${leg.duration ? ' · ' + escapeHtml(formatDuration(leg.duration)) : ''}</span>${
              leg.transit ? transitHtml(leg.transit) : ''
            }</div>`
          : '';
      // A loop's final stop is the start again: it shares the start's checkbox.
      const doneKey = isLast && isLoop ? '' : `<label class="done"><input type="checkbox" data-done="${index}"> Done</label>`;
      return `<li class="item item--${kind}" data-index="${index}">
<div class="stop">
  <button type="button" class="dot dot--${kind}" data-focus="${index}" aria-label="Show on map">${badge}</button>
  <div class="stop__body">
    <button type="button" class="stop__label" data-focus="${index}">${escapeHtml(point.label)}</button>
    <div class="stop__meta">${role ? `<span class="role">${role}</span>` : ''}<span class="coords">${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}</span><span class="dist" data-dist="${index}"></span></div>
    <div class="stop__actions"><a href="${escapeHtml(directionsTo(point, travelMode))}" target="_blank" rel="noreferrer">Directions</a>${doneKey}</div>
  </div>
</div>
${legHtml}
</li>`;
    })
    .join('\n');

  const stats = [
    ['Distance', formatDistance(result.totalDistance)],
    ...(result.totalDuration ? [['Duration', formatDuration(result.totalDuration)]] : []),
    ['Stops', String(stopCount)],
    ['Mode', mode.label],
  ]
    .map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join('');

  const warnings = (input.warnings ?? []).length
    ? `<details class="callout"><summary>${input.warnings!.length === 1 ? '1 warning' : input.warnings!.length + ' warnings'}</summary><ul>${input
        .warnings!.map((warning) => `<li>${escapeHtml(warning)}</li>`)
        .join('')}</ul></details>`
    : '';

  const data = {
    stops: route.map((point, index) => ({ label: point.label, lat: point.latitude, lon: point.longitude, index })),
    isLoop,
    line: geometry.length > 1 ? geometry.map(([lat, lon]) => [+lat.toFixed(6), +lon.toFixed(6)]) : route.map((point) => [point.latitude, point.longitude]),
    storageKey: 'tsp-route-done:' + route.map((point) => point.latitude.toFixed(5) + ',' + point.longitude.toFixed(5)).join('|'),
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="generator" content="TSP Solver">
<title>${escapeHtml(title)}</title>
<style>
${inlineSafe(assets.leafletCss, 'style')}
</style>
<style>
${inlineSafe(PAGE_CSS, 'style')}
</style>
</head>
<body>
<div class="layout">
  <div class="map-pane"><div id="map" role="region" aria-label="Route map"></div></div>
  <main class="panel">
    <header>
      <h1>${escapeHtml(stopCount + ' stops by ' + mode.label.toLowerCase())}</h1>
      <p class="sub">Generated ${escapeHtml(generatedAt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))} with TSP Solver</p>
    </header>
    <div class="stats">${stats}</div>
    <p class="quality quality--${optimality.kind}"><strong>${escapeHtml(optimality.label)}</strong> · ${escapeHtml(STRATEGY_LABELS[result.strategy])} · ${escapeHtml(
      matrixProvider || 'unknown distances'
    )}</p>
    <div class="actions">
      <button type="button" class="btn btn--primary" id="locate-btn">${LOCATE_ICON} Locate me</button>
      ${googleLinks
        .map(
          (link, index) =>
            `<a class="btn" href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${googleLinks.length > 1 ? 'Google Maps ' + (index + 1) + '/' + googleLinks.length : 'Open in Google Maps'}</a>`
        )
        .join('\n      ')}
    </div>
    <p class="locate-status" id="locate-status" hidden></p>
    ${warnings}
    ${hasTransit ? '<p class="note">Transit times were planned for leaving at export time; each leg was planned on its own.</p>' : ''}
    <ol class="timeline">
${items}
    </ol>
    <footer>Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors. Map tiles need an internet connection; everything else works offline.</footer>
  </main>
</div>
<script id="route-data" type="application/json">${jsonForScript(data)}</script>
<script>
${inlineSafe(assets.leafletJs, 'script')}
</script>
<script>
${inlineSafe(PAGE_SCRIPT, 'script')}
</script>
</body>
</html>
`;
};

const LOCATE_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>';

const PAGE_CSS = `
:root {
  --bg: #f4f5f9; --surface: #fff; --surface-2: #f1f3f8; --border: #e3e6ee;
  --text: #141824; --text-2: #5b6275; --text-3: #8a90a2;
  --primary: #4f46e5; --primary-soft: #eef0ff; --start: #16a34a; --end: #e11d48;
  --warning: #b45309; --warning-soft: #fff6e5; --me: #2563eb;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f121a; --surface: #171b26; --surface-2: #1f2432; --border: #2b3142;
    --text: #eef0f6; --text-2: #a6adbf; --text-3: #7b8297; --primary: #818cf8; --primary-soft: #262b4a;
    --warning: #fbbf24; --warning-soft: #33280f;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { background: var(--bg); color: var(--text); font: 15px/1.45 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
a { color: var(--primary); }
button { font: inherit; color: inherit; }
.layout { display: flex; flex-direction: column; min-height: 100%; }
.map-pane { position: sticky; top: 0; z-index: 1; height: 45vh; height: 45svh; min-height: 220px; }
#map { position: absolute; inset: 0; background: #e9ecf2; }
.panel { padding: 16px 16px 32px; max-width: 760px; width: 100%; margin: 0 auto; }
@media (min-width: 900px) {
  .layout { flex-direction: row; height: 100%; }
  .map-pane { order: 2; flex: 1; height: auto; position: relative; }
  .panel { width: 440px; max-width: none; margin: 0; overflow-y: auto; border-right: 1px solid var(--border); background: var(--surface); }
}
h1 { font-size: 1.35rem; margin: 0 0 2px; }
.sub { margin: 0 0 14px; color: var(--text-3); font-size: 0.85rem; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap: 8px; }
.stat { background: var(--surface-2); border-radius: 10px; padding: 8px 10px; display: flex; flex-direction: column; }
.stat span { font-size: 0.72rem; color: var(--text-3); text-transform: uppercase; letter-spacing: .04em; }
.stat strong { font-size: 1.05rem; }
.quality { margin: 10px 0; font-size: 0.85rem; color: var(--text-2); }
.quality--optimal strong { color: var(--start); }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.btn { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-weight: 600; text-decoration: none; cursor: pointer; }
.btn--primary { background: var(--primary); border-color: var(--primary); color: #fff; }
.btn[aria-pressed="true"] { box-shadow: 0 0 0 3px var(--primary-soft); }
.locate-status { margin: 0 0 12px; padding: 8px 10px; border-radius: 10px; background: var(--primary-soft); font-size: 0.88rem; }
.locate-status.is-error { background: var(--warning-soft); color: var(--warning); }
.callout { background: var(--warning-soft); color: var(--warning); border-radius: 10px; padding: 8px 12px; margin: 8px 0; font-size: 0.88rem; }
.note { font-size: 0.82rem; color: var(--text-3); }
.timeline { list-style: none; margin: 16px 0 0; padding: 0; }
.item { position: relative; padding-bottom: 6px; }
.item:not(:last-child)::before { content: ''; position: absolute; left: 15px; top: 32px; bottom: 0; border-left: 3px dotted var(--border); }
.stop { display: flex; gap: 12px; align-items: flex-start; }
.dot { flex: none; width: 32px; height: 32px; border-radius: 50%; border: 3px solid var(--surface); background: var(--text); color: var(--surface); font-weight: 750; font-size: .8rem; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
.dot--start { background: var(--start); color: #fff; }
.dot--end { background: var(--end); color: #fff; }
.stop__body { min-width: 0; flex: 1; padding-top: 4px; }
.stop__label { all: unset; cursor: pointer; font-weight: 650; overflow-wrap: anywhere; }
.stop__label:focus-visible, .dot:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.stop__meta { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: .78rem; color: var(--text-3); }
.role { color: var(--text-2); font-weight: 600; }
.dist:empty { display: none; }
.dist { color: var(--me); font-weight: 600; }
.stop__actions { display: flex; gap: 14px; align-items: center; font-size: .82rem; margin-top: 2px; }
.done { display: inline-flex; align-items: center; gap: 4px; color: var(--text-2); cursor: pointer; }
.item.is-done .stop__label { text-decoration: line-through; color: var(--text-3); }
.item.is-done .dot { opacity: .5; }
.item.is-nearest .dot { box-shadow: 0 0 0 3px var(--me); }
.leg { margin: 6px 0 10px 44px; font-size: .85rem; color: var(--text-2); }
.leg__summary { display: inline-block; padding: 2px 8px; border-radius: 999px; background: var(--surface-2); }
.transit { margin-top: 6px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.transit summary { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; }
.chips { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; flex: 1; }
.sep { color: var(--text-3); }
.ttimes { font-weight: 600; color: var(--text); white-space: nowrap; }
.line-badge, .walk-badge { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); font-size: .78rem; font-weight: 700; }
.walk-badge { background: transparent; border-color: transparent; color: var(--text-2); font-weight: 500; }
.tsteps { list-style: none; margin: 0; padding: 4px 10px 10px; }
.tstep { display: flex; gap: 10px; padding: 6px 0; border-top: 1px solid var(--border); }
.tstep > svg { flex: none; margin-top: 2px; color: var(--text-3); }
.tstep--walk { color: var(--text-2); }
.tride { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tline { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.headsign { color: var(--text-2); }
.tstop { display: flex; gap: 8px; color: var(--text); }
.tstop time { min-width: 3.6em; font-variant-numeric: tabular-nums; font-weight: 600; }
.tmeta { color: var(--text-3); }
footer { margin-top: 24px; font-size: .75rem; color: var(--text-3); }
.pin-wrapper { background: none; border: none; }
.pin { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: #141824; border: 3px solid #fff; color: #fff; font: 750 .78rem system-ui, sans-serif; box-shadow: 0 2px 6px rgba(0,0,0,.35); }
.pin--start, .pin--both { background: #16a34a; }
.pin--end { background: #e11d48; }
.pin--done { opacity: .45; }
.me-dot { width: 18px; height: 18px; border-radius: 50%; background: var(--me); border: 3px solid #fff; box-shadow: 0 0 0 2px rgba(37,99,235,.35), 0 1px 4px rgba(0,0,0,.4); }
.leaflet-control-locate a { display: grid !important; place-items: center; color: #141824; }
.leaflet-control-locate.is-active a { color: var(--me); }
@media print {
  .map-pane { position: static; height: 60vh; page-break-after: always; }
  .actions, .done, .stop__actions a { display: none; }
  .transit { break-inside: avoid; }
}
`;

/** Runs inside the exported page (plain ES2017, no build step). */
const PAGE_SCRIPT = `
(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('route-data').textContent);
  var map = L.map('map', { zoomControl: true });
  var osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  });
  // Some tile servers refuse requests without a Referer (as from a local file): fall back to CARTO.
  var tileErrors = 0;
  osm.on('tileerror', function () {
    if (++tileErrors !== 4) return;
    map.removeLayer(osm);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19, subdomains: 'abcd',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(map);
  });
  osm.addTo(map);

  if (data.line.length > 1) {
    L.polyline(data.line, { color: '#ffffff', weight: 9, opacity: 0.9 }).addTo(map);
    L.polyline(data.line, { color: '#4f46e5', weight: 5, opacity: 0.95 }).addTo(map);
  }

  var last = data.stops.length - 1;
  var markers = [];
  data.stops.forEach(function (stop, i) {
    if (data.isLoop && i === last) { markers.push(markers[0]); return; }
    var kind = i === 0 ? (data.isLoop ? 'both' : 'start') : i === last ? 'end' : 'stop';
    var el = document.createElement('div');
    el.className = 'pin pin--' + kind;
    el.innerHTML = '<span></span>';
    el.firstChild.textContent = String(i + 1);
    var marker = L.marker([stop.lat, stop.lon], {
      icon: L.divIcon({ className: 'pin-wrapper', html: el.outerHTML, iconSize: [30, 30], iconAnchor: [15, 15], tooltipAnchor: [0, -16] }),
      zIndexOffset: kind === 'stop' ? 0 : 500,
      keyboard: false
    }).addTo(map);
    marker.bindTooltip(document.createTextNode(stop.label), { direction: 'top' });
    marker.on('click', function () { scrollToItem(i); });
    markers.push(marker);
  });

  var bounds = L.latLngBounds(data.line.concat(data.stops.map(function (s) { return [s.lat, s.lon]; })));
  function fitAll() { map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 }); }
  fitAll();

  function itemAt(i) { return document.querySelector('.item[data-index="' + i + '"]'); }
  function scrollToItem(i) {
    var item = itemAt(i);
    if (item) item.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Click a stop in the list: show it on the map.
  document.addEventListener('click', function (event) {
    var target = event.target.closest('[data-focus]');
    if (!target) return;
    var i = +target.getAttribute('data-focus');
    var stop = data.stops[i];
    map.setView([stop.lat, stop.lon], Math.max(map.getZoom(), 15), { animate: true });
    if (markers[i]) markers[i].openTooltip();
    if (window.matchMedia('(max-width: 899px)').matches) window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // "Done" checkboxes, remembered in this browser.
  var done = {};
  try { done = JSON.parse(localStorage.getItem(data.storageKey) || '{}') || {}; } catch (e) { done = {}; }
  function applyDone(i) {
    var on = !!done[i];
    var item = itemAt(i);
    if (item) item.classList.toggle('is-done', on);
    if (data.isLoop && i === 0) { var back = itemAt(last); if (back) back.classList.toggle('is-done', on); }
    var pin = markers[i] && markers[i].getElement && markers[i].getElement();
    if (pin && pin.firstChild) pin.firstChild.classList.toggle('pin--done', on);
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-done]'), function (box) {
    var i = +box.getAttribute('data-done');
    box.checked = !!done[i];
    applyDone(i);
    box.addEventListener('change', function () {
      if (box.checked) done[i] = true; else delete done[i];
      try { localStorage.setItem(data.storageKey, JSON.stringify(done)); } catch (e) { /* private mode */ }
      applyDone(i);
    });
  });

  // Geolocation.
  var button = document.getElementById('locate-btn');
  var statusEl = document.getElementById('locate-status');
  var watchId = null, meMarker = null, meCircle = null, firstFix = false, control = null;

  function setStatus(text, isError) {
    statusEl.hidden = !text;
    statusEl.textContent = text || '';
    statusEl.classList.toggle('is-error', !!isError);
  }
  function setActive(on) {
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.lastChild.textContent = on ? ' Stop locating' : ' Locate me';
    if (control) control.getContainer().classList.toggle('is-active', on);
  }
  function haversine(a, b, c, d) {
    var r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2);
    return 12742000 * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y));
  }
  function fmt(m) { return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(m < 100000 ? 1 : 0) + ' km'; }

  function onPosition(pos) {
    var lat = pos.coords.latitude, lon = pos.coords.longitude, acc = pos.coords.accuracy || 0;
    if (!meMarker) {
      meCircle = L.circle([lat, lon], { radius: acc, color: '#2563eb', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map);
      meMarker = L.marker([lat, lon], { icon: L.divIcon({ className: 'pin-wrapper', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 1000, keyboard: false })
        .bindTooltip('You are here', { direction: 'top' }).addTo(map);
    } else {
      meMarker.setLatLng([lat, lon]);
      meCircle.setLatLng([lat, lon]).setRadius(acc);
    }
    if (!firstFix) {
      firstFix = true;
      map.setView([lat, lon], Math.max(map.getZoom(), 15), { animate: true });
    }
    var best = -1, bestDist = Infinity;
    data.stops.forEach(function (stop, i) {
      if (data.isLoop && i === last) return;
      var d = haversine(lat, lon, stop.lat, stop.lon);
      var cell = document.querySelector('[data-dist="' + i + '"]');
      if (cell) cell.textContent = fmt(d) + ' from you';
      if (!done[i] && d < bestDist) { bestDist = d; best = i; }
    });
    Array.prototype.forEach.call(document.querySelectorAll('.item.is-nearest'), function (el) { el.classList.remove('is-nearest'); });
    if (best >= 0) {
      var item = itemAt(best);
      if (item) item.classList.add('is-nearest');
      setStatus('Nearest remaining stop: ' + (best + 1) + '. ' + data.stops[best].label + ' (' + fmt(bestDist) + '). Accuracy ±' + fmt(acc) + '.');
    } else {
      setStatus('All stops are done. Accuracy ±' + fmt(acc) + '.');
    }
  }
  function onError(err) {
    var messages = {
      1: 'Location permission was denied. Allow location access for this page in your browser settings, then try again.',
      2: 'Your position is unavailable right now.',
      3: 'Locating took too long. Try again.'
    };
    setStatus(messages[err.code] || 'Could not get your position.', true);
    if (err.code === 1) stop();
  }
  function start() {
    if (!navigator.geolocation) { setStatus('This browser cannot share your location.', true); return; }
    if (window.isSecureContext === false) {
      setStatus('Your browser only shares your location with pages opened from a file or over https.', true);
      return;
    }
    firstFix = false;
    setStatus('Locating…');
    watchId = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
    setActive(true);
  }
  function stop() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    setActive(false);
  }
  function toggle() {
    if (watchId === null) start();
    else if (meMarker && !map.getBounds().contains(meMarker.getLatLng())) map.setView(meMarker.getLatLng(), Math.max(map.getZoom(), 15));
    else stop();
  }
  button.addEventListener('click', toggle);

  var Locate = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function () {
      var div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-locate');
      var a = L.DomUtil.create('a', '', div);
      a.href = '#'; a.title = 'Locate me'; a.setAttribute('role', 'button'); a.setAttribute('aria-label', 'Locate me');
      a.innerHTML = ${JSON.stringify(LOCATE_ICON)};
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(a, 'click', function (e) { L.DomEvent.preventDefault(e); toggle(); });
      return div;
    }
  });
  control = new Locate();
  control.addTo(map);

  var Fit = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function () {
      var div = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      var a = L.DomUtil.create('a', '', div);
      a.href = '#'; a.title = 'Show the whole route'; a.setAttribute('role', 'button'); a.textContent = '⤢';
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(a, 'click', function (e) { L.DomEvent.preventDefault(e); fitAll(); });
      return div;
    }
  });
  new Fit().addTo(map);
})();
`;
