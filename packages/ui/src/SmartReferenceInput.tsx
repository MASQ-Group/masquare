import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import { cn } from './cn';
import { PickerPopover } from './datepicker-internal';

export interface ReferenceOption {
  id: string;
  label: string;
  sub?: string;
  /** Optional leading element (e.g. a country flag) shown before the label. */
  icon?: ReactNode;
}

export interface SmartReferenceInputProps {
  value?: ReferenceOption | null;
  placeholder?: string;
  /** Pull suggestions from the central store (drawn across modules). */
  fetchSuggestions: (query: string) => Promise<ReferenceOption[]>;
  onSelect: (option: ReferenceOption) => void;
  /** Clear the current selection. If omitted, the clear affordance is hidden. */
  onClear?: () => void;
  /** Create-on-confirm. If omitted, the create affordance is hidden. */
  onCreate?: (label: string) => Promise<ReferenceOption>;
  /** Confirmation message factory for create-on-confirm. */
  confirmCreate?: (label: string) => string;
  disabled?: boolean;
}

/** Typeahead used on every reference field (Module 1 §6.1). Suggests existing values
 *  centrally; offers create-on-confirm when the typed value does not exist. */
export function SmartReferenceInput({
  value,
  placeholder = 'Search or create…',
  fetchSuggestions,
  onSelect,
  onClear,
  onCreate,
  confirmCreate,
  disabled,
}: SmartReferenceInputProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ReferenceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [menuW, setMenuW] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetchSuggestions(query);
        if (alive) setOptions(res);
      } finally {
        if (alive) setLoading(false);
      }
    }, 180);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, open, fetchSuggestions]);

  // Match the dropdown to the field width when it opens. Outside-click / Escape
  // are handled by PickerPopover (the dropdown is portalled to the body).
  useEffect(() => { if (open) setMenuW(anchorRef.current?.offsetWidth ?? 0); }, [open]);

  const exactExists = options.some((o) => o.label.toLowerCase() === query.trim().toLowerCase());
  const canCreate = !!onCreate && query.trim().length > 0 && !exactExists;

  const handleCreate = async () => {
    if (!onCreate) return;
    const label = query.trim();
    const message = confirmCreate
      ? confirmCreate(label)
      : `Create new value “${label}”? It will be available across the platform.`;
    if (!window.confirm(message)) return;
    setCreating(true);
    try {
      const created = await onCreate(label);
      onSelect(created);
      setQuery('');
      setOpen(false);
    } finally {
      setCreating(false);
    }
  };

  // Show the chosen value as solid text (not a placeholder) unless the user is editing.
  const showSelected = !!value && !open && query.length === 0;

  return (
    <div>
      <div
        ref={anchorRef}
        className={cn(
          'flex h-10 items-center gap-2 rounded-md border bg-n-0 px-3',
          'border-n-200 focus-within:border-teal-400 focus-within:ring-[3px] focus-within:ring-teal-50',
          disabled && 'opacity-60',
        )}
      >
        {!showSelected && <Search size={16} className="flex-shrink-0 text-n-400" />}
        {showSelected ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setOpen(true);
              queueMicrotask(() => inputRef.current?.focus());
            }}
            className="flex h-full min-w-0 flex-1 items-center gap-2 text-left"
          >
            {value!.icon}
            <span className="truncate text-[13.5px] font-medium text-n-800">{value!.label}</span>
            {value!.sub && <span className="mono truncate text-[12px] text-n-500">{value!.sub}</span>}
          </button>
        ) : (
          <input
            ref={inputRef}
            className="h-full flex-1 bg-transparent text-[13.5px] text-n-800 outline-none placeholder:text-n-400"
            placeholder={placeholder}
            value={query}
            disabled={disabled}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
          />
        )}
        {value && onClear && !disabled && (
          <button
            type="button"
            title="Clear"
            onClick={() => { onClear(); setQuery(''); setOpen(false); }}
            className="grid h-5 w-5 flex-shrink-0 place-items-center rounded text-n-400 hover:bg-n-100 hover:text-n-700"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <PickerPopover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)}>
        <div className="max-h-72 overflow-y-auto p-1" style={{ width: menuW || undefined }}>
          {loading && <div className="px-3 py-2 text-[12px] text-n-500">Searching…</div>}
          {!loading &&
            options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  onSelect(o);
                  setQuery('');
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-teal-50"
              >
                {o.icon}
                <span className="flex-1 text-[13.5px] text-n-800">{o.label}</span>
                {o.sub && <span className="font-mono text-[11px] text-n-500">{o.sub}</span>}
                {value?.id === o.id && <Check size={15} className="text-teal-600" />}
              </button>
            ))}
          {!loading && options.length === 0 && !canCreate && (
            <div className="px-3 py-2 text-[12px] text-n-500">No matches.</div>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-teal-700 hover:bg-teal-50"
            >
              <Plus size={15} />
              <span className="text-[13.5px]">
                {creating ? 'Creating…' : `Create “${query.trim()}”`}
              </span>
            </button>
          )}
        </div>
      </PickerPopover>
    </div>
  );
}
