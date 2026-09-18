import { useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Flag } from '../components/common/Flag';
import { portalApi } from '../lib/api';
import { DIAL_CODES, dialCodeFor, joinPhone, splitPhone } from './dialCodes';

/**
 * A telephone number: country prefix on the left, the rest on the right.
 *
 * Stored as one string, because one string is what the carrier is given and what our team dials.
 * The split is a matter of how it is asked for, not of how it is kept — which is why the prefix is
 * chosen from a list and the number typed beside it, rather than somebody being left to remember
 * whether we want 00357, +357 or neither.
 */
export function PhoneField({ value, onChange, addressCountryIso, invalid }: {
  value: string | null | undefined;
  onChange: (next: string) => void;
  /** The delivery country, used only to pick a sensible prefix before they choose one. */
  addressCountryIso?: string | null;
  invalid?: boolean;
}) {
  const { data: countries = [] } = useQuery({ queryKey: ['countries', 'portal'], queryFn: portalApi.countries });
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const localRef = useRef<HTMLInputElement>(null);

  const { dial, local } = splitPhone(value);
  // Nothing chosen yet: offer the country the parcel is going to. A guess we show plainly and they
  // can change beats an empty box in front of somebody who has to know our formatting.
  const effective = dial ?? dialCodeFor(addressCountryIso);
  const shownIso = useMemo(
    () => countries.find((c) => DIAL_CODES[c.isoCode?.toUpperCase() ?? ''] === effective)?.isoCode ?? null,
    [countries, effective],
  );

  const options = useMemo(() => {
    const rows = countries
      .map((c) => ({ iso: c.isoCode?.toUpperCase() ?? '', name: c.name, code: DIAL_CODES[c.isoCode?.toUpperCase() ?? ''] }))
      .filter((r) => !!r.code);
    const query = q.trim().toLowerCase();
    if (!query) return rows;
    const bare = query.replace(/^\+/, '');
    return rows.filter((r) => r.name.toLowerCase().includes(query) || r.iso.toLowerCase().includes(query) || r.code!.startsWith(bare));
  }, [countries, q]);

  const choose = (code: string) => {
    setOpen(false);
    setQ('');
    onChange(joinPhone(code, local));
    localRef.current?.focus();
  };

  return (
    <div className="relative">
      <div className={`flex items-stretch rounded-md border bg-n-0 ${invalid ? 'border-danger' : 'border-n-300'}`}>
        <button
          type="button"
          className="flex h-10 items-center gap-1.5 rounded-l-md border-r border-n-200 px-2.5 text-[13px] text-n-700 hover:bg-n-50"
          onClick={() => setOpen((v) => !v)}
          title="Country code"
        >
          <Flag code={shownIso} />
          <span className="mono">{effective ? `+${effective}` : '+—'}</span>
          <ChevronDown size={14} className="text-n-400" />
        </button>
        <input
          ref={localRef}
          className="mono h-10 min-w-0 flex-1 rounded-r-md bg-transparent px-3 text-[13px] text-n-900 outline-none placeholder:text-n-400"
          inputMode="tel"
          value={local}
          placeholder="99 123456"
          onChange={(e) => onChange(joinPhone(effective, e.target.value))}
        />
      </div>

      {open && (
        <>
          {/* Clicking anywhere else puts it away — the list is long, and nobody should have to find
              the button again to close it. */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 mt-1 max-h-72 w-[320px] overflow-auto rounded-lg border border-n-200 bg-n-0 py-1 shadow-lg">
            <div className="sticky top-0 flex items-center gap-2 border-b border-n-100 bg-n-0 px-3 py-2">
              <Search size={14} className="text-n-400" />
              <input
                autoFocus
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-n-400"
                placeholder="Country or code"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            {options.length === 0 && <div className="px-3 py-3 text-[12.5px] text-n-500">Nothing matches “{q}”.</div>}
            {options.map((o) => (
              <button
                key={o.iso}
                type="button"
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-n-50 ${o.code === effective ? 'bg-teal-50 text-teal-700' : 'text-n-800'}`}
                onClick={() => choose(o.code!)}
              >
                <Flag code={o.iso} />
                <span className="flex-1 truncate">{o.name}</span>
                <span className="mono text-n-500">+{o.code}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
