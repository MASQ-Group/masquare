import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { ebayListingApi } from '../../lib/api';
import { EbayCategoryPicker } from './EbayCategoryPicker';

/**
 * Creating the eBay listing for one product.
 *
 * ONE panel, not a row per marketplace, and that is the whole shape of it: eBaymag republishes an
 * eBay UK listing to every other eBay marketplace, so a product needs one category, one set of
 * aspects and one publish. Repeating this per market would be asking the same question fourteen
 * times and sending fourteen listings where eBaymag wants one.
 *
 * The order is the order the work happens in — what is missing, then the category, then what that
 * category demands, then the publish. Publishing is the only step a buyer can see, so it sits last
 * and behind its own confirmation.
 */
export function EbayListingPanel({ productId }: { productId: string }) {
  const qc = useQueryClient();
  /** The only state left here: the category and its answers belong to the picker. */
  const [confirming, setConfirming] = useState(false);

  const pre = useQuery({ queryKey: ['ebay', 'prerequisites'], queryFn: () => ebayListingApi.prerequisites() });
  const preview = useQuery({
    queryKey: ['ebay', 'preview', productId],
    queryFn: () => ebayListingApi.preview(productId),
  });

  const publish = useMutation({
    mutationFn: () => ebayListingApi.publish(productId, {}),
    onSuccess: (r) => {
      setConfirming(false);
      toast.success(`Listed on eBay — listing ${r.listingId ?? r.offerId ?? ''}`);
      qc.invalidateQueries({ queryKey: ['ebay', 'preview', productId] });
      qc.invalidateQueries({ queryKey: ['listing', 'product-channels', productId] });
    },
    onError: (e: any) => {
      setConfirming(false);
      toast.error(e?.response?.data?.message ?? 'eBay refused the listing');
    },
  });

  /**
   * `preview.missing` is now the whole answer — the server folds the category's required item
   * specifics into it, so the gate cannot read READY on a listing eBay would refuse. It used to be
   * assembled here from two half-answers, and the aspect half only existed while a category was
   * selected on screen.
   */
  const missing = preview.data?.missing ?? [];
  const blockers = pre.data?.blockers ?? [];
  const canPublish = missing.length === 0 && blockers.length === 0 && (pre.data?.liveWritesEnabled ?? false);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-n-200 bg-n-25 p-3.5">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-n-800">Create the eBay listing</span>
        <span className="tag border border-n-200 bg-n-100 text-n-600">eBay UK</span>
        <span className="text-[11.5px] text-n-500">eBaymag republishes it to the other eBay markets</span>
      </div>

      {/* ── the account, once, because it is the same for every product ── */}
      {pre.isLoading && <Line icon="wait">Checking the eBay account…</Line>}
      {pre.data && blockers.length === 0 && (
        <Line icon="ok">
          Account ready — {pre.data.locations.length} location, {pre.data.fulfillmentPolicies.length} postage,{' '}
          {pre.data.paymentPolicies.length} payment, {pre.data.returnPolicies.length} returns policies
        </Line>
      )}
      {blockers.map((b) => <Line key={b} icon="bad">{b}</Line>)}
      {pre.data && !pre.data.liveWritesEnabled && (
        <Line icon="bad">Creating real listings is switched off in Settings → General.</Line>
      )}

      {/* ── what this product still lacks ── */}
      {preview.isLoading && <Line icon="wait">Checking the product…</Line>}
      {preview.data && missing.length === 0 && <Line icon="ok">Product has everything eBay needs.</Line>}
      {missing.length > 0 && (
        <div className="rounded-lg border border-warning-bd bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
          <b>Still needed:</b> {missing.map((m) => m.label).join(', ')}
          <div className="mt-0.5 text-[11.5px] opacity-80">
            Title, description and images are on the Content tab, beside the category.
          </div>
        </div>
      )}

      {/*
        * The same picker the Content tab uses. Filling it in there is the intended path — a category
        * and its item specifics are product copy — but somebody who gets here and finds one missing
        * should not be sent away to another tab to fix it.
        */}
      <EbayCategoryPicker productId={productId} compact />

      {/* ── the only step a buyer can see ── */}
      <div className="flex items-center gap-2 border-t border-n-200 pt-3">
        {!confirming ? (
          <button
            className="btn btn-primary !h-8 !text-[12.5px] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canPublish || publish.isPending}
            onClick={() => setConfirming(true)}
            title={canPublish ? 'Creates a live, publicly buyable listing' : 'Something above is still missing'}
          >
            <Send size={13} /> Publish to eBay UK
          </button>
        ) : (
          <>
            <span className="text-[12.5px] text-n-700">This creates a live listing buyers can purchase.</span>
            <button className="btn btn-primary !h-8 !text-[12.5px] disabled:cursor-not-allowed disabled:opacity-50" onClick={() => publish.mutate()} disabled={publish.isPending}>
              {publish.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Yes, publish
            </button>
            <button className="hbtn" onClick={() => setConfirming(false)}>Cancel</button>
          </>
        )}
        {!canPublish && (
          <span className="text-[11.5px] text-n-500">
            {missing.map((m) => m.label).slice(0, 4).join(', ') || 'Account not ready'}
          </span>
        )}
      </div>
    </div>
  );
}


function Line({ icon, children }: { icon: 'ok' | 'bad' | 'wait'; children: React.ReactNode }) {
  const Icon = icon === 'ok' ? Check : icon === 'bad' ? AlertTriangle : Loader2;
  const tone = icon === 'ok' ? 'text-success' : icon === 'bad' ? 'text-danger' : 'text-n-500';
  return (
    <div className={`flex items-start gap-2 text-[12.5px] ${tone}`}>
      <Icon size={13} className={`mt-0.5 shrink-0 ${icon === 'wait' ? 'animate-spin' : ''}`} />
      <span>{children}</span>
    </div>
  );
}
