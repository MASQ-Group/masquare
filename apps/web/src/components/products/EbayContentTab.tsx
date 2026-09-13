import { ExternalLink } from 'lucide-react';
import { EbayCategoryPicker } from './EbayCategoryPicker';

/**
 * Everything eBay needs that the other channels do not.
 *
 * Separate from Content because the two answer different questions. Content is what the product IS
 * — prose a buyer reads, the same words wherever it is sold. This is what eBay specifically demands:
 * a title in its 80-character shape, a category from its own tree, and the item specifics that
 * category makes compulsory.
 *
 * The order is the order the work happens in, and it cannot be reordered: eBay decides which item
 * specifics exist FROM the category, so nothing below step 2 can be filled in — or even listed —
 * until a category is chosen. That is why this is a sequence rather than a form.
 *
 * One listing, not fourteen. eBaymag republishes an eBay UK listing to every other eBay market, so
 * a product needs one category and one set of specifics, never one per marketplace.
 */
export function EbayContentTab({
  productId, ebayTitle, onEbayTitleChange, productTitle,
}: {
  productId: string;
  ebayTitle: string;
  onEbayTitleChange: (v: string) => void;
  /** Falls back as the category search text when no eBay title has been written yet. */
  productTitle: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[12.5px] text-n-500">
        What eBay needs beyond the shared copy on the Content tab. Nothing here is sent to eBay —
        listing happens from the Channels tab, once this is complete.
      </p>

      <Step n={1} title="eBay title" done={!!ebayTitle.trim()}>
        <input
          className="input"
          maxLength={80}
          value={ebayTitle}
          onChange={(e) => onEbayTitleChange(e.target.value)}
          placeholder="Keyword-front-loaded, English, minimal punctuation"
        />
        {/* eBay refuses anything longer, so the limit is shown rather than discovered on submit. */}
        <p className="mt-1 text-[12px] text-n-400">
          {ebayTitle.length}/80 characters — eBay refuses more. Put the words a buyer would search
          first; the brand and model earn their place, filler words do not.
        </p>
      </Step>

      <Step n={2} title="eBay category" done={false}>
        <p className="mb-2 text-[12px] text-n-400">
          eBay decides which item specifics are compulsory from the category, so this comes before
          them — the fields below do not exist until one is chosen. Searching asks eBay; choosing
          stores nothing until you save.
        </p>
        <EbayCategoryPicker
          productId={productId}
          defaultQuery={ebayTitle || productTitle || undefined}
          compact
        />
      </Step>

      <Step n={3} title="Gather the item specifics" done={false} muted>
        <p className="text-[12.5px] text-n-500">
          Not built yet. This will search the manufacturer's own datasheet first, then Amazon and
          eBay, and fill only what it can identify as valid — leaving anything it cannot find empty
          rather than guessing at it.
        </p>
        <p className="mt-1.5 text-[12px] text-n-400">
          It will refuse to run without a manufacturer SKU or an EAN/UPC: without one there is
          nothing to search on precisely enough, and a near-match is how a specification from a
          different variant ends up on your listing.
        </p>
      </Step>

      <div className="flex items-start gap-2 rounded-lg border border-n-200 bg-n-25 px-3.5 py-2.5 text-[12.5px] text-n-600">
        <ExternalLink size={14} className="mt-0.5 shrink-0 text-n-400" />
        <span>
          Once this is complete, the <b>Channels</b> tab needs only a price and a handling time —
          everything else it publishes comes from here.
        </span>
      </div>
    </div>
  );
}

function Step({ n, title, children, done, muted }: {
  n: number;
  title: string;
  children: React.ReactNode;
  done: boolean;
  /** For a step that exists but cannot be done yet — visibly present, visibly not ready. */
  muted?: boolean;
}) {
  return (
    <div className={muted ? 'opacity-70' : undefined}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
          done ? 'bg-teal-500 text-white' : 'border border-n-300 bg-n-0 text-n-500'}`}
        >
          {n}
        </span>
        <span className="text-[13px] font-semibold text-n-800">{title}</span>
      </div>
      <div className="pl-7">{children}</div>
    </div>
  );
}
