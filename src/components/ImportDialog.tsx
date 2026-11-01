import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { parseCoordinateLines } from '../utils/coordinateParser';
import { CoordinatePoint } from '../types';

export interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  hasStops: boolean;
  onImport: (points: CoordinatePoint[], mode: 'append' | 'replace') => void;
  exportText: string;
}

export const ImportDialog = ({ open, onClose, hasStops, onImport, exportText }: ImportDialogProps) => {
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseCoordinateLines(text), [text]);
  const valid = parsed.points.length > 0 && parsed.errors.length === 0;

  const run = (mode: 'append' | 'replace') => {
    onImport(parsed.points, mode);
    setText('');
    onClose();
  };

  return (
    <Modal
      title="Importer des étapes"
      open={open}
      onClose={onClose}
      footer={
        <>
          {hasStops && (
            <button type="button" className="button" disabled={!valid} onClick={() => run('replace')}>
              Remplacer
            </button>
          )}
          <button type="button" className="button button--primary" disabled={!valid} onClick={() => run('append')}>
            Ajouter {parsed.points.length > 0 ? parsed.points.length + ' étape' + (parsed.points.length > 1 ? 's' : '') : ''}
          </button>
        </>
      }
    >
      <p className="hint">
        Une étape par ligne : <code>lat, lon, nom</code> ou <code>nom, lat, lon</code>. Les lignes commençant par # sont ignorées.
      </p>
      <textarea
        className="import__textarea"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={'48.85837, 2.29448, Tour Eiffel\n48.86061, 2.33764, Louvre'}
        rows={8}
        spellCheck={false}
      />
      {parsed.errors.length > 0 && (
        <ul className="hint hint--error">
          {parsed.errors.map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      )}
      {hasStops && (
        <details className="callout">
          <summary>Copier les étapes actuelles</summary>
          <textarea className="import__textarea" readOnly value={exportText} rows={5} onFocus={(event) => event.currentTarget.select()} />
        </details>
      )}
    </Modal>
  );
};
