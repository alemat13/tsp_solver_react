/**
 * In-app diagnostic log: a ring buffer of timestamped events (API requests and answers, retries
 * and fallbacks, solver runs, cache use, uncaught errors) that the user can copy to the
 * clipboard to report a problem. Detailed enough to investigate an incident from the text alone.
 *
 * API keys never reach the log: URL parameters and header values that hold credentials are not
 * recorded, and every registered secret is masked again when the log is written out.
 *
 * The buffer is also saved to localStorage (best-effort), so that a log survives a reload and can
 * still be copied after the page was closed.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  /** Time (ms since epoch). */
  t: number;
  level: LogLevel;
  /** Area of the app: api, ors, google, solver, cache, app, ... */
  area: string;
  message: string;
  /** Extra structured details, serialised as compact JSON. */
  data?: unknown;
  /** Page load the entry belongs to. */
  session: string;
}

const MAX_ENTRIES = 1000;
const MAX_SAVED_ENTRIES = 400;
const MAX_DATA_CHARS = 4000;
const MAX_BODY_CHARS = 2000;
const STORAGE_KEY = 'tsp-diagnostic-log';
const MASK = '***';

const sessionId = Math.random().toString(36).slice(2, 8);
let entries: LogEntry[] = [];
const secrets = new Set<string>();
const listeners = new Set<() => void>();
let context: Record<string, unknown> = {};
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let requestCounter = 0;

const storage = (): Storage | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

const load = () => {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as LogEntry[]) : [];
    if (Array.isArray(saved)) entries = saved.filter((entry) => entry && typeof entry.t === 'number').slice(-MAX_ENTRIES);
  } catch {
    entries = [];
  }
};

const save = () => {
  saveTimer = undefined;
  try {
    storage()?.setItem(STORAGE_KEY, redact(JSON.stringify(entries.slice(-MAX_SAVED_ENTRIES))));
  } catch {
    // Storage full or blocked: the in-memory log still works.
  }
};

const scheduleSave = () => {
  if (saveTimer === undefined) saveTimer = setTimeout(save, 1000);
};

load();

/** Masks every registered secret, and anything that looks like a key in a query string. */
export const redact = (text: string): string => {
  let result = text;
  secrets.forEach((secret) => {
    if (secret.length >= 6) result = result.split(secret).join(MASK);
  });
  return result.replace(/([?&](?:api_?key|key|token|access_token|auth)=)[^&\s"']+/gi, '$1' + MASK);
};

/** Values (API keys) that must never appear in the log. */
export const registerSecrets = (...values: (string | undefined)[]) => {
  values.forEach((value) => {
    if (value && value.trim().length >= 6) secrets.add(value.trim());
  });
};

/** Facts about the current state (settings, stops) printed at the top of a copied log. */
export const setDiagnosticContext = (next: Record<string, unknown>) => {
  context = next;
};

/** Compact JSON with long arrays and strings shortened and coordinates rounded to ~1 m. */
export const summarise = (value: unknown, limit = MAX_DATA_CHARS): string => {
  let text: string;
  try {
    text = JSON.stringify(value, (_key, item) => {
      if (typeof item === 'number' && !Number.isInteger(item)) return Math.round(item * 1e5) / 1e5;
      if (typeof item === 'string' && item.length > 300) return item.slice(0, 300) + '…(' + item.length + ' chars)';
      if (Array.isArray(item) && item.length > 60) return [...item.slice(0, 60), '…(' + item.length + ' items)'];
      if (item instanceof Error) return { name: item.name, message: item.message };
      return item;
    });
  } catch {
    text = String(value);
  }
  if (text === undefined) text = String(value);
  return text.length > limit ? text.slice(0, limit) + '…(' + text.length + ' chars)' : text;
};

const emit = () => listeners.forEach((listener) => listener());

export const log = (level: LogLevel, area: string, message: string, data?: unknown) => {
  const entry: LogEntry = { t: Date.now(), level, area, message: redact(message), session: sessionId };
  if (data !== undefined) entry.data = redact(summarise(data));
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  scheduleSave();
  emit();
};

export const logDebug = (area: string, message: string, data?: unknown) => log('debug', area, message, data);
export const logInfo = (area: string, message: string, data?: unknown) => log('info', area, message, data);
export const logWarn = (area: string, message: string, data?: unknown) => log('warn', area, message, data);
export const logError = (area: string, message: string, data?: unknown) => log('error', area, message, data);

export const getLogEntries = (): readonly LogEntry[] => entries;

export const clearLog = () => {
  entries = [];
  save();
  emit();
};

export const subscribeToLog = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

const formatTime = (time: number) => {
  const date = new Date(time);
  return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds()) + '.' + pad(date.getMilliseconds(), 3);
};

const formatDay = (time: number) => {
  const date = new Date(time);
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
};

const timeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

const utcOffset = () => {
  const minutes = -new Date().getTimezoneOffset();
  return 'UTC' + (minutes >= 0 ? '+' : '-') + pad(Math.floor(Math.abs(minutes) / 60)) + ':' + pad(Math.abs(minutes) % 60);
};

const environment = (): string[] => {
  const lines: string[] = [];
  lines.push('App: TSP Planner, build ' + __APP_COMMIT__ + ' (' + __APP_BUILD_TIME__ + ')');
  if (typeof location !== 'undefined') lines.push('Page: ' + redact(location.origin + location.pathname));
  if (typeof navigator !== 'undefined') {
    lines.push('Browser: ' + navigator.userAgent);
    lines.push('Language: ' + navigator.language + ', online: ' + navigator.onLine);
  }
  if (typeof window !== 'undefined' && window.screen) {
    lines.push('Screen: ' + window.screen.width + 'x' + window.screen.height + ' @' + window.devicePixelRatio + 'x, viewport ' + window.innerWidth + 'x' + window.innerHeight);
  }
  lines.push('Time zone: ' + (timeZone() ?? '?') + ' (' + utcOffset() + '); times below are local');
  return lines;
};

/** The whole log as plain text, ready to paste into a bug report. */
export const formatLog = (): string => {
  const now = Date.now();
  const lines = ['=== TSP Planner diagnostic log ===', 'Copied: ' + new Date(now).toISOString(), ...environment()];
  Object.entries(context).forEach(([key, value]) => lines.push(key + ': ' + (typeof value === 'string' ? value : summarise(value))));
  lines.push('Entries: ' + entries.length + ' (current page load: ' + sessionId + ')', '');
  let day = '';
  let session = '';
  entries.forEach((entry) => {
    const entryDay = formatDay(entry.t);
    if (entry.session !== session || entryDay !== day) {
      lines.push('--- ' + entryDay + ', page load ' + entry.session + (entry.session === sessionId ? ' (current)' : '') + ' ---');
      day = entryDay;
      session = entry.session;
    }
    lines.push(
      formatTime(entry.t) + ' ' + entry.level.toUpperCase().padEnd(5) + ' [' + entry.area + '] ' + entry.message + (entry.data !== undefined ? ' ' + entry.data : '')
    );
  });
  return redact(lines.join('\n'));
};

/** Copies text to the clipboard, with a fallback for browsers without the async clipboard API. */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back below (e.g. permission denied in an iframe).
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
};

