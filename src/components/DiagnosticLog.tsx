import { useState, useSyncExternalStore } from 'react';
import { Check, ChevronDown, ClipboardCopy, ScrollText } from 'lucide-react';
import { clearLog, copyToClipboard, formatLog, getLogEntries, subscribeToLog } from '../services/diagnostics';

const useLogEntries = () => useSyncExternalStore(subscribeToLog, getLogEntries, getLogEntries);

/** Copies the whole diagnostic log, then says so for a moment. */
export const CopyLogButton = ({ className = 'button', label = 'Copy log' }: { className?: string; label?: string }) => {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    const ok = await copyToClipboard(formatLog());
    setStatus(ok ? 'copied' : 'failed');
    window.setTimeout(() => setStatus('idle'), 2000);
  };
  return (
    <button type="button" className={className} onClick={copy}>
      {status === 'copied' ? <Check size={16} /> : <ClipboardCopy size={16} />}{' '}
      {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : label}
    </button>
  );
};

/** Settings section: entry count, copy, clear, and a peek at the latest entries. */
export const DiagnosticsSection = () => {
  const entries = useLogEntries();
  const [shown, setShown] = useState(false);
  return (
    <section className="form-section">
      <h3>
        <ScrollText size={14} /> Diagnostic log
      </h3>
      <p className="hint">
        A technical record of what the app did: requests to routing services and their answers, retries, fallbacks and solver
        runs. Copy it to report a problem. It stays in this browser and never includes your API keys, but it does list your stops.
      </p>
      <div className="cache-row">
        <span className="hint">{entries.length === 0 ? 'Empty.' : entries.length.toLocaleString('en') + ' entries.'}</span>
        <span className="diagnostics__actions">
          <button type="button" className="button" onClick={clearLog} disabled={!entries.length}>
            Clear
          </button>
          <CopyLogButton className="button" />
        </span>
      </div>
      <details className="guide" onToggle={(event) => setShown((event.target as HTMLDetailsElement).open)}>
        <summary>
          Show the log
          <ChevronDown size={16} className="callout__chevron" />
        </summary>
        {shown && <pre className="diagnostics__log">{formatLog()}</pre>}
      </details>
    </section>
  );
};
