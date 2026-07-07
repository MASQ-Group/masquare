import { useEffect, useRef, useState } from 'react';
import { Calendar as CalendarIcon, ChevronsUpDown, X } from 'lucide-react';
import { cn } from './cn';
import {
  addMonths, formatDisplay, isBetween, parseISO, presetRange, RANGE_PRESETS, sameDay, startOfDay, toISO,
  type DisplayFormat, type WeekStart,
} from './date-utils';
import { CalendarMonth, PickerPopover, type DayFlags } from './datepicker-internal';

export interface DateRangeValue { from: string; to: string }
export interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  format?: DisplayFormat;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  /** Hide the preset shortcuts column. */
  hidePresets?: boolean;
  weekStart?: WeekStart;
  className?: string;
}

/** Date-range picker: preset shortcuts + two-month calendar + Apply/Cancel. */
export function DateRangePicker({
  value, onChange, format = 'dd/mm/yyyy', placeholder = 'Select range', disabled, clearable, hidePresets, weekStart = 1, className,
}: DateRangePickerProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const [start, setStart] = useState<Date | null>(null);
  const [end, setEnd] = useState<Date | null>(null);
  const [hover, setHover] = useState<Date | null>(null);
  const [view, setView] = useState<Date>(startOfDay(new Date()));
  const [preset, setPreset] = useState<string | null>(null);

  // Load the committed value into the draft whenever the panel opens.
  useEffect(() => {
    if (!open) return;
    const s = parseISO(value.from);
    const e = parseISO(value.to);
    setStart(s); setEnd(e); setHover(null); setPreset(null);
    setView(startOfDay(s ?? new Date()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (d: Date) => {
    setPreset(null);
    if (!start || (start && end)) { setStart(d); setEnd(null); return; }
    if (d < start) { setEnd(start); setStart(d); } else { setEnd(d); }
  };

  const applyPreset = (key: string) => {
    setPreset(key);
    const r = presetRange(key);
    if (!r) { setStart(null); setEnd(null); return; } // all-time
    setStart(r.from); setEnd(r.to); setView(new Date(r.from.getFullYear(), r.from.getMonth(), 1));
  };

  // Preview [lo, hi] used for shading (uses hover when only the start is chosen).
  const previewEnd = end ?? (start && hover ? hover : null);
  const lo = start && previewEnd ? (start <= previewEnd ? start : previewEnd) : start;
  const hi = start && previewEnd ? (start <= previewEnd ? previewEnd : start) : null;

  const classify = (date: Date): DayFlags => {
    if (!lo) return {};
    if (!hi) return { rangeStart: sameDay(date, lo), single: true };
    return {
      rangeStart: sameDay(date, lo),
      rangeEnd: sameDay(date, hi),
      rangeMid: isBetween(date, lo, hi),
      single: sameDay(lo, hi),
    };
  };

  const apply = () => {
    onChange({ from: start ? toISO(start) : '', to: end ? toISO(end) : (start ? toISO(start) : '') });
    setOpen(false);
  };
  const clear = () => { onChange({ from: '', to: '' }); setOpen(false); };

  const curFrom = parseISO(value.from);
  const curTo = parseISO(value.to);
  const triggerLabel = curFrom
    ? `${formatDisplay(curFrom, format)} – ${curTo ? formatDisplay(curTo, format) : '…'}`
    : placeholder;

  const box = (d: Date | null) => (
    <div className="h-9 min-w-[112px] rounded-md border border-n-200 bg-n-25 px-3 text-[13px] leading-9 text-n-800">
      {d ? formatDisplay(d, format) : <span className="text-n-400">—</span>}
    </div>
  );

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={cn(
          'flex h-10 w-full items-center gap-2 rounded-md border bg-n-0 px-3 text-left text-[13.5px] outline-none',
          open ? 'border-teal-400 ring-[3px] ring-teal-50' : 'border-n-200 hover:border-n-300',
          disabled && 'cursor-not-allowed opacity-60',
          className,
        )}
      >
        <CalendarIcon size={16} className="shrink-0 text-n-400" />
        <span className={cn('flex-1 truncate', curFrom ? 'text-n-800' : 'text-n-400')}>{triggerLabel}</span>
        {clearable && curFrom && !disabled ? (
          <span role="button" tabIndex={-1} title="Clear" onClick={(e) => { e.stopPropagation(); onChange({ from: '', to: '' }); }}
            className="grid h-5 w-5 place-items-center rounded text-n-400 hover:bg-n-100 hover:text-n-700"><X size={14} /></span>
        ) : (
          <ChevronsUpDown size={15} className="shrink-0 text-n-400" />
        )}
      </button>

      <PickerPopover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)}>
        <div className="flex max-[720px]:flex-col">
          {!hidePresets && (
            <div className="flex flex-col gap-0.5 border-r border-n-100 p-2 max-[720px]:flex-row max-[720px]:flex-wrap max-[720px]:border-b max-[720px]:border-r-0">
              {RANGE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => applyPreset(p.key)}
                  className={cn(
                    'whitespace-nowrap rounded-md px-3 py-1.5 text-left text-[12.5px] font-medium transition-colors',
                    preset === p.key ? 'bg-teal-50 text-teal-700' : 'text-n-600 hover:bg-n-50 hover:text-n-800',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex max-[560px]:flex-col">
            <CalendarMonth
              month={view} weekStart={weekStart} classify={classify} onPick={pick} onHover={setHover}
              showPrev onPrev={() => setView((v) => addMonths(v, -1))}
            />
            <div className="border-l border-n-100 max-[560px]:border-l-0 max-[560px]:border-t">
              <CalendarMonth
                month={addMonths(view, 1)} weekStart={weekStart} classify={classify} onPick={pick} onHover={setHover}
                showNext onNext={() => setView((v) => addMonths(v, 1))}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-n-200 p-2.5">
          {box(start)}
          <span className="text-n-400">–</span>
          {box(end)}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => setOpen(false)} className="inline-flex h-9 items-center rounded-md border border-n-200 bg-n-0 px-3.5 text-[13px] font-semibold text-n-700 hover:bg-n-50">Cancel</button>
            {clearable && <button type="button" onClick={clear} className="inline-flex h-9 items-center rounded-md px-2 text-[13px] font-medium text-n-500 hover:text-danger">Clear</button>}
            <button type="button" onClick={apply} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-[13px] font-semibold text-white shadow-xs hover:bg-primary-hover">Apply</button>
          </div>
        </div>
      </PickerPopover>
    </>
  );
}
