import { ReactNode, useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

// Unified top bar for every page (Top Bar Redesign). Single row:
//   breadcrumb "MODULE › Title" + ⓘ description tooltip · optional inline tabs · the page's
//   toolbar (search / filters / view controls, which grows to fill) · right-aligned actions
//   (secondaries + ⋯ overflow + one primary). It stays on one line while it fits and only
//   wraps the toolbar to a second line when the viewport is too narrow.
// Sticky at the top of the scroll area; the whole bar slides out of view on scroll-down and
// slides back on scroll-up (per the design guide). Purely presentational — pages pass their
// existing actions/controls as slots (no behaviour changes).

export interface PageHeaderTab {
  key: string;
  label: string;
  count?: number;
  /** Red (attention) badge instead of the neutral grey one. */
  attention?: boolean;
}

export interface PageHeaderOverflowItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface PageHeaderProps {
  /** Breadcrumb module label (the sidebar group), e.g. "Products". */
  module: string;
  title: string;
  /** Page description — shown in the ⓘ tooltip instead of a full paragraph. */
  info?: ReactNode;
  tabs?: PageHeaderTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  /** Secondary header-row buttons (use `.hbtn`). Keep to ~2; overflow the rest. */
  actions?: ReactNode;
  /** ⋯ overflow menu items. */
  overflow?: PageHeaderOverflowItem[];
  /** The single primary action (use `.hbtn-primary`), rendered right-most. */
  primary?: ReactNode;
  /** Toolbar-row content (search / filters / view toggles). Row omitted when absent. */
  toolbar?: ReactNode;
}

function InfoTooltip({ info }: { info: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span className="inline-flex h-4 w-4 translate-y-[2px] cursor-default items-center justify-center rounded-full border border-n-300 text-[10px] font-semibold text-n-400">i</span>
      {open && (
        <span className="absolute left-0 top-6 z-50 block w-[280px] whitespace-normal break-words rounded-lg bg-n-900 px-3 py-2.5 text-[12px] font-normal normal-case leading-relaxed tracking-normal text-n-200 shadow-xl">
          {info}
        </span>
      )}
    </span>
  );
}

function OverflowMenu({ items }: { items: PageHeaderOverflowItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button className="hbtn-icon" title="More actions" onClick={() => setOpen((o) => !o)}><MoreHorizontal size={16} /></button>
      {open && (
        <div className="absolute right-0 top-9 z-50 min-w-[200px] rounded-lg border border-n-200 bg-n-0 p-1 shadow-lg">
          {items.map((it, i) => (
            <button
              key={i}
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick(); }}
              className={`block w-full rounded-md px-3 py-1.5 text-left text-[13px] hover:bg-n-50 disabled:opacity-40 ${it.danger ? 'text-danger' : 'text-n-700'}`}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PageHeader({ module, title, info, tabs, activeTab, onTabChange, actions, overflow, primary, toolbar }: PageHeaderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  // `hidden` slides the whole bar out of view on scroll-down; `stuck` adds a shadow once scrolled.
  const [hidden, setHidden] = useState(false);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    // Find the scroll container (AppShell's <main>, which has px-8 py-7 padding).
    let scroller: HTMLElement | Window = window;
    let el = rootRef.current?.parentElement;
    while (el) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') { scroller = el; break; }
      el = el.parentElement;
    }
    const read = () => (scroller === window ? window.scrollY : (scroller as HTMLElement).scrollTop);
    let last = read();
    let ticking = false;
    const update = () => {
      ticking = false;
      const y = read();
      setStuck(y > 4);
      const delta = y - last;
      // Always reveal at the very top; otherwise follow scroll direction (dead-zone kills jitter).
      if (y < 8) setHidden(false);
      else if (delta > 6) setHidden(true);   // scrolling down → hide
      else if (delta < -6) setHidden(false); // scrolling up → reveal
      last = y;
    };
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    update();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      ref={rootRef}
      className={`sticky -top-7 z-30 -mx-8 -mt-7 mb-5 border-b border-n-200 bg-n-0 transition-transform duration-200 will-change-transform max-[760px]:-top-5 max-[760px]:-mx-4 max-[760px]:-mt-5 ${hidden ? '-translate-y-full' : 'translate-y-0'} ${stuck ? 'shadow-[0_6px_16px_-12px_rgba(15,23,42,0.35)]' : ''}`}
    >
      {/* Single row: breadcrumb › tabs › toolbar (grows) › actions. flex-wrap keeps everything
          on one line while it fits, and only drops the toolbar to a second line when the
          viewport is genuinely too narrow. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-8 py-3.5 max-[760px]:px-4">
        <div className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
          <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-n-400">{module}</span>
          <span className="text-[12px] text-n-300">›</span>
          <span className="text-[16px] font-bold text-n-900">{title}</span>
          {info && <InfoTooltip info={info} />}
        </div>

        {tabs && tabs.length > 0 && (
          <div className="flex shrink-0 items-center gap-4">
            {tabs.map((t) => {
              const on = t.key === activeTab;
              return (
                <button
                  key={t.key}
                  onClick={() => onTabChange?.(t.key)}
                  className={`flex items-center gap-1.5 border-b-2 pb-1 text-[13px] transition-colors ${on ? 'border-teal-500 font-semibold text-n-900' : 'border-transparent font-medium text-n-500 hover:text-n-900'}`}
                >
                  {t.label}
                  {t.count != null && (
                    <span className={`rounded-pill px-1.5 py-px text-[11px] font-semibold ${t.attention ? 'bg-red-100 text-red-700' : 'bg-n-100 text-n-600'}`}>{t.count}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Toolbar controls fill the middle (keeping each page's own internal layout). */}
        {toolbar ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{toolbar}</div>
        ) : (
          <div className="flex-1" />
        )}

        {(actions || (overflow && overflow.length > 0) || primary) && (
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            {overflow && overflow.length > 0 && <OverflowMenu items={overflow} />}
            {primary}
          </div>
        )}
      </div>
    </div>
  );
}
