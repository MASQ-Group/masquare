import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { availabilityApi, type AvailabilityDetail } from '../../lib/api';
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

/**
 * The reasons the ledger records, in the platform's words rather than the enum's.
 *
 * `cancellation` is LEGACY. Until the reason was decided rather than inferred from the sign of the
 * movement, every release was filed under it — draft orders, deleted orders and genuine
 * cancellations alike.
 *
 * Getting its label right took two attempts and both failures were the same failure. "Cancelled
 * before shipment" claimed a cancellation; "Returned — cause not recorded" claimed a return. Both
 * were said about orders that shipped normally and came back to nobody, and a customer returning
 * goods is a different and more alarming thing than the platform quietly releasing units it should
 * have kept deducted.
 *
 * Most of these rows have since been re-derived — as `order_edited` where the ledger shows the same
 * units taken straight back, and as `order_not_submitted` where the order behind them is still a
 * draft. Both are provable. What is left is genuinely unknowable, and says so: units came back, and
 * nobody wrote down why.
 */
const REASON: Record<string, { label: string; tone: string }> = {
  sale: { label: 'Sold', tone: 'border-teal-100 bg-teal-50 text-teal-700' },
  order_cancelled: { label: 'Cancelled before shipment', tone: 'border-orange-100 bg-orange-50 text-orange-700' },
  order_edited: { label: 'Order edited — units retaken', tone: 'border-n-200 bg-n-50 text-n-600' },
  order_line_removed: { label: 'Order edited — product removed', tone: 'border-n-200 bg-n-50 text-n-600' },
  order_not_submitted: { label: 'Released — order not submitted', tone: 'border-n-200 bg-n-50 text-n-600' },
  released: { label: 'Released', tone: 'border-n-200 bg-n-50 text-n-600' },
  quantity_reduced: { label: 'Quantity reduced', tone: 'border-n-200 bg-n-50 text-n-600' },
  cancellation: { label: 'Units restored — cause not recorded', tone: 'border-n-200 bg-n-50 text-n-500' },
  manual_set: { label: 'Set by hand', tone: 'border-n-200 bg-n-50 text-n-600' },
  manual_adjust: { label: 'Adjusted by hand', tone: 'border-n-200 bg-n-50 text-n-600' },
  vendor_import: { label: 'Vendor file', tone: 'border-violet-200 bg-violet-50 text-violet-700' },
  purge: { label: 'Purged', tone: 'border-danger-bd bg-danger-bg text-danger' },
};

/**
 * The rows people ask about, explained where they are rather than in a note somewhere else.
 *
 * Both of these describe a rule the platform no longer follows, so without a word of context they
 * read as accusations against the orders they name.
 */
const EXPLAIN: Record<string, string> = {
  order_edited:
    'Editing an order rebuilds its lines, so the platform returns their availability and takes it '
    + 'again in the same moment. Both halves are recorded. The net effect on the quantity is nothing '
    + '— derived from the matching entry that took these units straight back.',
  order_line_removed:
    'An edit took this product off the order, so its units were returned and stayed returned. '
    + 'Derived from the order, which no longer carries a line for it — lines only ever change '
    + 'through an edit.',
  released:
    'The order was deleted, so everything it was holding went back. Derived from the order itself.',
  order_not_submitted:
    'The platform used to give units back for any order that was not marked submitted, even one the '
    + 'channel had already shipped. That rule is gone: a draft now consumes stock like any other order. '
    + 'Derived from the order behind this entry, which is still a draft.',
  cancellation:
    'Recorded before the platform wrote down why units came back, so the cause is genuinely unknown. '
    + 'It is not evidence of a return or a cancellation — where the cause could be established, the '
    + 'entry says so instead.',
};

/**
 * Whether the channels were actually told, and when.
 *
 * The question this answers came in as a report: a unit sold, availability correctly went to 0, and
 * there was no way to tell whether the marketplaces had been told 0 — only a belief that they had
 * not. "The push never ran", "it ran and was rejected" and "it is still in the debounce window" are
 * three different faults with three different fixes, and none of them was visible from anywhere in
 * the platform.
 *
 * The headline comparison deliberately does not depend on the push log: it reads the marketplace's
 * own figure from the last pull, so it holds whether or not an attempt was ever logged. The
 * attempts below explain why a difference exists.
 */
