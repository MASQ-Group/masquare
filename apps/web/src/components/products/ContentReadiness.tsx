import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { listingApi, type ChannelContentState } from '../../lib/api';

/**
 * What this product has to say, on every channel that shows words of ours.
 *
 * The question people were answering by opening four tabs in turn, and which will only get worse as
 * channels are added: is this ready to list where we sell? One row per channel, saying where its
 * title and description come from — its own, or the product's — and what it is still waiting for.
 *
 * Read from what the platform holds rather than by asking the marketplaces. A view that made a dozen
 * API calls every time it opened would be slow enough that nobody opened it, and its answer would
 * still be a snapshot. The marketplace's own checks stay on the channel's tab, where they are asked
 * for deliberately and mean something at the moment they are asked.
 */
const TH = 'border-b border-n-200 bg-n-25 px-3 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wide text-n-500';
const TD = 'border-b border-n-100 px-3 py-2 align-top text-[12.5px]';

/** Where a piece of content came from, said in words rather than in a code. */
function Source({ source, detail }: { source: 'channel' | 'shared' | 'none'; detail?: string | null }) {
  if (source === 'none') return <span className="whitespace-nowrap text-n-400">nothing yet</span>;
  return (
    <span className="whitespace-nowrap text-n-700">
      {source === 'channel' ? 'written here' : 'from the product'}
      {detail ? <span className="ml-1 text-n-400">{detail}</span> : null}
    </span>
  );
}

export function ContentReadiness({ productId }: { productId: string }) {
  const q = useQuery({
    queryKey: ['content-readiness', productId],
    queryFn: () => listingApi.contentReadiness(productId),
  });
  const d = q.data;

  if (q.isLoading) {
    return <p className="flex items-center gap-1.5 text-[12.5px] text-n-500"><Loader2 size={13} className="animate-spin" /> Checking every channel…</p>;
  }
  if (q.isError || !d) {
    return <p className="text-[12.5px] text-n-500">Could not work out what this product has to say.</p>;
  }
  if (!d.channels.length) {
    return <p className="text-[12.5px] text-n-500">No connected channel shows words of ours, so there is nothing to prepare.</p>;
  }

  const ready = (c: ChannelContentState) => c.blockers.length === 0;

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-n-800">Ready to list?</h3>
        <span className="text-[11.5px] text-n-500">{d.summary}</span>
      </div>

      {!d.hasSharedCopy && (
        <p className="mb-2 rounded-md border border-n-200 bg-n-25 px-3 py-2 text-[12.5px] text-n-600">
          Nothing is written for the product itself yet, so each channel can only use what was written on its own tab.
          Words written here are assembled to every channel’s limits.
        </p>
      )}

      <table className="w-full table-fixed border-collapse">
        <colgroup><col className="w-[120px]" /><col className="w-[180px]" /><col className="w-[150px]" /><col className="w-[150px]" /><col /></colgroup>
        <thead>
          <tr>
            <th className={TH}>Channel</th>
            <th className={TH}>Title</th>
            <th className={TH}>Description</th>
            <th className={TH}>Category</th>
            <th className={TH}>Waiting for</th>
          </tr>
        </thead>
        <tbody>
          {d.channels.map((c) => (
            <tr key={c.channelType} className="hover:bg-n-25">
              <td className={TD}>
                <span className="flex items-center gap-1.5 whitespace-nowrap font-semibold text-n-800">
                  {ready(c)
                    ? <Check size={13} className="shrink-0 text-success" />
                    : <AlertTriangle size={13} className="shrink-0 text-warning" />}
                  {c.label}
                </span>
              </td>
              <td className={TD}>
                {/* A channel that never shows our words has no title to be ready — said, not blank. */}
                {c.title
                  ? <Source source={c.title.source} detail={c.title.value ? `${c.title.value.length}/${c.title.limit}` : null} />
                  : <span className="whitespace-nowrap text-n-400">shows their own page</span>}
              </td>
              <td className={TD}>
                {c.description ? <Source source={c.description.source} /> : <span className="text-n-400">—</span>}
              </td>
              <td className={TD}>
                {!c.category.needed
                  ? <span className="text-n-400">—</span>
                  : c.category.chosen
                    ? <span className="truncate text-n-700" title={c.category.name ?? undefined}>{c.category.name ?? 'chosen'}</span>
                    : <span className="whitespace-nowrap text-warning">not chosen</span>}
              </td>
              <td className={`${TD} text-n-600`}>
                {c.blockers.length === 0
                  ? <span className="text-success">Nothing — ready to list.</span>
                  : <ul className="flex flex-col gap-0.5">{c.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-2 text-[11.5px] text-n-500">
        Read from what the platform holds. Each channel’s own tab asks the marketplace itself, which is where
        field-by-field checks belong.
      </p>
    </section>
  );
}
