import { useEffect, useRef, useState } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ChevronsUpDown, X } from 'lucide-react';
import { cn } from './cn';
import { MONTHS, pad } from './date-utils';
import { PickerPopover } from './datepicker-internal';

export interface MonthPickerProps {
  /** Month as "YYYY-MM" (or '' for none). */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Bounds as "YYYY-MM". */
  min?: string;
  max?: string;
  disabled?: boolean;
  clearable?: boolean;
  /** h-9 instead of h-10 — use in toolbars alongside dense Selects. */
  dense?: boolean;
  className?: string;
}

const parseYM = (s?: string | null): { y: number; m: number } | null => {
  if (!s || !/^\d{4}-\d{2}$/.test(s)) return null;
  const [y, m] = s.split('-').map(Number);
  return { y, m: m - 1 };
};

/** Month picker matching DatePicker: a text trigger showing "Mon YYYY" and a
 *  year-navigated month grid popover. House standard for any month-granularity field. */
export function MonthPicker({ value, onChange, placeholder = 'Select month', min, max, disabled, clearable, dense, className }: MonthPickerProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const sel = parseYM(value);
  const minYM = parseYM(min);
  const maxYM = parseYM(max);
  const [year, setYear] = useState<number>(() => sel?.y ?? new Date().getFullYear());

  useEffect(() => { if (open) setYear(sel?.y ?? new Date().getFullYear()); /* eslint-disable-next-line */ }, [open]);

  const monthDisabled = (y: number, m: number) => {
    if (minYM && (y < minYM.y || (y === minYM.y && m < minYM.m))) return true;
    if (maxYM && (y > maxYM.y || (y === maxYM.y && m > maxYM.m))) return true;
    return false;
  };
  const pick = (m: number) => { onChange(`${year}-${pad(m + 1)}`); setOpen(false); };

  const navBtn = 'grid h-7 w-7 place-items-center rounded-md border border-n-200 text-n-500 hover:bg-n-50 hover:text-n-800';

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border bg-n-0 px-3 text-left text-[13.5px] outline-none',
          dense ? 'h-9' : 'h-10',
          open ? 'border-teal-400 ring-[3px] ring-teal-50' : 'border-n-200 hover:border-n-300',
          disabled && 'cursor-not-allowed opacity-60',
          className,
        )}
      >
        <CalendarIcon size={16} className="shrink-0 text-n-400" />
        <span className={cn('flex-1 truncate', sel ? 'text-n-800' : 'text-n-400')}>
          {sel ? `${MONTHS[sel.m].slice(0, 3)} ${sel.y}` : placeholder}
        </span>
        {clearable && sel && !disabled ? (
          <span
            role="button"
            tabIndex={-1}
            title="Clear"
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            className="grid h-5 w-5 place-items-center rounded text-n-400 hover:bg-n-100 hover:text-n-700"
          >
            <X size={14} />
          </span>
        ) : (
          <ChevronsUpDown size={15} className="shrink-0 text-n-400" />
        )}
      </button>

      <PickerPopover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)}>
        <div className="w-[252px] select-none p-1.5">
          <div className="mb-1 flex items-center justify-between px-0.5">
            <button type="button" className={navBtn} onClick={() => setYear((y) => y - 1)} aria-label="Previous year"><ChevronLeft size={15} /></button>
            <div className="text-[13.5px] font-semibold text-n-900">{year}</div>
            <button type="button" className={navBtn} onClick={() => setYear((y) => y + 1)} aria-label="Next year"><ChevronRight size={15} /></button>
          </div>
          <div className="grid grid-cols-3 gap-1 p-0.5">
            {MONTHS.map((name, m) => {
              const isSel = !!sel && sel.y === year && sel.m === m;
              const dis = monthDisabled(year, m);
              return (
                <button
                  key={name}
                  type="button"
                  disabled={dis}
                  onClick={() => !dis && pick(m)}
                  className={cn(
                    'h-9 rounded-md text-[13px] transition-colors',
                    isSel ? 'bg-primary font-semibold text-white hover:bg-primary-hover'
                      : dis ? 'cursor-not-allowed text-n-200'
                      : 'text-n-800 hover:bg-n-100',
                  )}
                >
                  {name.slice(0, 3)}
                </button>
              );
            })}
          </div>
        </div>
      </PickerPopover>
    </>
  );
}
