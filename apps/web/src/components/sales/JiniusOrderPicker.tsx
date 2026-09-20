import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { jiniusOrdersApi, type JiniusPickerOrder } from '../../lib/api';

/**
 * The Jinius Order ID box on a local sale line.
 *
 * Type part of an order number or a SKU and it offers the Jinius sales nothing invoices yet, newest
 * first. Choosing one fills the invoice with that order's products and the money that actually
 * arrived — the price less everything Jinius kept, as a unit net price with the product's own VAT
 * rate.
 *
 * Only unlinked sales are offered: an order already covered by an invoice must not be invoiced twice,
 * which is the whole reason this exists.
 *
 * The list is drawn in a PORTAL at a fixed position, not inside the line. Inside, it stretched the
 * items table and put a scrollbar on it — a menu should float over the page, not resize it.
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
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null);
  const anchor = useRef<HTMLDivElement>(null);

  /** Follows the input: a menu pinned to where the field WAS is worse than no menu. */
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (r) setAt({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 320) });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchor.current?.contains(target)) return;
      if ((target as HTMLElement)?.closest?.('[data-jinius-menu]')) return;
      setOpen(false);
    };
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
    <div ref={anchor}>
      <input
        className="input mono h-[34px] text-[12px]"
        placeholder="Search a Jinius order…"
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
      />
      {open && at && createPortal(
        <div
          data-jinius-menu
          className="fixed z-[80] max-h-[280px] overflow-auto rounded-lg border border-n-200 bg-n-0 p-1 shadow-xl"
          style={{ top: at.top, left: at.left, width: at.width }}
        >
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
        </div>,
        document.body,
      )}
    </div>
  );
}
