import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { carriersApi } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { TrackingPanel, useTrackingRefresh } from '../shipments/TrackingPanel';

/**
 * Where an order's parcels are, on the order itself.
 *
 * The question people bring to an order screen is "where is the customer's parcel", and the only
 * answer here used to be a tracking number to copy into somebody else's website. One request covers
 * the whole order: an order can go out in several parcels, and asking per row would mean the screen
 * firing a request each to answer one question.
 *
 * Several parcels get a switcher rather than a stack. Stacked, three journeys read as one long
 * confusing one; switched, each is a whole parcel with its own status and history.
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
  const [active, setActive] = useState(0);
  /** Which shipments the last refresh covered, so only those carry the "couldn't reach" caption. */
  const [lastAsked, setLastAsked] = useState<string[]>([]);
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
    return <p className="text-[13px] text-n-500">Nothing has shipped on this order yet.</p>;
  }

  const current = shipments[Math.min(active, shipments.length - 1)];
  const ask = (ids: string[]) => { setLastAsked(ids); refresh.mutate(ids); };
  const failed = refresh.isError || (refresh.data?.failedCalls ?? 0) > 0;

  const body = (
    <div className="flex flex-col gap-3">
      {shipments.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {shipments.map((s, i) => (
            <button
              key={s.shipmentId}
              type="button"
              onClick={() => setActive(i)}
              title={s.trackingNumber ?? undefined}
              className={`inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-[12.5px] font-semibold ${
                i === active
                  ? 'border-teal-300 bg-teal-50 text-teal-700'
                  : 'border-n-200 bg-n-0 text-n-600 hover:border-teal-300 hover:text-teal-700'
              }`}
            >
              Parcel {i + 1}
              {/* An inbound or replacement leg is a different parcel doing a different job, and
                  saying which is worth more than the number on a tab. */}
              {s.type !== 'outbound' && (
                <span className="text-[11px] font-medium text-n-500">{s.type === 'inbound' ? 'return' : 'replacement'}</span>
              )}
            </button>
          ))}
          <span className="ml-1 text-[11.5px] text-n-400">
            {shipments.length} parcels · {formatDate(current.shipmentDate)}
          </span>
        </div>
      )}

      <TrackingPanel
        key={current.shipmentId}
        view={current}
        compact={compact}
        onRefresh={current.trackable && current.trackingNumber ? () => ask([current.shipmentId]) : undefined}
        refreshing={refresh.isPending}
        refreshFailed={failed && lastAsked.includes(current.shipmentId)}
      />
    </div>
  );

  if (!asCard) return body;
  return (
    <div className="card overflow-hidden p-0">
      <div className="border-b border-n-100 px-5 py-4 text-eyebrow uppercase text-n-500">Tracking</div>
      <div className="px-5 py-4">{body}</div>
    </div>
  );
}
