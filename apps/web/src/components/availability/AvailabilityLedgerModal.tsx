import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { availabilityApi } from '../../lib/api';
import { formatDate } from '../../lib/format';

interface Props {
  productId: string;
  mainSku: string;
  title: string | null;
  onClose: () => void;
}

/**
 * Every movement of one product's availability, and what caused each.
 *
 * The ledger has been written since availability existed and nothing has ever shown it. That made
 * the obvious question unanswerable from inside the platform: a unit sells, the figure does not
 * move, and there is no way to tell whether the deduction never ran or ran and the push to the
 * channels was lost. The two have different fixes.
 *
 * Read-only and deliberately literal — this is the audit trail, so it shows what was recorded
 * rather than an interpretation of it.
 */

/** The reasons the ledger records, in the platform's words rather than the enum's. */
const REASON: Record<string, { label: string; tone: string }> = {
  sale: { label: 'Sold', tone: 'border-teal-100 bg-teal-50 text-teal-700' },
  cancellation: { label: 'Cancelled before shipment', tone: 'border-orange-100 bg-orange-50 text-orange-700' },
  manual_set: { label: 'Set by hand', tone: 'border-n-200 bg-n-50 text-n-600' },
  manual_adjust: { label: 'Adjusted by hand', tone: 'border-n-200 bg-n-50 text-n-600' },
  vendor_import: { label: 'Vendor file', tone: 'border-violet-200 bg-violet-50 text-violet-700' },
  purge: { label: 'Purged', tone: 'border-danger-bd bg-danger-bg text-danger' },
};

export function AvailabilityLedgerModal({ productId, mainSku, title, onClose }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['availability-ledger', productId],
    queryFn: () => availabilityApi.get(productId),
  });

  const ledger = data?.ledger ?? [];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(12,16,20,0.5)] p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[88vh] w-[620px] max-w-full flex-col rounded-lg bg-n-0 shadow-lg">
        <div className="border-b border-n-200 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-n-900">Availability history</h2>
          <p className="mt-0.5 truncate text-[12.5px] text-n-500" title={title ?? undefined}>
            <span className="code">{mainSku}</span>{title ? ` · ${title}` : ''}
            {data && <> · now <span className="mono font-medium text-n-700">{data.quantity ?? '—'}</span></>}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isLoading && (
            <div className="flex items-center gap-2 py-6 text-[13px] text-n-500">
              <Loader2 size={15} className="animate-spin" /> Loading…
            </div>
          )}
          {isError && <p className="py-6 text-[13px] text-danger">Could not load this product’s history.</p>}

          {data && ledger.length === 0 && (
            <p className="rounded-md border border-n-200 bg-n-25 px-3 py-2.5 text-[12.5px] text-n-600">
              Nothing has moved this product’s availability yet. A sale records an entry here the
              moment it deducts — so if a unit has sold and this is still empty, the deduction never
              ran rather than ran and failed.
            </p>
          )}

          {ledger.length > 0 && (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['When', 'What happened', 'Change', 'Left', 'Note'].map((h, i) => (
                    <th key={h} className={`border-b border-n-200 bg-n-25 px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-n-500 ${i === 2 || i === 3 ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ledger.map((e) => {
                  const reason = REASON[e.reason] ?? { label: e.reason, tone: 'border-n-200 bg-n-50 text-n-600' };
                  return (
                    <tr key={e.id} className="hover:bg-n-25">
                      <td className="mono whitespace-nowrap border-b border-n-100 px-3 py-2 text-[12.5px] text-n-600">{formatDate(e.createdAt)}</td>
                      <td className="border-b border-n-100 px-3 py-2">
                        <span className={`tag border ${reason.tone}`}>{reason.label}</span>
                      </td>
                      {/*
                        The sign is the point, so it is never dropped.
                        A movement of -1 and a movement of 1 are opposite events and read almost
                        identically without it; a zero is a real entry too — that is what "added to
                        availability, not yet counted" looks like.
                      */}
                      <td className={`mono border-b border-n-100 px-3 py-2 text-right text-[12.5px] ${e.delta < 0 ? 'text-orange-700' : e.delta > 0 ? 'text-teal-700' : 'text-n-400'}`}>
                        {e.delta > 0 ? `+${e.delta}` : e.delta}
                      </td>
                      <td className="mono border-b border-n-100 px-3 py-2 text-right text-[12.5px] font-medium text-n-800">{e.newQuantity}</td>
                      <td className="max-w-[200px] truncate border-b border-n-100 px-3 py-2 text-[12px] text-n-500" title={e.note ?? undefined}>
                        {e.note ?? <span className="text-n-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* The endpoint returns the most recent 25. Said plainly rather than letting a truncated
              list read as the whole story. */}
          {ledger.length >= 25 && (
            <p className="mt-3 text-[11.5px] text-n-400">Showing the 25 most recent movements.</p>
          )}
        </div>

        <div className="flex items-center justify-end border-t border-n-200 px-5 py-3.5">
          <button className="inline-flex h-10 items-center rounded-md border border-n-200 bg-n-0 px-4 text-[13.5px] font-semibold text-n-700 hover:bg-n-50" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
