import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, ArrowDown, ArrowUp, CircleCheck, Search } from 'lucide-react';
import { Pagination } from '@masquare/ui';
import { shipmentsApi, type TrackingLogParcel, type TrackingLogRow } from '../lib/api';
import { formatDate } from '../lib/format';
import { withReturn } from '../lib/useBackLink';
import { CountryTag } from '../components/common/Flag';
import { ChannelChip, useChannelChips } from '../components/common/ChannelChip';
import { PageHeader } from '../components/common/PageHeader';
import { useAuth } from '../lib/auth';
import { usePersistentState } from '../lib/usePersistentState';

type State = 'all' | 'not_shipped' | 'in_transit' | 'delivered';

/**
 * Every order, and where its parcels have got to.
 *
 * One row per ORDER rather than per parcel: the question this page answers is "where is this
 * customer's order", and an order that went out in two boxes is still one order. The shipping
 * columns stack a line per parcel and stay aligned across the row, so the second tracking number
 * sits on the same line as the second expected date.
 *
 * Deliberately no "late" tab. Deciding that needs one date column compared against another, which
 * the query layer cannot express without raw SQL — a filter that quietly could not do what its
 * label promised would be worse than not offering it. Late deliveries are marked on the row.
 */
export function ShipmentsTrackingPage() {
  const { activeCompanyId } = useAuth();
  const [state, setState] = usePersistentState<State>('shipments-tracking.state', 'all');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const chipFor = useChannelChips();
  // Where a link opened from, so the order can offer a way back to exactly this view.
  const here = useLocation();

  // Debounced, so typing a tracking number does not fire a query per keystroke.
  useEffect(() => {
    const id = setTimeout(() => { setSearch(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => { setPage(1); }, [state, activeCompanyId]);

  const { data, isLoading } = useQuery({
    queryKey: ['tracking-log', { state, search, sortDir, page, activeCompanyId }],
    queryFn: () => shipmentsApi.trackingLog({ q: search || undefined, state, sortDir, page, pageSize }),
  });

  const rows = data?.items ?? [];
  const th = 'border-b border-n-200 bg-n-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap';
  const td = 'border-b border-n-100 px-4 py-2.5 align-top text-[13px] text-n-700';

  return (
    <>
      <PageHeader
        module="Logistics"
        title="Shipments Tracking"
        info="Every order with its carrier tracking: when it shipped, on what service, and when it is expected or arrived. Statuses come from the carrier and refresh on their own."
        tabs={[
          { key: 'all', label: 'All orders' },
          { key: 'not_shipped', label: 'Not shipped' },
          // Not "In transit": for a carrier we cannot ask, all we truly know is that no delivery
          // has been recorded. Claiming it is moving would be a guess dressed as a status.
          { key: 'in_transit', label: 'Not yet delivered' },
          { key: 'delivered', label: 'Delivered' },
        ]}
        activeTab={state}
        onTabChange={(k) => setState(k as State)}
        toolbar={
          <div className="relative w-[320px] max-w-full">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-n-400" />
            <input
              className="h-9 w-full rounded-md border border-n-200 bg-n-0 pl-9 pr-3 text-[13px] text-n-800 placeholder:text-n-400 focus:border-teal-400 focus:outline-none focus:ring-[3px] focus:ring-teal-50"
              placeholder="Order ID, tracking number or SKU"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        }
      />

      <div className="overflow-hidden rounded-lg border border-n-200 bg-n-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] border-collapse">
            <thead>
              <tr>
                <th className={`${th} text-left`}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 uppercase hover:text-teal-700"
                    onClick={() => { setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); setPage(1); }}
                  >
                    Order date {sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                  </button>
                </th>
                <th className={`${th} text-left`}>Order ID</th>
                <th className={`${th} text-left`}>Sales channel</th>
                <th className={`${th} text-left`}>SKU(s)</th>
                <th className={`${th} text-left`}>Destination</th>
                <th className={`${th} text-left`}>Shipping date</th>
                <th className={`${th} text-left`}>Shipping service</th>
                <th className={`${th} text-left`}>Tracking number(s)</th>
                <th className={`${th} text-left`}>Expected delivery</th>
                <th className={`${th} text-left`}>Delivery date</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={10} className="px-4 py-10 text-center text-[13px] text-n-500">Loading…</td></tr>}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-[13px] text-n-500">
                  {search ? `Nothing matches “${search}”.` : 'No orders here yet.'}
                </td></tr>
              )}
              {rows.map((r) => <Row key={r.transactionId} row={r} td={td} chipFor={chipFor} here={here} />)}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        page={page}
        pageCount={Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))}
        onPageChange={setPage}
      />
    </>
  );
}

