import { ReactNode, RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface AnchoredPanelProps {
  /** The trigger element the panel opens from. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  /** Align the panel's left or right edge to the anchor's before clamping. Default left. */
  align?: 'left' | 'right';
  /** Gap in px between the anchor and the panel. Default 6. */
  gap?: number;
  /** Panel styling (width, grid, padding, background…). Positioning is handled here. */
  className?: string;
}

/**
 * A dropdown/popover shell that is ALWAYS fully visible. It renders in a portal on `document.body`
 * with `position: fixed`, positioned from the anchor's rect and **clamped to the viewport**: it
 * opens below the anchor, flips above when there isn't room, and never runs off the left/right edge.
 * Because it's portalled, ancestor `overflow`/`sticky`/`z-index` can't clip or hide it.
 *
 * Use this for any menu that could otherwise open behind the sticky page bar, be clipped by an
 * `overflow-x-auto` toolbar, or fall off a narrow (mobile) screen. Closes on outside click / Escape.
 */
export function AnchoredPanel({ anchorRef, onClose, children, align = 'left', gap = 6, className = '' }: AnchoredPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const a = anchorRef.current;
      const p = panelRef.current;
      if (!a || !p) return;
      const ar = a.getBoundingClientRect();
      const pw = p.offsetWidth;
      const ph = p.offsetHeight;
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const m = 8; // keep this much space from every viewport edge

      // Vertical: below the anchor, flipping above if it would overflow the bottom.
      let top = ar.bottom + gap;
      if (top + ph > vh - m) {
        const above = ar.top - gap - ph;
        top = above >= m ? above : Math.max(m, vh - m - ph);
      }
      // Horizontal: align to the chosen edge, then clamp into the viewport.
      let left = align === 'right' ? ar.right - pw : ar.left;
      left = Math.min(Math.max(m, left), Math.max(m, vw - m - pw));

      setPos({ top, left });
    };
    place();
    // Reposition (rather than close) as the page scrolls or the viewport changes.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchorRef, align, gap]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, anchorRef]);

  return createPortal(
    <div
      ref={panelRef}
      className={`fixed z-[90] ${className}`}
      // Hidden until measured so it never flashes at the wrong spot.
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  );
}
