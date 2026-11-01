import { CSSProperties, useEffect, useRef, useState } from 'react';
import { Flag, Home, LocateFixed, MoreVertical, Pencil, Repeat, Trash2, MoveRight } from 'lucide-react';
import { CoordinatePoint } from '../types';
import { formatCoords } from '../ui/format';

export interface StopListProps {
  points: CoordinatePoint[];
  startId?: string;
  endId?: string;
  onSetStart: (id: string | undefined) => void;
  onSetEnd: (id: string | undefined) => void;
  onRename: (id: string, label: string) => void;
  onRemove: (id: string) => void;
  onFocus: (id: string) => void;
}

export const TripTypeSwitch = ({
  isLoop,
  onChange,
  disabled,
}: {
  isLoop: boolean;
  onChange: (loop: boolean) => void;
  disabled?: boolean;
}) => (
  <div className="segmented" role="radiogroup" aria-label="Trip type">
    <button type="button" role="radio" aria-checked={isLoop} className={isLoop ? 'is-active' : ''} onClick={() => onChange(true)} disabled={disabled}>
      <Repeat size={16} aria-hidden /> Round trip
    </button>
    <button type="button" role="radio" aria-checked={!isLoop} className={!isLoop ? 'is-active' : ''} onClick={() => onChange(false)} disabled={disabled}>
      <MoveRight size={16} aria-hidden /> One way
    </button>
  </div>
);

const StopRow = ({
  point,
  index,
  isStart,
  isEnd,
  isLoop,
  ...actions
}: Omit<StopListProps, 'points' | 'startId' | 'endId'> & {
  point: CoordinatePoint;
  index: number;
  isStart: boolean;
  isEnd: boolean;
  isLoop: boolean;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(point.label);
  const rowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: Event) => {
      if (rowRef.current && !rowRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnScroll = () => setMenuOpen(false);
    document.addEventListener('pointerdown', close);
    window.addEventListener('resize', closeOnScroll);
    const scroller = rowRef.current?.closest('.sheet__body');
    scroller?.addEventListener('scroll', closeOnScroll);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', closeOnScroll);
      scroller?.removeEventListener('scroll', closeOnScroll);
    };
  }, [menuOpen]);

  const commit = () => {
    const label = draft.trim();
    if (label && label !== point.label) actions.onRename(point.id, label);
    setEditing(false);
  };

  const kind = isStart ? 'start' : isEnd ? 'end' : 'stop';

  return (
    <li className={'stop stop--' + kind} ref={rowRef}>
      <button type="button" className={'stop__badge stop__badge--' + kind} onClick={() => actions.onFocus(point.id)} aria-label={'Show ' + point.label + ' on the map'}>
        {isStart ? <Home size={15} /> : isEnd ? <Flag size={15} /> : index + 1}
      </button>
      <div className="stop__main" onClick={() => !editing && actions.onFocus(point.id)}>
        {editing ? (
          <input
            className="stop__edit"
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit();
              if (event.key === 'Escape') setEditing(false);
            }}
            aria-label="Stop name"
          />
        ) : (
          <span className="stop__label">{point.label}</span>
        )}
        <span className="stop__meta">
          {isStart && <span className="tag tag--start">{isLoop ? 'Start & end' : 'Start'}</span>}
          {isEnd && <span className="tag tag--end">End</span>}
          <span className="stop__coords">{formatCoords(point.latitude, point.longitude)}</span>
        </span>
      </div>
      <div className="stop__actions">
        <button type="button" className="icon-button icon-button--ghost" onClick={(event) => {
            // Fixed positioning so the menu is never clipped by the scrolling panel; opens upwards near the bottom.
            const rect = event.currentTarget.getBoundingClientRect();
            const right = window.innerWidth - rect.right;
            setMenuStyle(
              window.innerHeight - rect.bottom < 280 ? { right, bottom: window.innerHeight - rect.top + 4 } : { right, top: rect.bottom + 4 }
            );
            setMenuOpen((open) => !open);
          }} aria-label={'Options for ' + point.label} aria-expanded={menuOpen}>
          <MoreVertical size={18} />
        </button>
        {menuOpen && (
          <div className="menu" role="menu" style={menuStyle}>
            <button type="button" role="menuitem" onClick={() => { actions.onSetStart(isStart ? undefined : point.id); setMenuOpen(false); }}>
              <Home size={16} /> {isStart ? 'Don’t start here' : 'Start here'}
            </button>
            <button type="button" role="menuitem" onClick={() => { actions.onSetEnd(isEnd ? undefined : point.id); setMenuOpen(false); }}>
              <Flag size={16} /> {isEnd ? 'Don’t end here' : 'End here'}
            </button>
            <button type="button" role="menuitem" onClick={() => { actions.onFocus(point.id); setMenuOpen(false); }}>
              <LocateFixed size={16} /> Show on map
            </button>
            <button type="button" role="menuitem" onClick={() => { setDraft(point.label); setEditing(true); setMenuOpen(false); }}>
              <Pencil size={16} /> Rename
            </button>
            <button type="button" role="menuitem" className="menu__danger" onClick={() => { actions.onRemove(point.id); setMenuOpen(false); }}>
              <Trash2 size={16} /> Remove
            </button>
          </div>
        )}
      </div>
    </li>
  );
};

export const StopList = ({ points, startId, endId, ...actions }: StopListProps) => {
  // Start and end first, then the other stops in the order they were added.
  const ordered = [
    ...points.filter((point) => point.id === startId),
    ...points.filter((point) => point.id !== startId && point.id !== endId),
    ...points.filter((point) => point.id === endId && point.id !== startId),
  ];
  const isLoop = !endId;
  return (
    <ol className="stops">
      {ordered.map((point) => (
        <StopRow
          key={point.id}
          point={point}
          index={points.indexOf(point)}
          isStart={point.id === startId}
          isEnd={point.id === endId}
          isLoop={isLoop}
          {...actions}
        />
      ))}
    </ol>
  );
};