/* ───────── Network requests ───────── */

const describeUrl = (input: string): string => {
  try {
    const url = new URL(input, typeof location !== 'undefined' ? location.href : undefined);
    url.searchParams.forEach((_value, name) => {
      if (/key|token|secret|auth|signature/i.test(name)) url.searchParams.set(name, MASK);
    });
    return url.host + url.pathname + (url.search ? decodeURIComponent(url.search.replace(/\+/g, ' ')) : '');
  } catch {
    return input;
  }
};

const describeBody = (body: unknown): unknown => {
  if (typeof body !== 'string' || !body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) + '…' : body;
  }
};

/** Static files and map tiles are not worth logging; API calls are. */
const isWorthLogging = (url: string) => {
  try {
    const parsed = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
    return typeof location === 'undefined' || parsed.origin !== location.origin;
  } catch {
    return true;
  }
};

let fetchInstalled = false;

/**
 * Wraps window.fetch so that every API request is logged with its method, URL (credentials
 * masked), body summary, status, duration and, on failure, the start of the error body.
 */
export const installFetchLogger = () => {
  if (fetchInstalled || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  fetchInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!isWorthLogging(url)) return originalFetch(input, init);
    const id = ++requestCounter;
    const method = (init?.method || (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    const label = '#' + id + ' ' + method + ' ' + describeUrl(url);
    const body = describeBody(init?.body);
    logDebug('api', label, body !== undefined ? { body } : undefined);
    const started = performance.now();
    try {
      const response = await originalFetch(input, init);
      const ms = Math.round(performance.now() - started);
      if (response.ok) {
        const size = response.headers.get('content-length');
        logInfo('api', '#' + id + ' ' + response.status + ' in ' + ms + ' ms' + (size ? ', ' + size + ' bytes' : ''));
      } else {
        let errorBody = '';
        try {
          errorBody = (await response.clone().text()).slice(0, MAX_BODY_CHARS);
        } catch {
          errorBody = '(body unreadable)';
        }
        logWarn('api', '#' + id + ' HTTP ' + response.status + (response.statusText ? ' ' + response.statusText : '') + ' in ' + ms + ' ms (' + method + ' ' + describeUrl(url) + ')', {
          body: describeBody(errorBody) ?? errorBody,
        });
      }
      return response;
    } catch (error) {
      const ms = Math.round(performance.now() - started);
      const name = error instanceof Error ? error.name : 'Error';
      const message = error instanceof Error ? error.message : String(error);
      logError('api', '#' + id + ' failed after ' + ms + ' ms: ' + name + ': ' + message + ' (' + method + ' ' + describeUrl(url) + ')', {
        online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
      });
      throw error;
    }
  };
};

let errorsInstalled = false;

/** Logs uncaught errors and unhandled promise rejections. */
export const installErrorLogger = () => {
  if (errorsInstalled || typeof window === 'undefined') return;
  errorsInstalled = true;
  window.addEventListener('error', (event) => {
    logError('app', 'Uncaught error: ' + (event.message || 'unknown'), {
      source: event.filename ? event.filename + ':' + event.lineno + ':' + event.colno : undefined,
      stack: event.error instanceof Error ? event.error.stack?.slice(0, 1500) : undefined,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    logError('app', 'Unhandled promise rejection: ' + (reason instanceof Error ? reason.name + ': ' + reason.message : String(reason)), {
      stack: reason instanceof Error ? reason.stack?.slice(0, 1500) : undefined,
    });
  });
  window.addEventListener('online', () => logInfo('app', 'Browser is back online'));
  window.addEventListener('offline', () => logWarn('app', 'Browser went offline'));
  document.addEventListener('visibilitychange', () => logDebug('app', 'Page ' + document.visibilityState));
};
