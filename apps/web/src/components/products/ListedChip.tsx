import { useEffect, useRef } from 'react';
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

/**
 * One id for every chip on the page, so sonner REPLACES rather than stacks.
 *
 * Without it each click opened another panel and they piled up on top of each other — two products'
 * channel lists visible at once, neither labelled clearly enough to tell which was which. A shared
 * id makes "only one open" a property of the toast rather than something the handlers have to
 * remember to enforce.
 */
const TOAST_ID = 'product-listed-channels';

/** Marks the chips, so the outside-click handler can tell "somewhere else" from "another chip". */
const CHIP_ATTR = 'data-listed-chip';

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

  const byId = new Map(channels.map((c) => [c.id, c]));
  const listedChannels = listed
    .map((l) => ({ ...l, channel: byId.get(l.channelId) }))
    .sort((a, b) => (a.channel?.name ?? a.channelId).localeCompare(b.channel?.name ?? b.channelId));
  const listedIds = new Set(listed.map((l) => l.channelId));
  const unlisted = channels.filter((c) => !listedIds.has(c.id));

  const show = () => {
    toast.custom(
      () => (
        <ListedPanel
          product={product}
          listed={listedChannels}
          unlisted={unlisted}
          channelCount={channels.length}
        />
      ),
      {
        id: TOAST_ID,
        /**
         * It closes on the × , on Escape, or on a click anywhere else — never on a timer. A panel
         * somebody is reading down a list of nineteen marketplaces must not vanish mid-scroll.
         */
        duration: Infinity,
      },
    );
  };

  return (
    <button
      type="button"
      {...{ [CHIP_ATTR]: '' }}
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

type ListedRow = { channelId: string; status: string; channelSku: string; channel?: ChannelListingChannel };

function ListedPanel({ product, listed, unlisted, channelCount }: {
  product: Product;
  listed: ListedRow[];
  unlisted: ChannelListingChannel[];
  channelCount: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (ref.current?.contains(target as Node)) return;      // inside: scrolling, closing, reading
      /**
       * Another chip closes nothing. It reuses TOAST_ID, so sonner swaps the contents in place —
       * dismissing here first would race that re-open and sometimes leave no panel at all.
       */
      if (target?.closest?.(`[${CHIP_ATTR}]`)) return;
      toast.dismiss(TOAST_ID);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') toast.dismiss(TOAST_ID); };

    /**
     * Listening from the NEXT tick, not this one. The click that opened this panel is still
     * travelling up the document, and a handler attached synchronously catches it — the panel
     * would open and shut inside one click, which reads as the chip simply not working.
     */
    const t = window.setTimeout(() => document.addEventListener('mousedown', onPointerDown), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div ref={ref} className="w-[360px] rounded-lg border border-n-200 bg-n-0 p-3 shadow-lg">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="code text-[13px] font-semibold text-n-800">{product.mainSku}</div>
          <div className="truncate text-[12px] text-n-500" title={product.title}>{product.title}</div>
        </div>
        <button
          type="button"
          className="shrink-0 rounded px-1.5 text-[16px] leading-none text-n-400 hover:text-n-700"
          onClick={() => toast.dismiss(TOAST_ID)}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <Section
        label={`Listed on ${listed.length}`}
        empty="Not listed on any channel."
        rows={listed.map((l) => ({
          key: l.channelId,
          name: l.channel?.name ?? l.channelId,
          /**
           * The SKU is shown because it is frequently NOT the main one, and "which alias is live on
           * Amazon DE" is the next question anybody asks after "is it listed".
           */
          note: `${l.channelSku}${STATUS_WORD[l.status] ? ` · ${STATUS_WORD[l.status]}` : ''}`,
          dot: l.status === 'paused' || l.status === 'error' ? 'bg-warning' : 'bg-success',
        }))}
      />

      <Section
        label={`Not listed on ${unlisted.length}`}
        empty={channelCount === 0 ? 'No channels connected.' : 'Listed everywhere.'}
        rows={unlisted.map((c) => ({ key: c.id, name: c.name, note: '', dot: 'bg-n-300' }))}
      />
    </div>
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
