import { useEffect, useRef, useState } from 'react';
import { Calendar as CalendarIcon, ChevronsUpDown, X } from 'lucide-react';
import { cn } from './cn';
import { addMonths, formatDisplay, parseISO, sameDay, startOfDay, toISO, type DisplayFormat, type WeekStart } from './date-utils';
import { CalendarMonth, PickerPopover, type DayFlags } from './datepicker-internal';

export interface DatePickerProps {
  /** ISO date "YYYY-MM-DD" (or '' for none). */
  value: string;
  onChange: (value: string) => void;
  format?: DisplayFormat;
  placeholder?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  clearable?: boolean;
  weekStart?: WeekStart;
  className?: string;
}

/** Single-date picker: a text trigger showing the formatted date and a calendar popover. */
export function DatePicker({
  value, onChange, format = 'dd/mm/yyyy', placeholder = 'Select date', min, max, disabled, clearable, weekStart = 1, className,
}: DatePickerProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selected = parseISO(value);
  const minD = parseISO(min);
  const maxD = parseISO(max);
  const [view, setView] = useState<Date>(() => selected ?? startOfDay(new Date()));

  useEffect(() => { if (open) setView(selected ?? startOfDay(new Date())); /* eslint-disable-next-line */ }, [open]);

  const disabledDay = (d: Date) => (minD && d < minD) || (maxD && d > maxD) || false;
  const classify = (date: Date): DayFlags => ({ selected: sameDay(date, selected), disabled: disabledDay(date) });

  const pick = (d: Date) => { onChange(toISO(d)); setOpen(false); };

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
        <span className={cn('flex-1 truncate', selected ? 'text-n-800' : 'text-n-400')}>
          {selected ? formatDisplay(selected, format) : placeholder}
        </span>
        {clearable && selected && !disabled ? (
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
        <CalendarMonth
          month={view}
          weekStart={weekStart}
          classify={classify}
          onPick={pick}
          showPrev showNext
          onPrev={() => setView((v) => addMonths(v, -1))}
          onNext={() => setView((v) => addMonths(v, 1))}
        />
      </PickerPopover>
    </>
  );
}
