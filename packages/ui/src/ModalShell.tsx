import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { cn } from './cn';

export interface ModalTab {
  key: string;
  label: string;
}

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
  busy?: boolean;
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
  busy,
  onClose,
  children,
}: ModalShellProps) {
  const [expanded, setExpanded] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 720, h: 560 });
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

        {/* Tabs */}
        {tabs && tabs.length > 0 && (
          <div className="flex gap-1 border-b border-n-200 px-4">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
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

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-4">{children}</div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-n-200 px-5 py-3.5">
          <button
            type="button"
            onClick={attemptClose}
            className="inline-flex h-10 items-center rounded-md border border-n-200 bg-n-0 px-4 text-[13.5px] font-semibold text-n-700 hover:bg-n-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onPrimary}
            disabled={primaryDisabled || busy}
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[13.5px] font-semibold text-white shadow-xs hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Working…' : primaryLabel}
          </button>
        </div>

        {/* Resize handle */}
        {!expanded && (
          <div
            onMouseDown={onResizeStart}
            className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
            style={{
              background:
                'linear-gradient(135deg, transparent 0 50%, var(--n-300) 50% 60%, transparent 60% 70%, var(--n-300) 70% 80%, transparent 80%)',
            }}
            title="Drag to resize"
          />
        )}
      </div>
    </div>
  );
}
