import { PointerEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { useViewportHeight } from '../hooks/useMediaQuery';

export type SheetSnap = 'peek' | 'half' | 'full';

export interface SheetProps {
  /** Desktop: render as a fixed side panel instead of a draggable bottom sheet. */
  docked: boolean;
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  /** Reports the height covered on screen (mobile) so the map can keep content visible. */
  onCoverChange: (height: number) => void;
  header: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}

const PEEK_HEIGHT = 232;
const TOP_GAP = 76;
const DRAG_THRESHOLD = 6;

const snapHeights = (viewport: number): Record<SheetSnap, number> => ({
  peek: Math.min(PEEK_HEIGHT, viewport * 0.5),
  half: Math.round(viewport * 0.62),
  full: viewport - TOP_GAP,
});

export const Sheet = ({ docked, snap, onSnapChange, onCoverChange, header, footer, children }: SheetProps) => {
  const viewport = useViewportHeight();
  const heights = snapHeights(viewport);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{ startY: number; startHeight: number; active: boolean; pointerId: number } | null>(null);

  const height = dragHeight ?? heights[snap];

  useEffect(() => {
    onCoverChange(docked ? 0 : dragHeight === null ? heights[snap] : dragHeight);
  }, [docked, snap, dragHeight, heights.peek, heights.half, heights.full, onCoverChange]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (docked) return;
    drag.current = { startY: event.clientY, startHeight: height, active: false, pointerId: event.pointerId };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    const delta = state.startY - event.clientY;
    if (!state.active) {
      if (Math.abs(delta) < DRAG_THRESHOLD) return;
      state.active = true;
      event.currentTarget.setPointerCapture(state.pointerId);
    }
    setDragHeight(Math.max(heights.peek * 0.6, Math.min(heights.full, state.startHeight + delta)));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    drag.current = null;
    if (!state || !state.active) return;
    const finalHeight = Math.max(heights.peek, Math.min(heights.full, state.startHeight + (state.startY - event.clientY)));
    const moved = finalHeight - state.startHeight;
    // Favour the drag direction: a short flick is enough to move one snap point.
    const order: SheetSnap[] = ['peek', 'half', 'full'];
    let next: SheetSnap = order.reduce((best, candidate) =>
      Math.abs(heights[candidate] - finalHeight) < Math.abs(heights[best] - finalHeight) ? candidate : best
    );
    if (next === snap && Math.abs(moved) > 40) {
      const index = order.indexOf(snap) + (moved > 0 ? 1 : -1);
      next = order[Math.max(0, Math.min(order.length - 1, index))];
    }
    setDragHeight(null);
    onSnapChange(next);
  };

  const cycle = () => {
    if (docked) return;
    onSnapChange(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'peek');
  };

  if (docked) {
    return (
      <aside className="sheet sheet--docked">
        <div className="sheet__header">{header}</div>
        <div className="sheet__body">{children}</div>
        <div className="sheet__footer">{footer}</div>
      </aside>
    );
  }

  return (
    <section
      className={'sheet sheet--mobile' + (dragHeight !== null ? ' sheet--dragging' : '')}
      style={{ height }}
      aria-label="Panneau de l’itinéraire"
    >
      <div
        className="sheet__header sheet__header--draggable"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <button type="button" className="sheet__handle" onClick={cycle} aria-label="Agrandir ou réduire le panneau">
          <span />
        </button>
        {header}
      </div>
      <div className="sheet__body">{children}</div>
      <div className="sheet__footer">{footer}</div>
    </section>
  );
};
