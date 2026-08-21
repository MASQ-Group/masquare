import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
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
  /**
   * Type-to-filter. Every dropdown in the platform is searchable by default once the list is
   * long enough to be worth scanning; pass `true` or `false` to force it either way.
   */
  searchable?: boolean;
  /** Placeholder for the filter box. */
  searchPlaceholder?: string;
}

/** Lists at or above this length get a filter box. Below it, the whole list is already visible
 *  and a search field is more chrome than help. */
const SEARCHABLE_FROM = 6;

/**
 * Rank an option against what the user typed.
 *
 * Ordered so the most likely intent surfaces first: an exact match, then a prefix, then a word
 * starting with it ("Amazon **AUS**"), then anything containing it. Returns null for no match.
 */
function score(label: string, needle: string): number | null {
  const l = label.toLowerCase();
  if (l === needle) return 0;
  if (l.startsWith(needle)) return 1;
  if (l.split(/[\s\-_/·(]+/).some((w) => w.startsWith(needle))) return 2;
  return l.includes(needle) ? 3 : null;
}

/** Custom single-select with a rounded, gap-separated dropdown (matches the date pickers)
 *  rendered in a portal so it escapes modal/table overflow, and a padded chevron. */
export function Select({
  value, onChange, options, placeholder = 'Select…', disabled, dense, className,
  searchable, searchPlaceholder = 'Type to filter…',
}: SelectProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [minW, setMinW] = useState(0);
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.value === value);
  const withSearch = searchable ?? options.length >= SEARCHABLE_FROM;

  // A stale filter would hide the list next time the dropdown is opened.
  useEffect(() => { if (!open) setQuery(''); }, [open]);
  useEffect(() => {
    if (open && withSearch) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open, withSearch]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options
      .map((o) => ({ o, s: score(o.label, needle) }))
      .filter((x): x is { o: SelectOption; s: number } => x.s !== null)
      .sort((a, b) => a.s - b.s)
      .map((x) => x.o);
  }, [options, query]);

  const toggle = () => {
    if (disabled) return;
    setMinW(anchorRef.current?.offsetWidth ?? 0);
    setOpen((v) => !v);
  };

  const commit = (v: string) => { onChange(v); setOpen(false); };

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
        <div style={{ minWidth: minW || undefined }}>
          {withSearch && (
            <div className="flex items-center gap-1.5 border-b border-n-100 px-2.5 py-1.5">
              <Search size={14} className="shrink-0 text-n-400" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Enter takes the best match, so a dropdown can be driven without the mouse.
                  if (e.key === 'Enter' && shown.length) {
                    e.preventDefault();
                    const first = shown.find((o) => !o.disabled);
                    if (first) commit(first.value);
                  }
                  if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
                }}
                placeholder={searchPlaceholder}
                className="w-full bg-transparent text-[13px] text-n-800 outline-none placeholder:text-n-400"
              />
            </div>
          )}
          <div className="max-h-72 overflow-auto p-1">
            {shown.length === 0 && (
              <div className="px-2.5 py-2 text-[12.5px] text-n-400">
                {options.length === 0 ? 'No options' : `Nothing matches “${query.trim()}”`}
              </div>
            )}
            {shown.map((o) => (
              <button
                key={o.value}
                type="button"
                disabled={o.disabled}
                onClick={() => commit(o.value)}
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
        </div>
      </PickerPopover>
    </>
  );
}
