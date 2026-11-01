import { FormEvent, useEffect, useRef, useState } from 'react';
import { Loader2, LocateFixed, MapPin, Search, X } from 'lucide-react';
import { GeocodeResult, searchPlaces, searchWithNominatim } from '../services/geocoding';
import { parseCoordinateLines } from '../utils/coordinateParser';

export interface StopSearchProps {
  orsApiKey: string;
  focus?: [number, number];
  onAdd: (result: GeocodeResult) => void;
  onFocusChange?: (focused: boolean) => void;
}

/**
 * Search box for adding stops. Accepts an address / place name or raw "lat, lon" coordinates.
 * Searches as you type with an ORS key; otherwise on Enter (Nominatim usage policy).
 */
export const StopSearch = ({ orsApiKey, focus, onAdd, onFocusChange }: StopSearchProps) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle');
  const [message, setMessage] = useState<string>();
  const [locating, setLocating] = useState(false);
  const abortRef = useRef<AbortController>();
  const inputRef = useRef<HTMLInputElement>(null);
  const live = !!orsApiKey;

  const coordinateMatch = (() => {
    const parsed = parseCoordinateLines(query);
    return query.trim() && parsed.points.length === 1 && parsed.errors.length === 0 ? parsed.points[0] : undefined;
  })();

  const runSearch = async (text: string) => {
    abortRef.current?.abort();
    if (text.trim().length < 3) {
      setResults([]);
      setStatus('idle');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('loading');
    try {
      const found = live ? await searchPlaces(text, orsApiKey, focus, controller.signal) : await searchWithNominatim(text, controller.signal);
      if (controller.signal.aborted) return;
      setResults(found);
      setStatus(found.length ? 'idle' : 'empty');
    } catch (error) {
      if (controller.signal.aborted) return;
      setResults([]);
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Search unavailable.');
    }
  };

  useEffect(() => {
    if (!live || coordinateMatch) return;
    const timer = window.setTimeout(() => runSearch(query), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, live]);

  const reset = () => {
    abortRef.current?.abort();
    setQuery('');
    setResults([]);
    setStatus('idle');
  };

  const pick = (result: GeocodeResult) => {
    onAdd(result);
    reset();
    inputRef.current?.focus();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (coordinateMatch) {
      pick({ label: coordinateMatch.label, latitude: coordinateMatch.latitude, longitude: coordinateMatch.longitude });
      return;
    }
    if (results.length && live) {
      pick(results[0]);
      return;
    }
    runSearch(query);
  };

  const locate = () => {
    if (!navigator.geolocation) {
      setStatus('error');
      setMessage('Geolocation is not available on this device.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        onAdd({ label: 'My location', latitude: position.coords.latitude, longitude: position.coords.longitude });
      },
      () => {
        setLocating(false);
        setStatus('error');
        setMessage('Could not get your location (permission denied?).');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div className="search">
      <form className="search__bar" onSubmit={submit} role="search">
        <Search className="search__icon" size={18} aria-hidden />
        <input
          ref={inputRef}
          type="search"
          enterKeyHint="search"
          value={query}
          placeholder="Add an address or place…"
          onChange={(event) => {
            setQuery(event.target.value);
            if (!live) {
              setResults([]);
              setStatus('idle');
            }
          }}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
          aria-label="Add a stop"
        />
        {status === 'loading' && <Loader2 className="spin search__trailing" size={18} aria-label="Searching…" />}
        {query && status !== 'loading' && (
          <button type="button" className="icon-button icon-button--ghost search__trailing" onClick={reset} aria-label="Clear">
            <X size={18} />
          </button>
        )}
        <button type="button" className="icon-button" onClick={locate} aria-label="Add my location" title="Add my location">
          {locating ? <Loader2 className="spin" size={18} /> : <LocateFixed size={18} />}
        </button>
      </form>
      {(results.length > 0 || coordinateMatch || status === 'empty' || status === 'error') && (
        <ul className="search__results" role="listbox">
          {coordinateMatch && (
            <li>
              <button type="button" onClick={() => pick({ label: coordinateMatch.label, latitude: coordinateMatch.latitude, longitude: coordinateMatch.longitude })}>
                <MapPin size={16} aria-hidden />
                <span>
                  <strong>Add these coordinates</strong>
                  <small>
                    {coordinateMatch.latitude}, {coordinateMatch.longitude}
                  </small>
                </span>
              </button>
            </li>
          )}
          {results.map((result, index) => (
            <li key={index + result.label}>
              <button type="button" onClick={() => pick(result)}>
                <MapPin size={16} aria-hidden />
                <span>
                  <strong>{result.label}</strong>
                  {result.detail && <small>{result.detail}</small>}
                </span>
              </button>
            </li>
          ))}
          {status === 'empty' && <li className="search__message">No results.</li>}
          {status === 'error' && <li className="search__message search__message--error">{message}</li>}
        </ul>
      )}
    </div>
  );
};
