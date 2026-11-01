import { ReactNode, useEffect, useState } from 'react';
import { ChevronDown, Database, ExternalLink, KeyRound } from 'lucide-react';
import { clearApiCache, countApiCacheEntries } from '../services/apiCache';
import { Modal } from './Modal';
import { Settings } from '../state/usePersistentState';
import { SolverMode } from '../types';
import { describeBruteForceEstimate } from '../utils/solverEstimate';
import { EXACT_POINT_LIMIT } from '../algorithms/exact';
// Mirrors AUTO_BRANCH_AND_CUT_LIMIT in algorithms/solve.ts (not imported to keep solvers out of the main bundle).
const AUTO_BRANCH_AND_CUT_LIMIT = 80;

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onChange: (next: Partial<Settings>) => void;
  pointCount: number;
}

interface SolverOption {
  value: SolverMode;
  title: string;
  badge?: string;
  description: string;
}

const SOLVER_OPTIONS: SolverOption[] = [
  {
    value: 'auto',
    title: 'Automatic',
    badge: 'Recommended',
    description:
      'Picks for you. Up to ' + EXACT_POINT_LIMIT + ' stops: the perfect route, instantly. Up to ' +
      AUTO_BRANCH_AND_CUT_LIMIT + ' stops: exact solver within the time limit below. Beyond that: a very good approximate route in a few seconds.',
  },
  {
    value: 'exact',
    title: 'Exact',
    description:
      'Guarantees the best possible route (or tells you how far from it it may be if time runs out). Can be slow beyond 80 stops: the time limit below applies.',
  },
  {
    value: 'heuristic',
    title: 'Fast (heuristic)',
    description:
      'Builds a good route, then improves it with small swaps. Near-instant even with hundreds of stops, usually within a few % of the best route.',
  },
  {
    value: 'genetic',
    title: 'Genetic',
    description: '“Evolves” a population of routes. Mostly useful for comparison; Automatic is almost always better.',
  },
  {
    value: 'brute-force',
    title: 'Brute force',
    description: 'Tries every possible order. Exact but blows up fast: keep it under 10 stops, for checking.',
  },
];

const KeyGuide = ({ title, children }: { title: string; children: ReactNode }) => (
  <details className="guide">
    <summary>
      {title}
      <ChevronDown size={16} className="callout__chevron" />
    </summary>
    {children}
  </details>
);

