import { useEffect, useRef, useState } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import { cn } from './cn';

export interface ReferenceOption {
  id: string;
  label: string;
  sub?: string;
}

export interface SmartReferenceInputProps {
  value?: ReferenceOption | null;
  placeholder?: string;
  /** Pull suggestions from the central store (drawn across modules). */
  fetchSuggestions: (query: string) => Promise<ReferenceOption[]>;
  onSelect: (option: ReferenceOption) => void;
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
  onCreate,
  confirmCreate,
  disabled,
}: SmartReferenceInputProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ReferenceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

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

  return (
    <div ref={boxRef} className="relative">
      <div
        className={cn(
          'flex h-10 items-center gap-2 rounded-md border bg-n-0 px-3',
          'border-n-200 focus-within:border-teal-400 focus-within:ring-[3px] focus-within:ring-teal-50',
          disabled && 'opacity-60',
        )}
      >
        <Search size={16} className="text-n-400" />
        <input
          className="h-full flex-1 bg-transparent text-[13.5px] text-n-800 outline-none placeholder:text-n-400"
          placeholder={value ? value.label : placeholder}
          value={query}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
        {value && !query && (
          <span className="truncate text-[12px] text-n-500">{value.sub}</span>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-[44px] z-30 overflow-hidden rounded-lg border border-n-200 bg-n-0 p-1 shadow-lg">
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
      )}
    </div>
  );
}
