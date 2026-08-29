import { Minus, Plus } from 'lucide-react';
import type { StorefrontProduct } from '../../lib/api';

/**
 * Availability as a state, never a count.
 *
 * Exact stock is commercially sensitive and a buyer only needs to know whether they can have it.
 * Null means we hold no availability record — which is not the same as none — so nothing is shown
 * rather than a guess.
 */
const STATE: Record<string, { dot: string; text: string; label: string }> = {
  in_stock: { dot: 'bg-green-500', text: 'text-green-700', label: 'In stock · ships 2–3 working days' },
  limited: { dot: 'bg-warning', text: 'text-warning', label: 'Limited stock' },
  made_to_order: { dot: 'bg-info', text: 'text-info', label: 'Made to order' },
  unavailable: { dot: 'bg-n-400', text: 'text-n-500', label: 'Currently unavailable' },
};

/**
 * The price block. Shown only when there is a price to show — a card reading "—" would be worse
 * than none on a page a customer is deciding from.
 */
export function PriceCard({ price, availability, qty, onQty }: {
  price: StorefrontProduct['price'];
  availability: string | null;
  qty: number;
  onQty: (n: number) => void;
}) {
  const state = availability ? STATE[availability] : null;
  const sellable = availability !== 'unavailable';

  if (!price) {
    return (
      <div className="rounded-lg border border-n-200 bg-n-0 p-5 text-[13.5px] text-n-500 shadow-sm">
        No price is set for this product yet.
        {state && (
          <span className="ml-2 inline-flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${state.dot}`} />
            <span className={state.text}>{state.label}</span>
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-n-200 bg-n-0 px-6 py-5 shadow-sm">
      <div className="flex flex-wrap items-baseline gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold uppercase tracking-[.09em] text-teal-600">Your price</span>
          <span className="mono text-[28px] font-semibold text-n-900">
            {price.currency === 'EUR' ? '€' : `${price.currency} `}{price.amount.toFixed(2)}
          </span>
        </div>
        <span className="self-end pb-1 text-[12.5px] text-n-500">excl. VAT · per unit</span>
        <div className="flex-1" />
        {state && (
          <span className={`inline-flex items-center gap-[7px] self-end pb-1 text-[13px] font-medium ${state.text}`}>
            <span className={`h-2 w-2 rounded-full ${state.dot}`} />
            {state.label}
          </span>
        )}
      </div>

      <div className="flex gap-2.5">
        <span className="inline-flex h-10 items-stretch overflow-hidden rounded-md border border-n-200">
          <button className="w-9 text-n-500 hover:text-n-800 disabled:opacity-40" disabled={qty <= 1} onClick={() => onQty(qty - 1)}>
            <Minus size={15} className="mx-auto" />
          </button>
          <span className="mono flex items-center border-x border-n-100 px-3.5 text-[14px]">{qty}</span>
          <button className="w-9 text-n-500 hover:text-n-800" onClick={() => onQty(qty + 1)}>
            <Plus size={15} className="mx-auto" />
          </button>
        </span>
        {/* Ordering is future work — the button shows the shape of the page without pretending to
            do something that has nowhere to go. */}
        <button
          className="h-10 flex-1 rounded-md bg-teal-500 text-[13.5px] font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
          disabled={!sellable}
          title="Ordering is not built yet"
        >
          Add to order
        </button>
      </div>

      {/* Honest about what this number is. Customer pricing does not exist yet, so the page says so
          rather than passing a catalogue price off as an agreed one. */}
      <div className="text-[12px] text-n-400">Placeholder price — customer price lists are not built yet</div>
    </div>
  );
}
