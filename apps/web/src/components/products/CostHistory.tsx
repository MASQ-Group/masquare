import { useQuery } from '@tanstack/react-query';
import { costingApi, type ProductCostEvent } from '../../lib/api';
import { formatDate } from '../../lib/format';

const eur = (v: number | null | undefined, dp = 2) => (v == null ? '—' : `€${v.toFixed(dp)}`);

const REASON_LABEL: Record<string, string> = {
  opening: 'Opening',
  goods_receipt: 'Goods receipt',
  vendor_return: 'Return to vendor',
  adjustment: 'Adjustment',
};

/**
 * The ledger behind a product's average cost.
 *
 * Shows both sides of every event — the quantity and average before and after — so the
 * current figure can be traced rather than taken on trust.
 */
export function CostHistory({ productId }: { productId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['cost-history', productId],
    queryFn: () => costingApi.history(productId, 100),
  });

  if (isLoading) return <div className="mt-3 text-[12.5px] text-n-400">Loading history…</div>;
  if (!data.length) return <div className="mt-3 text-[12.5px] text-n-400">No cost events yet.</div>;

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-n-200">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={`${TH} text-left`}>When</th>
              <th className={`${TH} text-left`}>Event</th>
              <th className={`${TH} text-right`}>Qty</th>
              <th className={`${TH} text-right`}>Goods</th>
              <th className={`${TH} text-right`}>+ Landed</th>
              <th className={`${TH} text-right`}>Unit cost</th>
              <th className={`${TH} text-right`}>Average after</th>
            </tr>
          </thead>
          <tbody>
            {data.map((e: ProductCostEvent) => (
              <tr key={e.id} className="hover:bg-n-25">
                <td className={`${TD} whitespace-nowrap text-n-500`}>{formatDate(e.createdAt)}</td>
                <td className={TD}>
                  <span className="text-n-800">{REASON_LABEL[e.reason] ?? e.reason}</span>
                  {e.reference && <span className="code ml-1.5 text-[11.5px] text-teal-700">{e.reference}</span>}
                </td>
                <td className={`${TD} mono text-right ${e.qtyDelta < 0 ? 'text-danger' : 'text-n-700'}`}>
                  {e.qtyDelta > 0 ? `+${e.qtyDelta}` : e.qtyDelta}
                </td>
                <td className={`${TD} mono text-right text-n-600`}>{eur(e.goodsUnitEur)}</td>
                <td className={`${TD} mono text-right ${e.landedAddOnEur > 0 ? 'text-[#D06A5A]' : 'text-n-300'}`}>
                  {e.landedAddOnEur > 0 ? eur(e.landedAddOnEur) : '—'}
                </td>
                <td className={`${TD} mono text-right font-semibold text-n-800`}>{eur(e.unitCostEur)}</td>
                <td className={`${TD} mono text-right`}>
                  <span className="text-n-400">{e.avgBeforeEur != null ? `${eur(e.avgBeforeEur)} → ` : ''}</span>
                  <span className="font-semibold text-n-900">{eur(e.avgAfterEur)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const TH = 'border-b border-n-200 bg-n-25 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-n-500';
const TD = 'border-b border-n-100 px-3 py-2 text-[12.5px]';
