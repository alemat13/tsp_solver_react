import { ReactNode } from 'react';
import { Eye, EyeOff, Flag, Home, Pencil, Trash2 } from 'lucide-react';
import { CoordinatePoint } from '../types';

/** Per-stop actions, shared by the ⋮ menu in the stop list and the stop popup on the map. */
export interface StopActions {
  onSetStart: (id: string | undefined) => void;
  onSetEnd: (id: string | undefined) => void;
  onRename: (id: string, label: string) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}

export const StopMenuItems = ({
  point,
  isStart,
  isEnd,
  actions,
  onDone,
  onRename,
  extra,
}: {
  point: CoordinatePoint;
  isStart: boolean;
  isEnd: boolean;
  actions: StopActions;
  /** Called after any action, to close the menu. */
  onDone: () => void;
  /** Start renaming (each place edits the name its own way). */
  onRename: () => void;
  /** Extra items placed before "Rename". */
  extra?: ReactNode;
}) => {
  const enabled = !point.disabled;
  const run = (action: () => void) => () => {
    action();
    onDone();
  };
  return (
    <>
      <button type="button" role="menuitem" onClick={run(() => actions.onToggle(point.id, !enabled))}>
        {enabled ? <EyeOff size={16} /> : <Eye size={16} />} {enabled ? 'Skip this stop' : 'Include this stop'}
      </button>
      <button type="button" role="menuitem" onClick={run(() => actions.onSetStart(isStart ? undefined : point.id))}>
        <Home size={16} /> {isStart ? 'Don’t start here' : 'Start here'}
      </button>
      <button type="button" role="menuitem" onClick={run(() => actions.onSetEnd(isEnd ? undefined : point.id))}>
        <Flag size={16} /> {isEnd ? 'Don’t end here' : 'End here'}
      </button>
      {extra}
      <button type="button" role="menuitem" onClick={onRename}>
        <Pencil size={16} /> Rename
      </button>
      <button type="button" role="menuitem" className="menu__danger" onClick={run(() => actions.onRemove(point.id))}>
        <Trash2 size={16} /> Remove
      </button>
    </>
  );
};
