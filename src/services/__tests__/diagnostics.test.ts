import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLog, formatLog, getLogEntries, installFetchLogger, logInfo, redact, registerSecrets, setDiagnosticContext } from '../diagnostics';

describe('diagnostic log', () => {
  const realFetch = window.fetch;

  beforeEach(() => clearLog());
  afterEach(() => {
    window.fetch = realFetch;
  });

  it('masks registered keys and key-like query parameters', () => {
    registerSecrets('my-secret-ors-key-123');
    expect(redact('Authorization my-secret-ors-key-123 failed')).toBe('Authorization *** failed');
    expect(redact('https://x.org/a?api_key=abcdef&text=Paris')).toBe('https://x.org/a?api_key=***&text=Paris');
  });

  it('never writes a registered key into the copied log', () => {
    registerSecrets('google-key-abcdefgh');
    logInfo('test', 'something with google-key-abcdefgh', { key: 'google-key-abcdefgh' });
    setDiagnosticContext({ Settings: 'travel mode foot-walking' });
    const text = formatLog();
    expect(text).not.toContain('google-key-abcdefgh');
    expect(text).toContain('travel mode foot-walking');
    expect(text).toContain('[test] something with ***');
  });

  it('logs API requests with status, duration and error body, without credentials', async () => {
    const stub = vi.fn(async () => new Response('{"error":{"code":2010,"message":"Could not find routable point within a radius of 350.0 meters of specified coordinate 1"}}', { status: 404 }));
    window.fetch = stub as unknown as typeof fetch;
    // Re-install over the stub (the logger installs once per module, so call the wrapper directly).
    vi.resetModules();
    const fresh = await import('../diagnostics');
    fresh.clearLog();
    fresh.installFetchLogger();
    fresh.registerSecrets('ors-key-0123456789');
    await window.fetch('https://api.heigit.org/openrouteservice/v2/directions/foot-walking?api_key=leaked', {
      method: 'POST',
      headers: { Authorization: 'ors-key-0123456789' },
      body: JSON.stringify({ coordinates: [[5.4312345678, 43.21], [5.5, 43.2]], radiuses: [350, 2000] }),
    });
    const text = fresh.formatLog();
    expect(text).toContain('POST api.heigit.org/openrouteservice/v2/directions/foot-walking?api_key=***');
    expect(text).toContain('"coordinates":[[5.43123,43.21],[5.5,43.2]]');
    expect(text).toContain('HTTP 404');
    expect(text).toContain('specified coordinate 1');
    expect(text).not.toContain('leaked');
    expect(text).not.toContain('ors-key-0123456789');
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('keeps a bounded ring buffer', () => {
    for (let i = 0; i < 1100; i += 1) logInfo('test', 'entry ' + i);
    const entries = getLogEntries();
    expect(entries.length).toBe(1000);
    expect(entries[entries.length - 1].message).toBe('entry 1099');
  });
});

// Keep the unused import used (installFetchLogger is exercised through a fresh module above).
void installFetchLogger;
