/**
 * Address search for adding stops.
 * - With an OpenRouteService key: ORS (Pelias) autocomplete, suitable for search-as-you-type.
 * - Without a key: OpenStreetMap Nominatim. Its usage policy forbids autocomplete, so the UI
 *   only queries it on explicit submit (Enter / search button), at most about once per second.
 */
export interface GeocodeResult {
  label: string;
  detail?: string;
  latitude: number;
  longitude: number;
}

// openrouteservice is moving to api.heigit.org; the legacy host is kept as a fallback.
const ORS_AUTOCOMPLETE_URLS = ['https://api.heigit.org/pelias/v1/autocomplete', 'https://api.openrouteservice.org/geocode/autocomplete'];
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

const language = () => (typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'fr');

interface OrsFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { name?: string; label?: string; locality?: string; region?: string; country?: string };
}

/** ORS autocomplete, falling back to Nominatim if ORS is unreachable or rejects the key. */
export const searchPlaces = async (query: string, apiKey: string, focus?: [number, number], signal?: AbortSignal): Promise<GeocodeResult[]> => {
  if (!apiKey) return searchWithNominatim(query, signal);
  try {
    return await searchWithOrs(query, apiKey, focus, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    return searchWithNominatim(query, signal);
  }
};

export const searchWithOrs = async (query: string, apiKey: string, focus?: [number, number], signal?: AbortSignal): Promise<GeocodeResult[]> => {
  const params = new URLSearchParams({ api_key: apiKey, text: query, size: '6' });
  if (focus) {
    params.set('focus.point.lat', focus[0].toFixed(4));
    params.set('focus.point.lon', focus[1].toFixed(4));
  }
  let body: { features?: OrsFeature[] } | undefined;
  let lastStatus = 0;
  for (const url of ORS_AUTOCOMPLETE_URLS) {
    try {
      const response = await fetch(url + '?' + params.toString(), { signal });
      if (response.ok) {
        body = await response.json();
        break;
      }
      lastStatus = response.status;
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  if (!body) throw new Error('Recherche OpenRouteService indisponible' + (lastStatus ? ' (' + lastStatus + ')' : '') + '.');
  return (body.features || [])
    .filter((feature) => feature.geometry?.coordinates)
    .map((feature) => {
      const [longitude, latitude] = feature.geometry!.coordinates!;
      const props = feature.properties || {};
      const label = props.name || props.label || 'Lieu';
      const detail = [props.locality, props.region, props.country].filter(Boolean).join(', ');
      return { label, detail: detail || props.label, latitude, longitude };
    });
};

interface NominatimItem {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
}

const splitDisplayName = (item: NominatimItem): { label: string; detail?: string } => {
  const parts = item.display_name.split(',').map((part) => part.trim());
  const label = item.name || parts[0] || item.display_name;
  const rest = parts.filter((part) => part !== label);
  return { label, detail: rest.slice(0, 3).join(', ') || undefined };
};

export const searchWithNominatim = async (query: string, signal?: AbortSignal): Promise<GeocodeResult[]> => {
  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '6', 'accept-language': language() });
  const response = await fetch(NOMINATIM_SEARCH_URL + '?' + params.toString(), { signal });
  if (!response.ok) throw new Error('Recherche indisponible (Nominatim ' + response.status + ').');
  const items = (await response.json()) as NominatimItem[];
  return items.map((item) => ({ ...splitDisplayName(item), latitude: Number(item.lat), longitude: Number(item.lon) }));
};

/** Best-effort name for a point picked on the map. Returns undefined on any failure. */
export const reverseGeocode = async (latitude: number, longitude: number): Promise<string | undefined> => {
  try {
    const params = new URLSearchParams({
      lat: String(latitude),
      lon: String(longitude),
      format: 'jsonv2',
      zoom: '18',
      'accept-language': language(),
    });
    const response = await fetch(NOMINATIM_REVERSE_URL + '?' + params.toString());
    if (!response.ok) return undefined;
    const body = (await response.json()) as { name?: string; address?: Record<string, string> };
    const address = body.address || {};
    const street = [address.house_number, address.road].filter(Boolean).join(' ');
    return body.name || street || address.suburb || address.village || address.town || address.city || undefined;
  } catch {
    return undefined;
  }
};
