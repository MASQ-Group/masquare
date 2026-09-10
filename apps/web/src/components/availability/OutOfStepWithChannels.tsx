import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Pagination } from '@masquare/ui';
import { availabilityApi, channelListingsApi, type AvailabilityDriftRow } from '../../lib/api';
import { formatDate } from '../../lib/format';

/**
 * Products whose channels advertise a quantity we do not hold.
 *
 * This is the worklist half of the reconcile: the sweep may be allowed to correct these
 * automatically, but that setting starts off, so for the first few days this page is the whole
 * mechanism — somebody reads it and decides.
 *
 * It exists because the question had no home. A unit sold, availability correctly went to zero, and
 * whether the marketplaces had been told was unanswerable from inside the platform. Per product that
 * is now on the availability history; across the catalogue, it is here.
 *
 * What is compared: `listedQuantity` is the marketplace's own figure as of the last pull, so a row
 * means the channel really was advertising a different number when we last looked. The pull date
 * travels with every line because that freshness is the caveat, and hiding it would let a stale
 * comparison read as a live one.
 */
export function OutOfStepWithChannels() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['availability-drift', page],
    queryFn: () => availabilityApi.drift({ page, pageSize }),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  // Separated in the header so an uncounted product never inflates an overselling figure.
  const uncounted = items.filter((i) => i.unestablishedZero).length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const push = useMutation({
    mutationFn: (productIds: string[]) => channelListingsApi.push(productIds, false),
    onSuccess: (r: any) => {
      toast.success(`${r.ok}/${r.count} listing(s) updated`);
      qc.invalidateQueries({ queryKey: ['availability-drift'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not push to the channels'),
  });

  if (isLoading) {
    return (
      <div className="card flex items-center gap-2 px-4 py-6 text-[13px] text-n-500">
        <Loader2 size={15} className="animate-spin" /> Comparing every channel against what we hold…
      </div>
    );
  }
  if (isError) return <p className="card px-4 py-6 text-[13px] text-danger">Could not load the comparison.</p>;

  if (total === 0) {
    return (
      <div className="card px-4 py-6 text-[13px] text-n-600">
        <p className="font-medium text-n-800">Every channel agrees with what we hold.</p>
        {/*
          An empty worklist has two very different meanings and must not be allowed to read as the
          reassuring one by default. A product with no availability figure is not compared at all,
          so "nothing out of step" can mean "nothing to compare".
        */}
        <p className="mt-1 text-n-500">
          Only products that have an availability figure are compared — one with no figure has
          nothing to be out of step with, so it never appears here.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-n-100 px-4 py-2.5 text-[12px] text-n-500">
          <AlertTriangle size={14} className="text-orange-500" />
          <span className="font-medium text-n-700">{total} product{total === 1 ? '' : 's'}</span>
          <span className="text-n-400">·</span>
          <span>{data?.channelCount} listing{data?.channelCount === 1 ? '' : 's'} advertising a different quantity</span>
          {uncounted > 0 && <span className="text-n-400">·</span>}
          {uncounted > 0 && <span>{uncounted} awaiting a count, not oversold</span>}
          <span className="text-n-400">·</span>
          <span>worst first</span>
        </div>

        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['Product', 'We hold', 'Channels out of step', ''].map((h, i) => (
                <th key={h || i} className={`border-b border-n-200 bg-n-25 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-n-500 ${i === 1 ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((row) => <DriftRow key={row.productId} row={row} onPush={() => push.mutate([row.productId])} pushing={push.isPending} />)}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="mt-3">
          <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
        </div>
      )}
    </>
  );
}

function DriftRow({ row, onPush, pushing }: { row: AvailabilityDriftRow; onPush: () => void; pushing: boolean }) {
  const held = row.held ?? 0;
  /**
   * How much a channel is advertising beyond what exists — the number that turns into an oversell.
   * Shown per channel rather than summed: eight marketplaces each showing one spare unit is eight
   * separate chances to sell it, not one.
   */
  const worst = Math.max(...row.channels.map((c) => (c.listedQuantity ?? 0) - held));

  return (
    <tr className="align-top hover:bg-n-25">
      <td className="border-b border-n-100 px-4 py-2.5">
        <div className="code text-[12.5px] font-medium text-n-800">{row.mainSku}</div>
        <div className="max-w-[280px] truncate text-[12px] text-n-500" title={row.title ?? undefined}>
          {row.brand ? <span className="text-n-400">{row.brand} · </span> : null}{row.title ?? '—'}
        </div>
      </td>
      <td className="mono border-b border-n-100 px-4 py-2.5 text-right text-[13px] font-medium text-n-800">{row.held ?? '—'}</td>
      <td className="border-b border-n-100 px-4 py-2.5">
        <div className="flex flex-wrap gap-1.5">
          {row.channels.map((c, i) => (
            <span
              key={`${c.channelSku}-${c.marketplace}-${i}`}
              className={`tag border ${(c.listedQuantity ?? 0) > held ? 'border-orange-200 bg-orange-50 text-orange-800' : 'border-n-200 bg-n-50 text-n-600'}`}
              title={`Last checked ${c.lastPulledAt ? formatDate(c.lastPulledAt) : 'never'}`}
            >
              {c.channelName ?? c.channelType ?? 'Channel'}{c.marketplace ? ` ${c.marketplace}` : ''}
              <span className="mono ml-1 font-medium">{c.listedQuantity ?? '—'}</span>
            </span>
          ))}
        </div>
        {worst > 0 && !row.unestablishedZero && (
          <p className="mt-1 text-[11.5px] text-orange-700">
            Up to {worst} unit{worst === 1 ? '' : 's'} more than we have, on one channel.
          </p>
        )}
        {/*
          Not an overselling alarm. This product was added to availability and never counted, so our
          zero means "unknown" rather than "none left" — and pushing it would tell every marketplace
          the product is gone on the strength of something nobody established.
        */}
        {row.unestablishedZero && (
          <p className="mt-1 text-[11.5px] text-n-500">
            We hold no counted figure for this — the zero means <strong>not yet counted</strong>, not
            out of stock. Count it before sending anything to the channels.
          </p>
        )}
      </td>
      <td className="border-b border-n-100 px-4 py-2.5 text-right">
        <button
          onClick={onPush}
          disabled={pushing || row.unestablishedZero}
          className="hbtn"
          title={row.unestablishedZero
            ? 'Count this product first — pushing an uncounted zero would empty its listings'
            : 'Send what we hold to every channel this product is listed on'}
        >
          {pushing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Push
        </button>
      </td>
    </tr>
  );
}