function ChannelSync({ data }: { data: AvailabilityDetail }) {
  const channels = data.channels ?? [];
  const pushes = data.pushes ?? [];
  const held = data.quantity;
  const drifted = channels.filter((c) => c.drifted);

  if (channels.length === 0) {
    return (
      <p className="mb-4 rounded-md border border-n-200 bg-n-25 px-3 py-2.5 text-[12.5px] text-n-600">
        This product is not listed on any channel you can see, so there is nothing to push a quantity to.
      </p>
    );
  }

  return (
    <div className="mb-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-n-800">Channel quantity sync</h3>
        <span className="text-[11.5px] text-n-500">
          we hold <span className="mono font-medium text-n-700">{held ?? '—'}</span>
        </span>
      </div>

      {drifted.length > 0 ? (
        <p className="mb-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-[12.5px] text-orange-800">
          <strong>{drifted.length}</strong> of {channels.length} channel{channels.length === 1 ? '' : 's'} still
          {' '}were advertising a different quantity when last checked — the figure shown below, not {held ?? '—'}.
        </p>
      ) : (
        <p className="mb-2 rounded-md border border-teal-100 bg-teal-50 px-3 py-2 text-[12.5px] text-teal-800">
          Every channel was showing {held ?? '—'} when last checked — the quantity is in sync.
        </p>
      )}

      <table className="w-full border-collapse">
        <thead>
          <tr>
            {['Channel', 'SKU', 'Channel has', 'Checked'].map((h, i) => (
              <th key={h} className={`border-b border-n-200 bg-n-25 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-n-500 ${i === 2 ? 'text-right' : 'text-left'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {channels.map((c) => (
            <tr key={c.id} className="hover:bg-n-25">
              <td className="border-b border-n-100 px-3 py-1.5 text-[12.5px] text-n-700">
                {c.channelName ?? c.channelType ?? 'Channel'}
                {c.marketplace ? <span className="ml-1 text-n-400">{c.marketplace}</span> : null}
              </td>
              <td className="code border-b border-n-100 px-3 py-1.5 text-[12px] text-n-600">{c.channelSku}</td>
              <td className={`mono border-b border-n-100 px-3 py-1.5 text-right text-[12.5px] font-medium ${c.drifted ? 'text-orange-700' : 'text-n-700'}`}>
                {c.listedQuantity ?? '—'}
              </td>
              {/*
                The PULL date, not the push date. A full pull deletes and recreates every listing
                row, so the push stamp never survives one — across the whole table not a single row
                carries one, and a column that always read "never" would be worse than no column.
              */}
              <td className="mono border-b border-n-100 px-3 py-1.5 text-[12px] text-n-500">
                {c.lastPulledAt ? formatDate(c.lastPulledAt) : <span className="text-n-300">never</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {pushes.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[12px] text-n-500 hover:text-n-700">
            {pushes.length} recent push attempt{pushes.length === 1 ? '' : 's'}
          </summary>
          <table className="mt-1.5 w-full border-collapse">
            <tbody>
              {pushes.map((p) => (
                <tr key={p.id}>
                  <td className="mono whitespace-nowrap border-b border-n-100 px-3 py-1.5 text-[12px] text-n-500">{formatDate(p.createdAt)}</td>
                  <td className="border-b border-n-100 px-3 py-1.5 text-[12px] text-n-600">
                    {p.channelName ?? 'Channel'}{p.marketplace ? ` ${p.marketplace}` : ''}
                  </td>
                  <td className="mono border-b border-n-100 px-3 py-1.5 text-[12px] text-n-600">
                    {p.previousValue ?? '—'} → {p.requestedValue ?? '—'}
                  </td>
                  <td className="border-b border-n-100 px-3 py-1.5 text-[12px]">
                    <span className={p.ok ? 'text-teal-700' : 'text-danger'}>{p.ok ? 'accepted' : 'rejected'}</span>
                  </td>
                  {/* The channel's own words on a rejection — the whole reason to keep these rows. */}
                  <td className="max-w-[220px] truncate border-b border-n-100 px-3 py-1.5 text-[11.5px] text-n-500" title={p.message ?? undefined}>
                    {p.message ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : (
        /*
         * No attempt at all is a finding, not an empty state — it is the difference between a push
         * that failed and a push that never happened, so it says which.
         */
        <p className="mt-2 text-[12px] text-n-500">
          No quantity push has ever been attempted for this product. A sale schedules one a few
          seconds after it is saved, so nothing here means the schedule never ran rather than that a
          channel refused.
        </p>
      )}
    </div>
  );
}

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
      <div className="flex max-h-[88vh] w-[760px] max-w-full flex-col rounded-lg bg-n-0 shadow-lg">
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

          {data && <ChannelSync data={data} />}

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
                        <span
                          className={`tag border ${reason.tone}`}
                          title={EXPLAIN[e.reason]}
                        >
                          {reason.label}
                        </span>
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
