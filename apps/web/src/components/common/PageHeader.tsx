import { ReactNode, useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useIsMobile } from '../../lib/useIsMobile';
import { AnchoredPanel } from './AnchoredPanel';

// Unified top bar for every page (Top Bar Redesign). Two rows:
//   • Row 1 — header: breadcrumb "MODULE › Title" + ⓘ description tooltip on the left,
//     right-aligned actions (secondaries + ⋯ overflow + one primary).
//   • Row 2 — options (only when supplied): the page's tabs (teal under-label underline +
//     count badges, attention = red) and its toolbar (search / filters / view controls).
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
  /** Second-row content (search / filters / view toggles). Row omitted when absent. */
  toolbar?: ReactNode;
  /** Mobile-only status line shown in the collapsed summary strip (≤767px) when the options row
   *  scrolls away, e.g. "1,248 transactions · All time · 2 filters". Falls back to a generic label. */
  summary?: ReactNode;
}

function InfoTooltip({ info }: { info: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span className="inline-flex h-4 w-4 cursor-default items-center justify-center rounded-full border border-n-300 text-[10px] font-semibold text-n-400">i</span>
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
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="relative">
      <button ref={btnRef} className="hbtn-icon" title="More actions" onClick={() => setOpen((o) => !o)}><MoreHorizontal size={16} /></button>
      {open && (
        <AnchoredPanel anchorRef={btnRef} onClose={() => setOpen(false)} align="right" className="min-w-[200px] p-1">
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
        </AnchoredPanel>
      )}
    </div>
  );
}

export function PageHeader({ module, title, info, tabs, activeTab, onTabChange, actions, overflow, primary, toolbar, summary }: PageHeaderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  // `hidden` = scrolled down past the threshold. Desktop slides the whole bar out of view; mobile
  // keeps the title row and collapses the options row to a summary strip instead (never vanishes).
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

  // The second "options" row exists only when the page supplies tabs and/or a toolbar.
  const hasOptions = (tabs != null && tabs.length > 0) || toolbar != null;
  // On mobile, scrolling down collapses the options row into a summary strip instead of hiding the
  // whole bar (the desktop behaviour). The title row always stays visible.
  const mobileCollapsed = isMobile && hidden && hasOptions;

  return (
    <div
      ref={rootRef}
      className={`sticky -top-7 z-30 -mx-8 -mt-7 mb-5 border-b border-n-200 bg-n-0 transition-transform duration-200 will-change-transform max-[760px]:-top-5 max-[760px]:-mx-4 max-[760px]:-mt-5 ${hidden && !isMobile ? '-translate-y-full' : 'translate-y-0'} ${stuck ? 'shadow-[0_6px_16px_-12px_rgba(15,23,42,0.35)]' : ''}`}
    >
      {/* Row 1 — page header: breadcrumb "MODULE › Title" + ⓘ on the left, actions on the right. */}
      <div className={`flex items-center gap-3 px-8 pt-3.5 max-[760px]:px-4 ${hasOptions && !mobileCollapsed ? 'pb-2.5' : 'pb-3.5'}`}>
        <div className="flex min-w-0 shrink items-baseline gap-2 whitespace-nowrap">
          <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-n-400">{module}</span>
          <span className="text-[12px] text-n-300">›</span>
          {/* Title + ⓘ in their own centered group so the icon sits on the title's vertical axis. */}
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className="truncate text-[16px] font-bold text-n-900 max-[767px]:text-[15px]">{title}</span>
            {info && <InfoTooltip info={info} />}
          </span>
        </div>

        <div className="flex-1" />

        {(actions || (overflow && overflow.length > 0) || primary) && (
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            {overflow && overflow.length > 0 && <OverflowMenu items={overflow} />}
            {primary}
          </div>
        )}
      </div>

      {/* Row 2 — options: the page's tabs and toolbar. Single line on desktop (tabs never shrink,
          search shrinks); on mobile it scrolls horizontally rather than overflowing the page, and
          collapses to height 0 (→ summary strip) when scrolled down. */}
      {hasOptions && (
        <div
          className={`flex items-center gap-4 px-8 max-[760px]:px-4 max-[767px]:overflow-x-auto max-[767px]:[scrollbar-width:none] transition-all duration-200 ${mobileCollapsed ? 'max-h-0 overflow-hidden pb-0 opacity-0 pointer-events-none' : 'max-h-28 pb-3.5 opacity-100'}`}
        >
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
          {toolbar && (
            <div className={`flex min-w-0 flex-1 items-center gap-2 ${tabs && tabs.length > 0 ? 'justify-end' : ''}`}>
              {toolbar}
            </div>
          )}
        </div>
      )}

      {/* Mobile summary strip — appears only when the options row is collapsed (never a blank gap). */}
      {isMobile && hasOptions && (
        <div
          className={`flex items-center gap-2 overflow-hidden px-4 transition-all duration-200 ${mobileCollapsed ? 'h-[34px] pb-1.5 opacity-100' : 'h-0 opacity-0 pointer-events-none'}`}
        >
          <span className="min-w-0 truncate text-[12px] text-n-500">{summary ?? 'Search & filters'}</span>
          <div className="flex-1" />
          <button
            onClick={() => setHidden(false)}
            className="inline-flex h-[26px] shrink-0 items-center gap-1 rounded-pill border border-n-200 bg-n-0 px-2.5 text-[12px] font-medium text-n-700"
          >
            Filters <span className="text-[10px]">▾</span>
          </button>
        </div>
      )}
    </div>
  );
}
