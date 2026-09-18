import { useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Flag } from '../components/common/Flag';
import { portalApi } from '../lib/api';
import { DIAL_CODES, dialCodeFor, joinPhone, phoneCountry, splitPhone } from './dialCodes';

/**
 * A telephone number: country prefix on the left, the rest on the right.
 *
 * Stored as one string, because one string is what the carrier is given and what our team dials.
 * The split is a matter of how it is asked for, not of how it is kept — which is why the prefix is
 * chosen from a list and the number typed beside it, rather than somebody being left to remember
 * whether we want 00357, +357 or neither.
 *
 * The country AND the digits are both held here, and only joined on the way out. The first build
 * kept neither: it wrote each keystroke into the shared value and read the box back out of it, and
 * that round trip cost two bugs. Choosing a country with the number still empty did nothing, since
 * a lone prefix is not a phone number and the value would not hold one. And every space typed
 * vanished as it was typed, because reading the number back out trims it — "020 7946 0000" could
 * only be entered as "02079460000".
 *
 * A field that fights the person typing into it is worse than no field, so the text they typed is
 * now simply the text in the box, kept verbatim until they leave it.
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
  const [picked, setPicked] = useState<string | null>(null);
  const localRef = useRef<HTMLInputElement>(null);

  const fromValue = splitPhone(value);

  /**
   * The digits, exactly as typed.
   *
   * Held here rather than derived from the stored value on every keystroke — that is what ate the
   * spaces. It re-syncs when the value changes underneath us (a different shipment loaded, a form
   * reset), which is the only time the outside has something to say about what is in the box.
   */
  const [typed, setTyped] = useState(fromValue.local);
  const [syncedFrom, setSyncedFrom] = useState(value ?? '');
  if ((value ?? '') !== syncedFrom) {
    // Rendering-phase sync, the documented alternative to an effect that would render once wrong.
    setSyncedFrom(value ?? '');
    setTyped(fromValue.local);
  }

  const { dial } = fromValue;
  const local = typed;

  /**
   * Which country the field is showing.
   *
   * A prefix on the stored number wins — that is the number, and nothing on screen should disagree
   * with it. Only when there is none does the choice made here, or failing that the country the
   * parcel is going to, decide. The guess is shown plainly and can be changed; an empty box in
   * front of somebody who has to know our formatting is the worse option.
   */
  const iso = useMemo(
    () => phoneCountry({ valueDial: dial, picked, addressIso: addressCountryIso, isoCodes: countries.map((c) => c.isoCode) }),
    [dial, picked, countries, addressCountryIso],
  );

  const effective = iso ? (DIAL_CODES[iso] ?? null) : (dial ?? dialCodeFor(addressCountryIso));

  const options = useMemo(() => {
    const rows = countries
      .map((c) => ({ iso: c.isoCode?.toUpperCase() ?? '', name: c.name, code: DIAL_CODES[c.isoCode?.toUpperCase() ?? ''] }))
      .filter((r) => !!r.code);
    const query = q.trim().toLowerCase();
    if (!query) return rows;
    const bare = query.replace(/^\+/, '');
    return rows.filter((r) => r.name.toLowerCase().includes(query) || r.iso.toLowerCase().includes(query) || r.code!.startsWith(bare));
  }, [countries, q]);

  const choose = (chosenIso: string, code: string) => {
    setOpen(false);
    setQ('');
    // Remembered here whether or not it can be written into the value, so choosing a country with
    // the number still empty sticks.
    setPicked(chosenIso);
    setSyncedFrom(joinPhone(code, typed));
    onChange(joinPhone(code, typed));
    localRef.current?.focus();
  };

  const typeDigits = (text: string) => {
    setTyped(text);
    setSyncedFrom(joinPhone(effective, text));
    onChange(joinPhone(effective, text));
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
          <Flag code={iso} />
          <span className="mono">{effective ? `+${effective}` : '+—'}</span>
          <ChevronDown size={14} className="text-n-400" />
        </button>
        <input
          ref={localRef}
          className="mono h-10 min-w-0 flex-1 rounded-r-md bg-transparent px-3 text-[13px] text-n-900 outline-none placeholder:text-n-400"
          inputMode="tel"
          value={local}
          placeholder="99 123456"
          onChange={(e) => typeDigits(e.target.value)}
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
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-n-50 ${o.iso === iso ? 'bg-teal-50 text-teal-700' : 'text-n-800'}`}
                onClick={() => choose(o.iso, o.code!)}
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
