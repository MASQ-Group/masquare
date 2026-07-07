import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from './cn';
import { MONTHS, monthGrid, sameDay, startOfDay, weekdayLabels, type WeekStart } from './date-utils';

/** Popover rendered in a portal so it escapes modal/table overflow clipping. It anchors
 *  to the trigger and flips above when there isn't room below. */
export function PickerPopover({
  anchorRef, open, onClose, children,
}: { anchorRef: RefObject<HTMLElement>; open: boolean; onClose: () => void; children: ReactNode }) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      if (!a) return;
      const p = popRef.current?.getBoundingClientRect();
      const gap = 6;
      const ph = p?.height ?? 340;
      const pw = p?.width ?? 300;
      let top = a.bottom + gap;
      if (top + ph > window.innerHeight - 8 && a.top - gap - ph > 8) top = a.top - gap - ph; // flip up
      let left = a.left;
      if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - pw); // clamp within viewport
      setPos({ top, left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, anchorRef, children]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node) || anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={popRef}
      className="fixed z-[80] rounded-xl border border-n-200 bg-n-0 shadow-lg"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface DayFlags {
  selected?: boolean;   // single-picker selection
  rangeStart?: boolean;
  rangeEnd?: boolean;
  rangeMid?: boolean;   // strictly between start and end
  single?: boolean;     // start === end (no connecting band)
  disabled?: boolean;
}

/** One month grid. `classify` decides each day's visual state; the parent owns selection. */
export function CalendarMonth({
  month, weekStart = 1, classify, onPick, onHover, showPrev, showNext, onPrev, onNext,
}: {
  month: Date;
  weekStart?: WeekStart;
  classify: (date: Date, inMonth: boolean) => DayFlags;
  onPick: (date: Date) => void;
  onHover?: (date: Date | null) => void;
  showPrev?: boolean; showNext?: boolean;
  onPrev?: () => void; onNext?: () => void;
}) {
  const today = startOfDay(new Date());
  const weeks = monthGrid(month.getFullYear(), month.getMonth(), weekStart);
  const navBtn = 'grid h-7 w-7 place-items-center rounded-md border border-n-200 text-n-500 hover:bg-n-50 hover:text-n-800 disabled:opacity-0 disabled:pointer-events-none';

  return (
    <div className="w-[252px] select-none p-1.5">
      <div className="mb-1 flex items-center justify-between px-0.5">
        <button type="button" className={navBtn} disabled={!showPrev} onClick={onPrev} aria-label="Previous month"><ChevronLeft size={15} /></button>
        <div className="text-[13.5px] font-semibold text-n-900">{MONTHS[month.getMonth()]} {month.getFullYear()}</div>
        <button type="button" className={navBtn} disabled={!showNext} onClick={onNext} aria-label="Next month"><ChevronRight size={15} /></button>
      </div>
      <div className="grid grid-cols-7 text-center">
        {weekdayLabels(weekStart).map((d) => <div key={d} className="py-1 text-[11px] font-medium text-n-400">{d}</div>)}
      </div>
      <div className="grid grid-cols-7" onMouseLeave={() => onHover?.(null)}>
        {weeks.flat().map(({ date, inMonth }, i) => {
          const f = classify(date, inMonth);
          const isToday = sameDay(date, today);
          const filled = f.selected || f.rangeStart || f.rangeEnd;
          const bandRight = f.rangeStart && !f.single;
          const bandLeft = f.rangeEnd && !f.single;
          return (
            <div key={i} className={cn('relative flex h-9 items-center justify-center', f.rangeMid && 'bg-teal-50')}>
              {bandRight && <span className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-teal-50" />}
              {bandLeft && <span className="pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-teal-50" />}
              <button
                type="button"
                disabled={f.disabled}
                onClick={() => !f.disabled && onPick(date)}
                onMouseEnter={() => onHover?.(date)}
                className={cn(
                  'relative z-10 grid h-9 w-9 place-items-center rounded-full text-[13px] transition-colors',
                  filled ? 'bg-primary font-semibold text-white hover:bg-primary-hover'
                    : f.rangeMid ? 'text-n-800 hover:bg-teal-100'
                    : inMonth ? 'text-n-800 hover:bg-n-100' : 'text-n-300 hover:bg-n-50',
                  f.disabled && 'cursor-not-allowed text-n-200 hover:bg-transparent',
                )}
              >
                {date.getDate()}
              </button>
              {isToday && !filled && <span className="pointer-events-none absolute bottom-1 z-10 h-1 w-1 rounded-full bg-teal-400" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
