import { useQuery } from '@tanstack/react-query';
import { Warehouse } from 'lucide-react';
import { stockApi } from '../../lib/api';

/**
 * Read-only stock breakdown for one product, per warehouse, shown inside the Product card.
 * Availability comes from the same source of truth as everywhere else (warehouses flagged
 * to count toward inventory); warehouses that don't count are shown but visibly set apart.
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
        <Stat label="Available to sell" value={data.available} accent />
        <Stat label="Total on hand" value={data.total} sub="incl. non-inventory locations" />
      </div>

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
        Stock is moved by goods receipts, sales of serial-tracked products, returns, and manual adjustments — never edited here.
      </p>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: number; sub?: string; accent?: boolean }) {
  return (
    <div className={`flex-1 rounded-lg border px-4 py-3 ${accent ? 'border-teal-200 bg-teal-50' : 'border-n-200 bg-n-25'}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-n-500">{label}</div>
      <div className={`mono mt-0.5 text-[22px] font-bold ${accent ? 'text-teal-800' : 'text-n-900'}`}>{value}</div>
      {sub && <div className="text-[11.5px] text-n-400">{sub}</div>}
    </div>
  );
}
