import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, ClipboardCopy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ebayListingApi } from '../../lib/api';

/**
 * Step two: hand the research to Claude.
 *
 * This replaced a button that paid per product to search the web. Claude does the same job through
 * the maSquare connector on a plan the business already has, so the platform's part is now to say
 * what to ask for and to show what came back — the work happens in a Claude conversation.
 *
 * The prompt is generated rather than typed, because the SKU has to be exact and the rules live on
 * the connector. Copying it is the whole interaction.
 */
export function EbayResearchStep({ productId, sku, ready, refusal }: {
  productId: string;
  sku: string;
  /** Whether the connector would accept research for this product. */
  ready: boolean;
  refusal: string | null;
}) {
  const [copied, setCopied] = useState(false);

  /**
   * What the research has actually produced, read back from the saved plan. The same query key the
   * category picker uses, so confirming a value there updates this without a refetch.
   */
  const saved = useQuery({
    queryKey: ['ebay', 'saved-plan', productId],
    queryFn: () => ebayListingApi.preview(productId).then((p) => p).catch(() => null),
  });

  const prompt = `Research eBay item specifics and write the description for maSquare product ${sku}.`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // A blocked clipboard is not worth an error dialog — the text is on screen to select by hand.
      toast('Copy blocked by the browser — select the text instead.');
    }
  };

  const missing = saved.data?.missing?.filter((m) => m.key.startsWith('aspect:')) ?? [];

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[12.5px] text-n-500">
        Claude searches the web and fills these fields in through the maSquare connector, using your
        own Claude plan. It reports what each page said; maSquare decides what may be used.
      </p>

      {!ready && refusal && (
        <div className="flex items-start gap-2 rounded-lg border border-warning-bd bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{refusal}</span>
        </div>
      )}

      <div className="flex flex-col gap-1.5 rounded-lg border border-n-200 bg-n-25 p-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Ask Claude this</span>
        <code className="mono block rounded-md border border-n-200 bg-n-0 px-2.5 py-2 text-[12.5px] text-n-800">
          {prompt}
        </code>
        <button type="button" className="hbtn mt-0.5 self-start" onClick={copy} disabled={!ready}>
          {copied ? <Check size={13} className="text-success" /> : <ClipboardCopy size={13} />}
          {copied ? 'Copied' : 'Copy prompt'}
        </button>
        <p className="text-[11.5px] text-n-400">
          Paste it into Claude with the maSquare connector switched on. Claude gets the rules from the
          connector — what it may report, and that it must cite the page every value came from.
        </p>
      </div>

      {/*
        * What came back, read from the saved plan rather than from the conversation. A person may
        * have run the research days ago, or in another window; this is the state of the product.
        */}
      <div className="flex items-start gap-2 text-[12.5px]">
        {saved.isLoading ? (
          <span className="flex items-center gap-1.5 text-n-500">
            <Loader2 size={13} className="animate-spin" /> Checking what is filled in…
          </span>
        ) : missing.length === 0 ? (
          <span className="flex items-center gap-1.5 text-success">
            <Check size={13} /> Every required item specific is answered.
          </span>
        ) : (
          <span className="text-n-600">
            Still missing: <span className="text-n-800">{missing.map((m) => m.label).join(', ')}</span>
            <span className="block text-[11.5px] text-n-400">
              Anything Claude found from a single source waits under its field above for you to confirm.
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
