import { useQuery } from '@tanstack/react-query';
import { Warehouse } from 'lucide-react';
import { stockApi } from '../../lib/api';

/**
 * Read-only stock breakdown for one product, per warehouse, shown inside the Product card.
 *
 * Two numbers live on this panel and they are not the same fact. What is on a shelf comes from
 * `stock_level`, per warehouse, and moves only with a stock movement behind it. What the CHANNELS
 * have been told comes from `product_availability`, is one figure for the product, and is moved by
 * sales, returns, imports and by hand. Nothing reconciles them, deliberately — a product can be
 * published before a purchase order has landed.
 *
 * The panel used to show only the first, under the words "Available to sell". IT51879 had an
 * availability of 1 and nothing ever received against it, so the card said 0 where the Availability
 * page said 1 and neither screen admitted they were answering different questions. Both are shown
 * now, named so they cannot be read as the same number disagreeing with itself.
 */
export function ProductStockSection({ productId }: { productId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['product-stock', productId],
    queryFn: () => stockApi.byProduct(productId),
  });

  if (isLoading) return <div className="py-8 text-center text-[13px] text-n-400">Loading stock…</div>;
  if (!data) return null;

  const rows = data.rows ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <Stat label="On hand, sellable" value={data.sellableOnHand} accent sub="in inventory-counting locations" />
        <Stat label="Total on hand" value={data.total} sub="incl. non-inventory locations" />
        <Stat
          label="Published to channels"
          value={data.published}
          sub={data.published == null ? 'not in availability' : sourceWord(data.publishedSource)}
        />
      </div>

      <PublishedNote onHand={data.sellableOnHand} published={data.published} />

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-n-200 py-10 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-n-50 text-n-400"><Warehouse size={18} /></span>
          <div className="text-[13px] text-n-500">No stock anywhere yet.</div>
          <div className="text-[12px] text-n-400">Receive this product against a purchase order, or adjust stock in Warehouses.</div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-n-200">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border-b border-n-200 bg-n-25 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-n-500">Warehouse</th>
                <th className="border-b border-n-200 bg-n-25 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-n-500">Type</th>
                <th className="border-b border-n-200 bg-n-25 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-n-500">On hand</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const counts = r.includeInInventory && r.isActive;
                return (
                  <tr key={r.warehouseId} className={counts ? '' : 'opacity-60'}>
                    <td className="border-b border-n-100 px-3 py-2 text-[13px] text-n-800">
                      {r.warehouseName}
                      {!counts && <span className="ml-2 rounded bg-n-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-n-500">not counted</span>}
                    </td>
                    <td className="border-b border-n-100 px-3 py-2 text-[12.5px] capitalize text-n-500">{r.warehouseType?.toLowerCase() ?? '—'}</td>
                    <td className="mono border-b border-n-100 px-3 py-2 text-right text-[13px] font-semibold text-n-800">{r.quantityOnHand}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[12px] text-n-400">
        Stock is moved by goods receipts, sales of serial-tracked products, returns, and manual adjustments — never
        edited here. What the channels are offered is set in Availability, and is a separate figure.
      </p>
    </div>
  );
}

/** What last moved the published figure, in words rather than the stored token. */
function sourceWord(source: string | null): string {
  const words: Record<string, string> = {
    manual: 'set by hand',
    vendor_import: 'from a vendor import',
    sale: 'after a sale',
    return: 'after a return',
    cancellation: 'after a cancellation',
  };
  return source ? words[source] ?? source.replace(/_/g, ' ') : 'source not recorded';
}

/**
 * Said once, in words, only when the two numbers differ.
 *
 * Explaining the relationship unconditionally would be noise on the thousands of products where it
 * holds; saying nothing is what left somebody reading 0 against 1 and concluding one of them was
 * broken. An em-dash between the figures is not an explanation — a sentence is.
 */
function PublishedNote({ onHand, published }: { onHand: number; published: number | null }) {
  if (published == null || published === onHand) return null;
  const over = published > onHand;
  return (
    <div className={`rounded-lg border px-3 py-2 text-[12.5px] ${over ? 'border-warning-bd bg-warning-bg text-warning' : 'border-n-200 bg-n-25 text-n-600'}`}>
      {over ? (
        <>
          The channels are being offered <b className="mono">{published}</b>, and{' '}
          <b className="mono">{onHand}</b> {onHand === 1 ? 'is' : 'are'} on a sellable shelf. Publishing
          does not move stock and stock does not move publishing — an order for the difference becomes
          stock owed.
        </>
      ) : (
        <>
          <b className="mono">{onHand}</b> on a sellable shelf against <b className="mono">{published}</b>{' '}
          published, so the surplus is not being offered anywhere. Availability is what the channels see.
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: number | null; sub?: string; accent?: boolean }) {
  return (
    <div className={`flex-1 rounded-lg border px-4 py-3 ${accent ? 'border-teal-200 bg-teal-50' : 'border-n-200 bg-n-25'}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-n-500">{label}</div>
      <div className={`mono mt-0.5 text-[22px] font-bold ${accent ? 'text-teal-800' : 'text-n-900'}`}>
        {value ?? '—'}
      </div>
      {sub && <div className="text-[11.5px] text-n-400">{sub}</div>}
    </div>
  );
}
