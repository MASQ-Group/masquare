import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { cn } from './cn';

export interface ModalTab {
  key: string;
  label: string;
}

/** Above this many tabs a top strip wraps, so the rail takes over. Six fits 720px comfortably. */
const SIDE_RAIL_FROM = 6;

export interface ModalShellProps {
  open: boolean;
  title: string;
  subtitle?: string;
  tabs?: ModalTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  /** When true, Cancel/close raises the unsaved-changes guard. */
  dirty?: boolean;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  /** Optional secondary action rendered between Cancel and the primary CTA. */
  secondaryLabel?: string;
  onSecondary?: () => void;
  secondaryDisabled?: boolean;
  busy?: boolean;
  /**
   * Where the tabs sit. 'auto' puts them in a side rail once there are more than SIDE_RAIL_FROM of
   * them, because a top strip silently wraps to a second row and half the tabs disappear below the
   * fold — which is exactly how a nine-tab card ended up needing to be maximised to be used.
   */
  tabLayout?: 'auto' | 'top' | 'side';
  /** Starting size before the user resizes. Defaults to 720×560, or wider when a rail is shown. */
  initialSize?: { w: number; h: number };
  onClose: () => void;
  children: ReactNode;
}

/** Reusable modal shell (Module 1 §6.3): centered; header expand + close; bottom-right
 *  drag-resize; tabbed body; footer primary CTA + Cancel; unsaved-changes guard. */
export function ModalShell({
  open,
  title,
  subtitle,
  tabs,
  activeTab,
  onTabChange,
  dirty,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  secondaryLabel,
  onSecondary,
  secondaryDisabled,
  busy,
  tabLayout = 'auto',
  initialSize,
  onClose,
  children,
}: ModalShellProps) {
  const useRail = tabLayout === 'side' || (tabLayout === 'auto' && (tabs?.length ?? 0) > SIDE_RAIL_FROM);
  const [expanded, setExpanded] = useState(false);
  // A rail costs horizontal space, so a modal that has one starts wider rather than making the
  // first thing every user does be to drag it.
  const [size, setSize] = useState<{ w: number; h: number }>(
    initialSize ?? (useRail ? { w: 940, h: 640 } : { w: 720, h: 560 }),
  );
  const dragState = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  const attemptClose = useCallback(() => {
    if (dirty && !window.confirm('You have unsaved changes. Discard them?')) return;
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') attemptClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, attemptClose]);

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragState.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    const onMove = (ev: MouseEvent) => {
      if (!dragState.current) return;
      const w = Math.max(420, dragState.current.w + (ev.clientX - dragState.current.x));
      const h = Math.max(320, dragState.current.h + (ev.clientY - dragState.current.y));
      setSize({ w, h });
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (!open) return null;

  const active = activeTab ?? tabs?.[0]?.key;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(12,16,20,0.5)] p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) attemptClose();
      }}
    >
      <div
        className={cn(
          'flex flex-col overflow-hidden rounded-lg bg-n-0 shadow-lg',
          expanded && 'fixed inset-4',
        )}
        style={expanded ? undefined : { width: size.w, height: size.h }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-n-200 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold text-n-900">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-[13px] text-n-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Restore' : 'Expand'}
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800"
            onClick={attemptClose}
            title="Close"
          >
            <X size={17} />
          </button>
        </div>

        {/* Tabs across the top — only while they fit on one line. */}
        {tabs && tabs.length > 0 && !useRail && (
          <div role="tablist" className="flex gap-1 border-b border-n-200 px-4">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active === t.key}
                onClick={() => onTabChange?.(t.key)}
                className={cn(
                  'relative px-3 py-2.5 text-[13px] font-medium transition-colors',
                  active === t.key
                    ? 'text-teal-700 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-teal-500'
                    : 'text-n-500 hover:text-n-800',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Body. With a rail the two scroll independently, so a long form never scrolls the nav
            out of reach — the point of the rail is that every section stays one click away. */}
        <div className="flex min-h-0 flex-1">
          {tabs && tabs.length > 0 && useRail && (
            <div
              role="tablist"
              aria-orientation="vertical"
              className="w-[186px] shrink-0 overflow-y-auto border-r border-n-200 bg-n-25 p-2 max-[720px]:w-[54px]"
            >
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active === t.key}
                  title={t.label}
                  onClick={() => onTabChange?.(t.key)}
                  className={cn(
                    'mb-0.5 w-full truncate rounded-md px-2.5 py-2 text-left text-[13px] font-medium transition-colors',
                    'max-[720px]:px-1 max-[720px]:text-center max-[720px]:text-[11px]',
                    active === t.key
                      ? 'bg-teal-500 text-white'
                      : 'text-n-600 hover:bg-n-100 hover:text-n-900',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <div className="min-w-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-n-200 px-5 py-3.5">
          <button
            type="button"
            onClick={attemptClose}
            className="inline-flex h-10 items-center rounded-md border border-n-200 bg-n-0 px-4 text-[13.5px] font-semibold text-n-700 hover:bg-n-50"
          >
            Cancel
          </button>
          {secondaryLabel && onSecondary && (
            <button
              type="button"
              onClick={onSecondary}
              disabled={secondaryDisabled || busy}
              className="inline-flex h-10 items-center rounded-md border border-n-200 bg-n-0 px-4 text-[13.5px] font-semibold text-n-700 hover:bg-n-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {secondaryLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onPrimary}
            disabled={primaryDisabled || busy}
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[13.5px] font-semibold text-white shadow-xs hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Working…' : primaryLabel}
          </button>
        </div>

        {/* Resize handle — drag to enlarge (bottom-right corner) */}
        {!expanded && (
          <div
            onMouseDown={onResizeStart}
            className="group/resize absolute bottom-0 right-0 flex h-6 w-6 cursor-nwse-resize items-end justify-end p-1"
            title="Drag to resize"
          >
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 text-n-400 group-hover/resize:text-teal-500">
              <path d="M9 1 L1 9 M9 5 L5 9" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
