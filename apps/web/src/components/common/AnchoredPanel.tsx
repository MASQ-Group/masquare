import { ReactNode, RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface AnchoredPanelProps {
  /** The trigger element the panel opens from. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  /** Align the panel's left or right edge to the anchor's before clamping. Default left. */
  align?: 'left' | 'right';
  /** Gap in px between the anchor and the panel. Default 6. */
  gap?: number;
  /** CONTENT styling (width, grid, padding…). The shell — background, border, rounding, shadow,
   *  max-height and scrolling — is provided by the component, so don't repeat those here. */
  className?: string;
  /** Show a visible ✕ close button in a small header (recommended for larger panels/sheets). */
  showClose?: boolean;
}

/**
 * A dropdown/popover shell that is ALWAYS fully visible AND usable. It renders in a portal on
 * `document.body` with `position: fixed`, positioned from the anchor's rect and **clamped to the
 * viewport**: opens below the anchor, flips above when there's no room, never runs off an edge.
 * Portalled, so ancestor `overflow`/`sticky`/`z-index` can't clip it.
 *
 * The body is height-capped to the viewport and **scrolls internally** (`overflow-y:auto`) so a tall
 * filter panel is fully reachable on any screen. Closes on outside click / Escape, and can show a
 * visible ✕ close button (`showClose`).
 */
export function AnchoredPanel({ anchorRef, onClose, children, align = 'left', gap = 6, className = '', showClose = false }: AnchoredPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const a = anchorRef.current;
      const p = panelRef.current;
      if (!a || !p) return;
      const ar = a.getBoundingClientRect();
      const pw = p.offsetWidth;
      const ph = p.offsetHeight; // already capped by max-height, so it fits after clamping
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const m = 8; // keep this much space from every viewport edge

      // Vertical: below the anchor, flipping above (then clamping) if it would overflow.
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
      className="fixed z-[90] flex max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-lg border border-n-200 bg-n-0 shadow-xl"
      // Hidden until measured so it never flashes at the wrong spot.
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      {showClose && (
        <div className="flex shrink-0 items-center justify-end border-b border-n-100 px-1.5 py-1">
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-md text-n-400 hover:bg-n-100 hover:text-n-700"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {/* Body scrolls when the content is taller than the viewport cap. */}
      <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${className}`}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