function Row({ row, td, chipFor, here }: { row: TrackingLogRow; td: string; chipFor: ReturnType<typeof useChannelChips>; here: { pathname: string; search: string } }) {
  const parcels = row.parcels;
  return (
    <tr className="hover:bg-teal-50/50">
      <td className={`${td} mono whitespace-nowrap`}>{formatDate(row.date)}</td>
      <td className={td}>
        {/* Carries where it was opened from, so the order offers a way straight back to this
            list rather than to the transactions list nobody was looking at. */}
        <Link to={withReturn(`/sales-transactions/${row.transactionId}/edit`, here)} className="font-medium text-n-800 hover:text-teal-700 hover:underline">
          {row.transactionRef ?? '—'}
        </Link>
      </td>
      <td className={td}>
        {row.salesChannel ? <ChannelChip name={row.salesChannel.name} {...chipFor(row.salesChannel.id)} /> : '—'}
      </td>
      <td className={`${td} max-w-[200px]`}>
        {/* Every SKU, wrapped rather than truncated: a picker checking a two-line order should not
            have to hover to find out what the second line was. */}
        <span className="code text-[12px] leading-5">{row.skus.length ? row.skus.join(', ') : '—'}</span>
      </td>
      {/* Its own column rather than a second line under the order ID: where a parcel is going is
          something you scan down a list for, and a value tucked under another one cannot be. */}
      <td className={`${td} whitespace-nowrap`}>
        {row.destinationCountry?.isoCode
          ? <CountryTag code={row.destinationCountry.isoCode} name={row.destinationCountry.name} />
          : <span className="text-n-400">—</span>}
      </td>

      {/*
        One line per parcel, in the same order in every column.
        That alignment is the whole trick: the second tracking number, the second expected date and
        the second delivery date all sit on the second line, so a two-parcel order reads across.
      */}
      <ParcelCell td={td} parcels={parcels} render={(p) => <span className="mono">{formatDate(p.shipmentDate)}</span>} />
      <ParcelCell td={td} parcels={parcels} render={(p) => <>{p.serviceName ?? '—'}</>} />
      <ParcelCell td={td} parcels={parcels} render={(p) => (
        p.trackingNumber
          ? <span className={`code ${p.notRecognised ? 'text-warning' : ''}`} title={p.notRecognised ? 'The carrier does not recognise this number' : undefined}>{p.trackingNumber}</span>
          : <>—</>
      )} />
      <ParcelCell td={td} parcels={parcels} render={(p) => (
        p.expectedAt ? <span className="mono">{formatDate(p.expectedAt)}</span> : <span className="text-n-400">—</span>
      )} />
      <ParcelCell td={td} parcels={parcels} render={(p) => {
        if (p.deliveredAt) {
          return (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <CircleCheck size={13} className="shrink-0 text-teal-600" />
              <span className="mono">{formatDate(p.deliveredAt)}</span>
              {/* Only where both dates exist. `late === null` means unknown, not on time. */}
              {p.late === true && <span className="text-[11.5px] font-medium text-warning">late</span>}
            </span>
          );
        }
        // Still out, and something went wrong. This is the one cell on the page worth interrupting
        // somebody for, so it is the only one that gets colour.
        if (p.exceptionDescription) {
          return (
            <span className="inline-flex items-start gap-1.5 text-warning" title={p.exceptionDescription}>
              <AlertTriangle size={13} className="mt-px shrink-0" />
              <span className="line-clamp-2 text-[12px]">{p.exceptionDescription}</span>
            </span>
          );
        }
        return <span className="text-[12px] text-n-400">{p.statusDescription ?? 'Not delivered'}</span>;
      }} />
    </tr>
  );
}

/** One cell, one line per parcel — or a dash where the order has not shipped. */
function ParcelCell({
  td, parcels, render,
}: {
  td: string;
  parcels: TrackingLogParcel[];
  render: (p: TrackingLogParcel) => React.ReactNode;
}) {
  if (!parcels.length) return <td className={`${td} text-n-400`}>—</td>;
  return (
    <td className={td}>
      <div className="flex flex-col gap-1">
        {parcels.map((p) => <div key={p.shipmentId} className="min-h-[18px] leading-[18px]">{render(p)}</div>)}
      </div>
    </td>
  );
}
