import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { EbayCategoryPicker } from './EbayCategoryPicker';
import { EbayResearchStep } from './EbayResearchStep';
import { EbayDescriptionPreview } from './EbayDescriptionPreview';
import { RichTextEditor } from '../common/RichTextEditor';
import { FeatureList } from './FeatureList';
import { ebayListingApi } from '../../lib/api';

/**
 * Everything eBay needs that the other channels do not.
 *
 * Separate from Content because the two answer different questions. Content is what the product IS
 * — prose a buyer reads, the same words wherever it is sold. This is what eBay specifically demands:
 * a title in its 80-character shape, a category from its own tree, and the item specifics that
 * category makes compulsory.
 *
 * The order is the order the work happens in, and it cannot be reordered. The category is first
 * because eBay decides which item specifics exist FROM it — nothing below is even knowable until one
 * is chosen. The research is second because it fills that list. The title is last because it is an
 * OUTPUT: it is built from the brand, model and the handful of attributes buyers search on, and a
 * title written before any of that is known is a guess that then has to be rewritten. That is why
 * this is a sequence rather than a form.
 *
 * One listing, not fourteen. eBaymag republishes an eBay UK listing to every other eBay market, so
 * a product needs one category and one set of specifics, never one per marketplace.
 */
export function EbayContentTab({
  productId, ebayTitle, onEbayTitleChange, productTitle, manufacturerSku, ean, upc, manufacturerUrls,
  descriptionHtml, onDescriptionChange, features, onFeaturesChange, sku,
}: {
  productId: string;
  ebayTitle: string;
  onEbayTitleChange: (v: string) => void;
  /** Falls back as the category search text when no eBay title has been written yet. */
  productTitle: string;
  /**
   * Read here only to say, before anybody presses the button, that the gather will refuse. The
   * server applies the same rule regardless — this is the courtesy, not the enforcement.
   */
  manufacturerSku: string;
  ean: string;
  upc: string;
  /** Already recorded against the product; the gather step shows and reuses them. */
  manufacturerUrls: string[];
  /** Shown in the prompt Claude is given, so the SKU it researches is exact. */
  sku: string;
  /**
   * The listing description. Shared with the Content tab rather than duplicated — it is the same
   * prose a buyer reads wherever the product is sold, and two copies would drift apart with nobody
   * able to say which one eBay actually got. Shown here so the whole eBay listing can be read in
   * one place instead of sending somebody back a tab to check what it says.
   */
  descriptionHtml: string;
  onDescriptionChange: (v: string) => void;
  /** The key features — written by research, shown in the eBay description's feature list. */
  features: string[];
  onFeaturesChange: (next: string[]) => void;
}) {
  const missing = [
    ...(manufacturerSku.trim() ? [] : ['manufacturer SKU']),
    ...(ean.trim() || upc.trim() ? [] : ['EAN or UPC']),
  ];
  /**
   * Only to tick step 1. Same query key the picker uses, so this shares its single request rather
   * than asking again.
   */
  const saved = useQuery({
    queryKey: ['ebay', 'saved-plan', productId],
    queryFn: () => ebayListingApi.preview(productId).then((p) => p).catch(() => null),
  });
  const hasCategory = !!saved.data && !saved.data.missing.some((m) => m.key === 'categoryId');
  /** Judged on words, not markup: an editor opened and closed leaves `<p></p>`, which is not a description. */
  const descriptionText = descriptionHtml.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim();

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[12.5px] text-n-500">
        What eBay needs beyond the shared copy on the Content tab. Nothing here is sent to eBay —
        listing happens from the Channels tab, once this is complete.
      </p>

      <Step n={1} title="eBay category" done={hasCategory}>
        <p className="mb-2 text-[12px] text-n-400">
          First, because eBay decides which item specifics are compulsory from the category — the
          fields below do not exist until one is chosen. Searching asks eBay; choosing stores nothing
          until you save.
        </p>
        <EbayCategoryPicker
          productId={productId}
          defaultQuery={ebayTitle || productTitle || undefined}
          compact
        />
      </Step>

      <Step n={2} title="Research with Claude" done={false}>
        <EbayResearchStep
          productId={productId}
          sku={sku}
          ready={missing.length === 0}
          refusal={missing.length === 0 ? null
            : `This product has no ${missing.join(' and no ')}. Claude will refuse to research it: without one, a search finds products that look like this one rather than this one. Fill it in on Identifiers first.`}
        />
      </Step>

      <Step n={3} title="Description" done={!!descriptionText}>
        <DescriptionStep
          productId={productId}
          descriptionHtml={descriptionHtml}
          hasText={!!descriptionText}
          onDescriptionChange={onDescriptionChange}
          features={features}
          onFeaturesChange={onFeaturesChange}
        />
      </Step>

      <Step n={4} title="eBay title" done={!!ebayTitle.trim()}>
        <p className="mb-2 text-[12px] text-n-400">
          Last, because the title is built out of what the gather found — the brand, the model and
          the two or three attributes buyers actually search on. Written before that, it is a guess
          that has to be rewritten once the facts arrive. Editable either way.
        </p>
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

/**
 * The description, written and previewed in ONE place.
 *
 * The finished eBay description used to sit in a separate block below the editor, and when the text
 * was empty it showed the specification table alone — which read as "the description was published
 * somewhere else, and it is only a table". Now the step has one body with two views of the same
 * thing: the words you edit, and the page a buyer will see built from them.
 */
function DescriptionStep({ productId, descriptionHtml, hasText, onDescriptionChange, features, onFeaturesChange }: {
  productId: string;
  descriptionHtml: string;
  hasText: boolean;
  onDescriptionChange: (v: string) => void;
  features: string[];
  onFeaturesChange: (next: string[]) => void;
}) {
  const [view, setView] = useState<'write' | 'preview'>('write');

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] text-n-400">
        What eBay shows in the listing body: these paragraphs and key features, then the specification
        table from the saved item specifics, in one house design. Claude writes them during research;
        edit them freely. It is the same description as the Content tab.
      </p>

      <div role="tablist" aria-label="Description view" className="flex self-start rounded-lg border border-n-200 bg-n-25 p-0.5 text-[12px] font-semibold">
        {([['write', 'Text'], ['preview', 'As buyers see it on eBay']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            onClick={() => setView(key)}
            className={`rounded-md px-3 py-1 ${view === key ? 'bg-n-0 text-n-800 shadow-sm' : 'text-n-500 hover:text-n-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {!hasText && (
        <p className="rounded-lg border border-n-200 bg-n-25 px-3 py-2 text-[12px] text-warning">
          No description text yet, so the eBay description would be the specification table alone. Have
          Claude write it (research step), or write two or three short paragraphs here.
        </p>
      )}

      {view === 'write' ? (
        <>
          <RichTextEditor
            minHeight={160}
            value={descriptionHtml}
            onChange={onDescriptionChange}
            placeholder="What the product is, what it does, who it suits."
          />
          <div className="mt-1">
            <span className="mb-1 block text-[12px] font-semibold text-n-700">Key features</span>
            <FeatureList value={features} onChange={onFeaturesChange} />
          </div>
          <p className="text-[12px] text-n-400">Plain prose — no formatting needed. maSquare lays it out.</p>
        </>
      ) : (
        <EbayDescriptionPreview productId={productId} />
      )}
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
