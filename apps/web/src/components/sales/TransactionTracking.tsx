import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { carriersApi } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { TrackingPanel, useTrackingRefresh } from '../shipments/TrackingPanel';

/**
 * Where an order's parcels are, on the order itself.
 *
 * The question people bring to an order screen is "where is the customer's parcel", and until now
 * the only answer here was a tracking number to copy into somebody else's website. One request
 * covers the whole order: an order can go out in several parcels, and asking per row would mean the
 * screen firing a request each to answer one question.
 *
 * `compact` is the 340px column on the order form; the roomy version is the summary modal's tab.
 */
export function TransactionTracking({ transactionId, compact, asCard }: {
  transactionId: string;
  compact?: boolean;
  /**
   * Wrap in a titled card and DISAPPEAR when the order has not shipped.
   *
   * For the order form's summary column, where space is the scarce thing: a card reading "nothing
   * has shipped yet" would sit under the money on every draft order, saying what the fulfilment
   * status above it already says. In the summary modal's tab, which the reader chose to open, the
   * same emptiness is the answer to their question and is stated plainly instead.
   */
  asCard?: boolean;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['transaction-tracking', transactionId],
    queryFn: () => carriersApi.trackingForTransaction(transactionId),
  });
  const refresh = useTrackingRefresh();

  if (isLoading) {
    if (asCard) return null;
    return (
      <div className="flex items-center gap-2 py-4 text-[13px] text-n-500">
        <Loader2 size={15} className="animate-spin" /> Loading…
      </div>
    );
  }

  const shipments = data?.shipments ?? [];
  if (!shipments.length) {
    if (asCard) return null;
    return <p className="text-[12.5px] text-n-500">Nothing has shipped on this order yet.</p>;
  }

  /**
   * Only the parcels we can actually ask about get a Refresh.
   *
   * Cyprus Post rows still appear — they are part of the consignment and leaving them out would
   * make the order look half-shipped — but pressing a button that can only ever say "this carrier
   * is not connected" is worse than not offering one.
   */
  const askable = shipments.filter((s) => s.trackable && s.trackingNumber).map((s) => s.shipmentId);

  const body = (
    <div className="flex flex-col gap-4">
      {shipments.length > 1 && askable.length > 1 && !compact && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12.5px] text-n-500">{shipments.length} parcels on this order</span>
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12.5px] font-semibold text-n-700 hover:border-teal-300 hover:text-teal-700 disabled:opacity-50"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate(askable)}
          >
            {refresh.isPending ? 'Asking FedEx…' : 'Refresh all'}
          </button>
        </div>
      )}

      {shipments.map((s) => (
        <div key={s.shipmentId} className={shipments.length > 1 ? 'rounded-md border border-n-200 p-3.5' : ''}>
          {shipments.length > 1 && (
            <div className="mb-2.5 flex flex-wrap items-center gap-2 text-[11.5px] text-n-500">
              <span className={`tag ${s.type === 'outbound' ? 'border border-teal-100 bg-teal-50 text-teal-700' : 'border border-orange-100 bg-orange-50 text-orange-700'}`}>
                {s.type === 'outbound' ? 'Outbound' : s.type === 'inbound' ? 'Inbound' : 'Replacement'}
              </span>
              <span>{formatDate(s.shipmentDate)}</span>
              {s.serviceName && <span>· {s.serviceName}</span>}
            </div>
          )}
          <TrackingPanel
            view={s}
            compact={compact}
            onRefresh={s.trackable && s.trackingNumber ? () => refresh.mutate([s.shipmentId]) : undefined}
            refreshing={refresh.isPending}
          />
        </div>
      ))}
    </div>
  );

  if (!asCard) return body;
  return (
    <div className="card overflow-hidden p-0">
      <div className="border-b border-n-100 px-5 py-4 text-[12px] font-bold uppercase tracking-wide text-n-500">Tracking</div>
      <div className="px-5 py-4">{body}</div>
    </div>
  );
}
