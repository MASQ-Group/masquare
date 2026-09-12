import { toast } from 'sonner';
import type { ChannelListingChannel, Product } from '../../lib/api';

/**
 * Whether a product reached any channel at all, as one chip.
 *
 * The list already shows what a product IS. This says where it got to — the question somebody asks
 * before wondering why a SKU with stock behind it has never sold anything.
 *
 * Aliases are not handled here and deliberately so. A listing is attached to whichever product owns
 * the SKU it carries, main or alias, when it is pulled or relinked; by the time a row reaches this
 * component that work is done. Matching alias strings again in the browser would be a second
 * implementation of `sku-match`, free to disagree with the first.
 */

const STATUS_WORD: Record<string, string> = {
  live: 'live',
  low: 'live, low stock',
  oos: 'live, out of stock',
  paused: 'not buyable',
  error: 'error',
};

export function ListedChip({ product, channels }: { product: Product; channels: ChannelListingChannel[] }) {
  const listed = product.listedOn ?? [];
  const isListed = listed.length > 0;

  /**
   * Until the channels list arrives there is no way to name the unlisted half, so the chip still
   * answers the question it can — listed or not — and the toast says what it cannot yet show.
   */
  const byId = new Map(channels.map((c) => [c.id, c]));
  const listedChannels = listed
    .map((l) => ({ ...l, channel: byId.get(l.channelId) }))
    .sort((a, b) => (a.channel?.name ?? a.channelId).localeCompare(b.channel?.name ?? b.channelId));
  const listedIds = new Set(listed.map((l) => l.channelId));
  const unlisted = channels.filter((c) => !listedIds.has(c.id));

  const show = () => {
    toast.custom((id) => (
      <div className="w-[360px] rounded-lg border border-n-200 bg-white p-3 shadow-lg">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <div className="code text-[13px] font-semibold text-n-800">{product.mainSku}</div>
            <div className="truncate text-[12px] text-n-500" title={product.title}>{product.title}</div>
          </div>
          <button
            className="shrink-0 rounded px-1.5 text-[16px] leading-none text-n-400 hover:text-n-700"
            onClick={() => toast.dismiss(id)}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <Section
          label={`Listed on ${listedChannels.length}`}
          empty="Not listed on any channel."
          rows={listedChannels.map((l) => ({
            key: l.channelId,
            name: l.channel?.name ?? l.channelId,
            /**
             * The SKU is shown because it is frequently NOT the main one, and "which alias is live
             * on Amazon DE" is the next question anybody asks after "is it listed".
             */
            note: `${l.channelSku}${STATUS_WORD[l.status] ? ` · ${STATUS_WORD[l.status]}` : ''}`,
            dot: l.status === 'paused' || l.status === 'error' ? 'bg-warning' : 'bg-success',
          }))}
        />

        <Section
          label={`Not listed on ${unlisted.length}`}
          empty={channels.length === 0 ? 'No channels connected.' : 'Listed everywhere.'}
          rows={unlisted.map((c) => ({ key: c.id, name: c.name, note: '', dot: 'bg-n-300' }))}
        />
      </div>
    ), { duration: 8000 });
  };

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); show(); }}
      className={`tag whitespace-nowrap ${isListed
        ? 'border border-success-bd bg-success-bg text-success hover:brightness-95'
        : 'border border-danger-bd bg-danger-bg text-danger hover:brightness-95'}`}
      title={isListed ? 'Click to see which channels' : 'Click to see the channels it could go to'}
    >
      {isListed ? 'Listed' : 'Not Listed'}
    </button>
  );
}

function Section({ label, empty, rows }: {
  label: string;
  empty: string;
  rows: { key: string; name: string; note: string; dot: string }[];
}) {
  return (
    <div className="mt-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-n-500">{label}</div>
      {rows.length === 0 ? (
        <div className="text-[12px] text-n-400">{empty}</div>
      ) : (
        <ul className="flex max-h-[168px] flex-col gap-0.5 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.key} className="flex items-baseline gap-2 text-[12.5px]">
              <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${r.dot}`} />
              <span className="truncate text-n-700">{r.name}</span>
              {r.note && <span className="code ml-auto shrink-0 text-[11px] text-n-500">{r.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
