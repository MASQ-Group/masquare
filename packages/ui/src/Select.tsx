import { useRef, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from './cn';
import { PickerPopover } from './datepicker-internal';

export interface SelectOption { value: string; label: string; disabled?: boolean }

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  /** h-9 instead of the default h-10 (for compact toolbars). */
  dense?: boolean;
  /** Width / layout classes for the trigger (no height — use `dense`). */
  className?: string;
}

/** Custom single-select with a rounded, gap-separated dropdown (matches the date pickers)
 *  rendered in a portal so it escapes modal/table overflow, and a padded chevron. */
export function Select({ value, onChange, options, placeholder = 'Select…', disabled, dense, className }: SelectProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [minW, setMinW] = useState(0);
  const selected = options.find((o) => o.value === value);

  const toggle = () => {
    if (disabled) return;
    setMinW(anchorRef.current?.offsetWidth ?? 0);
    setOpen((v) => !v);
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        className={cn(
          'flex items-center gap-2 rounded-md border bg-n-0 pl-3 pr-2.5 text-left text-[13px] outline-none',
          dense ? 'h-9' : 'h-10',
          open ? 'border-teal-400 ring-[3px] ring-teal-50' : 'border-n-200 hover:border-n-300',
          disabled && 'cursor-not-allowed opacity-60',
          className ?? 'w-full',
        )}
      >
        <span className={cn('flex-1 truncate', selected ? 'text-n-800' : 'text-n-400')}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronsUpDown size={15} className="shrink-0 text-n-400" />
      </button>

      <PickerPopover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)}>
        <div className="max-h-72 overflow-auto p-1" style={{ minWidth: minW || undefined }}>
          {options.length === 0 && <div className="px-2.5 py-2 text-[12.5px] text-n-400">No options</div>}
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={o.disabled}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-teal-50',
                o.value === value ? 'font-medium text-teal-700' : 'text-n-700',
                o.disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
              )}
            >
              <span className="flex-1 truncate">{o.label}</span>
              {o.value === value && <Check size={15} className="shrink-0 text-teal-600" />}
            </button>
          ))}
        </div>
      </PickerPopover>
    </>
  );
}