const CacheSection = ({ open }: { open: boolean }) => {
  const [count, setCount] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    countApiCacheEntries().then((value) => {
      if (!cancelled) setCount(value);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const clear = async () => {
    await clearApiCache();
    setCount(await countApiCacheEntries());
  };

  return (
    <section className="form-section">
      <h3>
        <Database size={14} /> Saved responses
      </h3>
      <p className="hint">
        Distances, routes and searches already fetched are reused instead of being requested (and billed) again. Adding a stop
        only fetches what is new. Road data is kept in this browser for 30 days; Google transit times are kept only until you
        close the page, as Google’s terms require.
      </p>
      <div className="cache-row">
        <span className="hint">{count === undefined ? 'Counting…' : count === 0 ? 'Nothing saved yet.' : count.toLocaleString('en') + ' saved entries.'}</span>
        <button type="button" className="button" onClick={clear} disabled={!count}>
          Clear
        </button>
      </div>
    </section>
  );
};

export const SettingsDialog = ({ open, onClose, settings, onChange, pointCount }: SettingsDialogProps) => (
  <Modal
    title="Settings"
    open={open}
    onClose={onClose}
    footer={
      <button type="button" className="button button--primary button--block" onClick={onClose}>
        Done
      </button>
    }
  >
    <section className="form-section">
      <h3>Optimise for</h3>
      <div className="segmented" role="radiogroup" aria-label="Objective">
        <button type="button" role="radio" aria-checked={settings.objective === 'distance'} className={settings.objective === 'distance' ? 'is-active' : ''} onClick={() => onChange({ objective: 'distance' })}>
          Distance
        </button>
        <button type="button" role="radio" aria-checked={settings.objective === 'duration'} className={settings.objective === 'duration' ? 'is-active' : ''} onClick={() => onChange({ objective: 'duration' })}>
          Travel time
        </button>
      </div>
      <p className={'hint' + (settings.objective === 'duration' && !settings.orsApiKey && !settings.googleApiKey ? ' hint--warning' : '')}>
        {settings.objective === 'distance'
          ? 'The shortest route in kilometres.'
          : 'The fastest route: may detour via a faster road. Needs an API key below.'}
      </p>
    </section>

    <section className="form-section">
      <h3>
        <KeyRound size={14} /> API keys
      </h3>
      <p className="hint">
        Without a key the app still works, but measures straight-line distances. With a key it uses real roads and travel times,
        and draws the actual route. Keys are stored only in this browser.
      </p>

      <label className="field">
        <span className="field__label">OpenRouteService</span>
        <span className="hint">Car, truck, bike, e-bike, walking, hiking. Free.</span>
        <input type="password" value={settings.orsApiKey} placeholder="Paste your key here" autoComplete="off" spellCheck={false} onChange={(event) => onChange({ orsApiKey: event.target.value.trim() })} />
      </label>
      <KeyGuide title="How do I get an OpenRouteService key?">
        <ol>
          <li>
            Create a free account at{' '}
            <a href="https://account.heigit.org/signup" target="_blank" rel="noreferrer">
              account.heigit.org <ExternalLink size={12} />
            </a>{' '}
            (HeiGIT runs OpenRouteService).
          </li>
          <li>Confirm your email address, then sign in.</li>
          <li>In the dashboard, create a key on the free “Standard” plan.</li>
          <li>Copy the key (a long string of characters) and paste it into the field above.</li>
        </ol>
        <p>The free plan is plenty for personal use (several hundred calculations per day).</p>
      </KeyGuide>

      <label className="field">
        <span className="field__label">Google Maps</span>
        <span className="hint">Only needed for public transit. Requires a credit card, with a free monthly credit.</span>
        <input type="password" value={settings.googleApiKey} placeholder="Paste your key here" autoComplete="off" spellCheck={false} onChange={(event) => onChange({ googleApiKey: event.target.value.trim() })} />
      </label>
      <KeyGuide title="How do I get a Google Maps key?">
        <ol>
          <li>
            Open the{' '}
            <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">
              Google Cloud console <ExternalLink size={12} />
            </a>{' '}
            and create a project.
          </li>
          <li>Enable billing on the project (the free monthly credit covers personal use).</li>
          <li>
            Under “APIs &amp; Services”, enable the <strong>Routes API</strong>.
          </li>
          <li>Under “Credentials”, create an API key and paste it here.</li>
          <li>Recommended: restrict the key to the Routes API and to this site’s address.</li>
        </ol>
        <p>
          <a href="https://developers.google.com/maps/documentation/routes/get-api-key" target="_blank" rel="noreferrer">
            Official documentation <ExternalLink size={12} />
          </a>
        </p>
      </KeyGuide>
    </section>

    <section className="form-section">
      <h3>Algorithm</h3>
      <div className="choices" role="radiogroup" aria-label="Algorithm">
        {SOLVER_OPTIONS.map((option) => {
          const active = settings.solverMode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              className={'choice' + (active ? ' is-active' : '')}
              onClick={() => onChange({ solverMode: option.value })}
            >
              <span className="choice__radio" aria-hidden />
              <span className="choice__text">
                <span className="choice__title">
                  {option.title}
                  {option.badge && <span className="tag tag--primary">{option.badge}</span>}
                </span>
                <span className="choice__description">
                  {option.description}
                  {option.value === 'brute-force' && pointCount >= 2 && ' For your ' + pointCount + ' stops: about ' + describeBruteForceEstimate(pointCount) + '.'}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {(settings.solverMode === 'auto' || settings.solverMode === 'exact') && (
        <label className="field">
          <span className="field__label">Exact solver time limit: {settings.exactTimeLimitSeconds} s</span>
          <input
            type="range"
            min={5}
            max={120}
            step={5}
            value={Math.min(120, settings.exactTimeLimitSeconds)}
            onChange={(event) => onChange({ exactTimeLimitSeconds: Number(event.target.value) })}
          />
          <span className="hint">
            For large trips. After this limit you get the best route found so far and how far it can be from the perfect one
            (e.g. “Within 0.8% of optimal”).
          </span>
        </label>
      )}
    </section>

    <CacheSection open={open} />
  </Modal>
);
