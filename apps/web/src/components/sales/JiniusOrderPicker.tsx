import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { jiniusOrdersApi, type JiniusPickerOrder } from '../../lib/api';

/**
 * The Jinius Order ID box on a local sale line.
 *
 * Type part of an order number or a SKU and it offers the Jinius sales nothing invoices yet, newest
 * first. Choosing one fills the invoice with that order's products and the money that actually
 * arrived for them — the price less everything Jinius kept, split into a unit net price and the
 * product's own VAT rate.
 *
 * Only unlinked sales are offered: an order already covered by an invoice must not be invoiced twice,
 * which is the whole reason this exists.
 */
export function JiniusOrderPicker({ value, orderRef, onPick, onClear }: {
  /** The order already on this line, if any. */
  value: string | null;
  orderRef?: string | null;
  onPick: (order: JiniusPickerOrder) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const found = useQuery({
    queryKey: ['jinius', 'unlinked', q],
    queryFn: () => jiniusOrdersApi.unlinked(q.trim() || undefined),
    enabled: open,
  });

  if (value) {
    return (
      <div className="flex h-[34px] items-center gap-1.5 rounded-[9px] border border-teal-200 bg-teal-50 px-2">
        <span className="mono truncate text-[12px] text-teal-800" title={orderRef ?? value}>{orderRef ?? 'Jinius order'}</span>
        <button type="button" className="ml-auto text-teal-700 hover:text-teal-900" title="Remove the Jinius order from this line" onClick={onClear}>
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <div ref={box} className="relative">
      <input
        className="input mono h-[34px] text-[12px]"
        placeholder="Jinius order…"
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
      />
      {open && (
        <div className="absolute left-0 top-[38px] z-30 max-h-[260px] w-[340px] overflow-auto rounded-lg border border-n-200 bg-n-0 p-1 shadow-lg">
          {found.isFetching && <div className="flex items-center gap-1.5 px-2 py-1.5 text-[12px] text-n-500"><Loader2 size={12} className="animate-spin" /> Looking…</div>}
          {!found.isFetching && (found.data?.orders ?? []).length === 0 && (
            <div className="px-2 py-1.5 text-[12px] text-n-500">No Jinius sale waiting to be invoiced matches that.</div>
          )}
          {(found.data?.orders ?? []).map((o) => (
            <button
              key={o.id}
              type="button"
              className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-teal-50"
              onClick={() => { onPick(o); setOpen(false); setQ(''); }}
            >
              <span className="flex items-baseline gap-2">
                <span className="mono text-[12.5px] font-semibold text-n-800">{o.ref}</span>
                <span className="text-[11.5px] text-n-500">{new Date(o.orderedAt).toLocaleDateString('en-GB')}</span>
                <span className="mono ml-auto text-[12px] text-n-700">€{o.grossTotal.toFixed(2)}</span>
              </span>
              <span className="truncate text-[11.5px] text-n-500">
                {o.lines.length} line{o.lines.length === 1 ? '' : 's'}: {o.lines.map((l) => l.sku).join(', ')}
              </span>
              {o.problems.length > 0 && <span className="text-[11px] text-warning">{o.problems[0]}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
