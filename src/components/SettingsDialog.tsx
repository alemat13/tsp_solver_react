import { ReactNode } from 'react';
import { ChevronDown, ExternalLink, KeyRound } from 'lucide-react';
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
    title: 'Automatique',
    badge: 'Recommandé',
    description:
      'Choisit pour vous. Jusqu’à ' + EXACT_POINT_LIMIT + ' étapes : solution parfaite en un instant. Jusqu’à ' +
      AUTO_BRANCH_AND_CUT_LIMIT + ' étapes : solveur exact avec limite de temps. Au-delà : très bonne solution approchée en quelques secondes.',
  },
  {
    value: 'exact',
    title: 'Exact',
    description:
      'Garantit le meilleur trajet possible (ou indique l’écart maximal s’il manque de temps). Peut être long au-delà de 80 étapes : la limite de temps ci-dessous s’applique.',
  },
  {
    value: 'heuristic',
    title: 'Rapide (heuristique)',
    description:
      'Construit un bon trajet puis l’améliore par petites permutations. Quasi instantané même avec des centaines d’étapes, généralement à quelques % de l’optimum.',
  },
  {
    value: 'genetic',
    title: 'Génétique',
    description: 'Fait « évoluer » une population de trajets. Surtout utile pour comparer ; l’automatique est presque toujours meilleur.',
  },
  {
    value: 'brute-force',
    title: 'Force brute',
    description: 'Essaie tous les ordres possibles. Exact mais explose vite : à réserver à moins de 10 étapes, pour vérifier.',
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

export const SettingsDialog = ({ open, onClose, settings, onChange, pointCount }: SettingsDialogProps) => (
  <Modal
    title="Réglages"
    open={open}
    onClose={onClose}
    footer={
      <button type="button" className="button button--primary button--block" onClick={onClose}>
        Terminé
      </button>
    }
  >
    <section className="form-section">
      <h3>Optimiser pour</h3>
      <div className="segmented" role="radiogroup" aria-label="Objectif">
        <button type="button" role="radio" aria-checked={settings.objective === 'distance'} className={settings.objective === 'distance' ? 'is-active' : ''} onClick={() => onChange({ objective: 'distance' })}>
          La distance
        </button>
        <button type="button" role="radio" aria-checked={settings.objective === 'duration'} className={settings.objective === 'duration' ? 'is-active' : ''} onClick={() => onChange({ objective: 'duration' })}>
          Le temps de trajet
        </button>
      </div>
      <p className={'hint' + (settings.objective === 'duration' && !settings.orsApiKey && !settings.googleApiKey ? ' hint--warning' : '')}>
        {settings.objective === 'distance'
          ? 'Le trajet le plus court en kilomètres.'
          : 'Le trajet le plus rapide : peut faire un détour par une voie rapide. Nécessite une clé API ci-dessous.'}
      </p>
    </section>

    <section className="form-section">
      <h3>
        <KeyRound size={14} /> Clés API
      </h3>
      <p className="hint">
        Sans clé, l’app fonctionne mais mesure les distances à vol d’oiseau. Avec une clé, elle utilise les vraies routes, les temps de
        trajet et trace l’itinéraire exact. Les clés restent uniquement dans ce navigateur.
      </p>

      <label className="field">
        <span className="field__label">OpenRouteService</span>
        <span className="hint">Voiture, poids lourd, vélo, VAE, marche, randonnée. Gratuit.</span>
        <input type="password" value={settings.orsApiKey} placeholder="Coller la clé ici" autoComplete="off" spellCheck={false} onChange={(event) => onChange({ orsApiKey: event.target.value.trim() })} />
      </label>
      <KeyGuide title="Comment obtenir une clé OpenRouteService ?">
        <ol>
          <li>
            Créez un compte gratuit sur{' '}
            <a href="https://account.heigit.org/signup" target="_blank" rel="noreferrer">
              account.heigit.org <ExternalLink size={12} />
            </a>{' '}
            (HeiGIT gère OpenRouteService).
          </li>
          <li>Confirmez votre adresse e-mail puis connectez-vous.</li>
          <li>Dans le tableau de bord, créez une clé avec l’offre gratuite « Standard ».</li>
          <li>Copiez la clé (une longue suite de caractères) et collez-la dans le champ ci-dessus.</li>
        </ol>
        <p>L’offre gratuite suffit largement pour un usage personnel (plusieurs centaines de calculs par jour).</p>
      </KeyGuide>

      <label className="field">
        <span className="field__label">Google Maps</span>
        <span className="hint">Uniquement pour les transports en commun. Demande une carte bancaire, avec un crédit mensuel gratuit.</span>
        <input type="password" value={settings.googleApiKey} placeholder="Coller la clé ici" autoComplete="off" spellCheck={false} onChange={(event) => onChange({ googleApiKey: event.target.value.trim() })} />
      </label>
      <KeyGuide title="Comment obtenir une clé Google Maps ?">
        <ol>
          <li>
            Ouvrez la{' '}
            <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">
              console Google Cloud <ExternalLink size={12} />
            </a>{' '}
            et créez un projet.
          </li>
          <li>Activez la facturation sur ce projet (un crédit gratuit mensuel couvre un usage personnel).</li>
          <li>
            Dans « API et services », activez <strong>Routes API</strong>.
          </li>
          <li>Dans « Identifiants », créez une clé API, puis copiez-la ici.</li>
          <li>Conseillé : restreignez la clé à la Routes API et à l’adresse de ce site.</li>
        </ol>
        <p>
          <a href="https://developers.google.com/maps/documentation/routes/get-api-key" target="_blank" rel="noreferrer">
            Documentation officielle <ExternalLink size={12} />
          </a>
        </p>
      </KeyGuide>
    </section>

    <section className="form-section">
      <h3>Algorithme</h3>
      <div className="choices" role="radiogroup" aria-label="Algorithme">
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
                  {option.value === 'brute-force' && pointCount >= 2 && ' Pour vos ' + pointCount + ' étapes : environ ' + describeBruteForceEstimate(pointCount) + '.'}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {(settings.solverMode === 'auto' || settings.solverMode === 'exact') && (
        <label className="field">
          <span className="field__label">Temps max du solveur exact : {settings.exactTimeLimitSeconds} s</span>
          <input
            type="range"
            min={5}
            max={120}
            step={5}
            value={Math.min(120, settings.exactTimeLimitSeconds)}
            onChange={(event) => onChange({ exactTimeLimitSeconds: Number(event.target.value) })}
          />
          <span className="hint">
            Pour les grandes tournées. Passé ce délai, vous obtenez le meilleur trajet trouvé et l’écart maximal possible avec le trajet
            parfait (ex. « à 0,8 % max de l’optimum »).
          </span>
        </label>
      )}
    </section>
  </Modal>
);
