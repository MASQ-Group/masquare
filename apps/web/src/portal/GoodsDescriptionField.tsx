import { useMemo, useState } from 'react';
import { ChevronDown, Package } from 'lucide-react';
import type { CustomerProduct } from '../lib/api';

/**
 * The goods description, with their own catalogue behind it.
 *
 * Typing is the primary action and always works — a one-off parcel is still the common case, and a
 * field that insisted on a saved product would make people invent one. Choosing from the list is
 * the shortcut: it fills the description and every measurement the product carries, which is the
 * whole point of having saved it.
 *
 * Once chosen, the fields it filled stay editable. A product describes what usually goes in the
 * box, not what is in this one.
 */
export function GoodsDescriptionField({ value, onChange, products, onPick, invalid }: {
  value: string;
  onChange: (next: string) => void;
  products: CustomerProduct[];
  /** Chosen from the list: the caller fills the package from it. */
  onPick: (product: CustomerProduct) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const usable = useMemo(() => products.filter((p) => p.active), [products]);
  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return usable;
    return usable.filter((p) => p.name.toLowerCase().includes(q));
  }, [usable, value]);

  return (
    <div className="relative">
      <div className={`flex items-stretch rounded-md border bg-n-0 ${invalid ? 'border-danger' : 'border-n-300'}`}>
        <input
          className="h-10 min-w-0 flex-1 rounded-l-md bg-transparent px-3 text-[13px] text-n-900 outline-none placeholder:text-n-400"
          value={value}
          placeholder="What is in this box"
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => usable.length > 0 && setOpen(true)}
        />
        {usable.length > 0 && (
          <button
            type="button"
            className="flex h-10 items-center gap-1 rounded-r-md border-l border-n-200 px-2.5 text-n-500 hover:bg-n-50"
            onClick={() => setOpen((v) => !v)}
            title="Choose one of your products"
          >
            <Package size={14} />
            <ChevronDown size={14} />
          </button>
        )}
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-n-200 bg-n-0 py-1 shadow-lg">
            {matches.length === 0 ? (
              <div className="px-3 py-3 text-[12.5px] text-n-500">
                None of your products match — keep typing to describe this one instead.
              </div>
            ) : (
              matches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-n-50"
                  onClick={() => { onPick(p); setOpen(false); }}
                >
                  <Package size={14} className="mt-0.5 text-n-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-n-900">{p.name}</span>
                    <span className="mono block text-[11.5px] text-n-500">
                      {[
                        p.lengthCm && p.widthCm && p.heightCm ? `${p.lengthCm}×${p.widthCm}×${p.heightCm} cm` : null,
                        p.weightKg ? `${p.weightKg} kg` : null,
                        p.declaredValue ? `${p.currency} ${p.declaredValue}` : null,
                      ].filter(Boolean).join(' · ') || 'No measurements saved'}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
