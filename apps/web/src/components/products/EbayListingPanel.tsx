import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, Search, Send } from 'lucide-react';
import { toast } from 'sonner';
import { ebayListingApi, type EbayCategorySuggestion, type EbayResolvedAspect } from '../../lib/api';

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
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<EbayCategorySuggestion | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);

  const pre = useQuery({ queryKey: ['ebay', 'prerequisites'], queryFn: () => ebayListingApi.prerequisites() });
  const preview = useQuery({
    queryKey: ['ebay', 'preview', productId],
    queryFn: () => ebayListingApi.preview(productId),
  });

  const suggest = useMutation({
    mutationFn: () => ebayListingApi.categorySuggestions(productId, query || undefined),
    onError: () => toast.error('Could not ask eBay for categories'),
  });

  const aspects = useQuery({
    queryKey: ['ebay', 'aspects', productId, chosen?.categoryId],
    queryFn: () => ebayListingApi.categoryAspects(productId, chosen!.categoryId),
    enabled: !!chosen,
  });

  const save = useMutation({
    mutationFn: () => ebayListingApi.savePlan(productId, {
      categoryId: chosen!.categoryId,
      categoryName: chosen!.categoryName,
      /** Only what a person typed. Everything auto-filled is re-derived, never frozen into the plan. */
      aspects: Object.fromEntries(Object.entries(edits).filter(([, v]) => v.trim())),
    }),
    onSuccess: () => {
      toast.success('Category saved for this product');
      qc.invalidateQueries({ queryKey: ['ebay', 'preview', productId] });
      qc.invalidateQueries({ queryKey: ['ebay', 'aspects', productId] });
    },
    onError: () => toast.error('Could not save the category'),
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

  const missing = preview.data?.missing ?? [];
  const missingAspects = aspects.data?.missing ?? [];
  const blockers = pre.data?.blockers ?? [];
  /** Everything that must be true, in one place, so the button cannot be the thing that explains it. */
  const canPublish = missing.length === 0 && missingAspects.length === 0 && blockers.length === 0
    && (pre.data?.liveWritesEnabled ?? false);

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
            Title, description and images are on the Content tab. Category is below.
          </div>
        </div>
      )}

      {/* ── the category, which nothing can infer ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            className="input h-8 flex-1 text-[13px]"
            placeholder="Search eBay categories — defaults to the product title"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') suggest.mutate(); }}
          />
          <button className="hbtn shrink-0" onClick={() => suggest.mutate()} disabled={suggest.isPending}>
            {suggest.isPending ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Suggest
          </button>
        </div>

        {suggest.data && !suggest.data.ok && <Line icon="bad">{suggest.data.message ?? 'eBay returned nothing'}</Line>}
        {suggest.data?.ok && suggest.data.suggestions.length === 0 && (
          <Line icon="bad">eBay had no suggestion for “{suggest.data.searchedFor}”. Try different words.</Line>
        )}
        {suggest.data?.suggestions.map((s) => (
          <button
            key={s.categoryId}
            onClick={() => { setChosen(s); setEdits({}); }}
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-[12.5px] ${
              chosen?.categoryId === s.categoryId ? 'border-teal-300 bg-teal-50' : 'border-n-200 bg-n-0 hover:bg-n-50'}`}
          >
            <span className="mt-[3px] shrink-0">{chosen?.categoryId === s.categoryId ? <Check size={13} className="text-teal-600" /> : <span className="block h-3 w-3 rounded-full border border-n-300" />}</span>
            <span>
              <span className="font-medium text-n-800">{s.categoryName}</span>
              <span className="mono ml-2 text-[11px] text-n-400">{s.categoryId}</span>
              <span className="block text-[11.5px] text-n-500">{s.path}</span>
            </span>
          </button>
        ))}
      </div>

      {/* ── what that category demands ── */}
      {chosen && aspects.isLoading && <Line icon="wait">Asking eBay what this category needs…</Line>}
      {aspects.data && (
        <div className="flex flex-col gap-2 rounded-lg border border-n-200 bg-n-0 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-n-500">
            {chosen?.categoryName} — {aspects.data.aspects.filter((a) => a.required).length} required
            {aspects.data.isSaved && <span className="ml-2 text-teal-700">saved</span>}
          </div>
          {aspects.data.aspects.filter((a) => a.required).map((a) => (
            <AspectField key={a.name} aspect={a} value={edits[a.name]} onChange={(v) => setEdits({ ...edits, [a.name]: v })} />
          ))}
          <button className="hbtn self-start" onClick={() => save.mutate()} disabled={save.isPending || !chosen}>
            {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save category
          </button>
        </div>
      )}

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
            {[...missing.map((m) => m.label), ...missingAspects].slice(0, 4).join(', ') || 'Account not ready'}
          </span>
        )}
      </div>
    </div>
  );
}

function AspectField({ aspect, value, onChange }: {
  aspect: EbayResolvedAspect;
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  /**
   * An auto-filled value is shown as the placeholder rather than as content, so the field reads as
   * answered without pretending somebody typed it — and typing still overrides it.
   */
  const auto = aspect.source && aspect.source !== 'plan' ? aspect.value : null;
  return (
    <label className="flex items-center gap-2">
      <span className="w-40 shrink-0 text-[12.5px] text-n-700">
        {aspect.name}
        {aspect.rejectedBecause && <span className="ml-1 text-[11px] text-danger">not accepted</span>}
      </span>
      {aspect.mode === 'SELECTION_ONLY' && aspect.values.length ? (
        <select
          className="input h-8 flex-1 text-[13px]"
          value={value ?? aspect.value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— choose —</option>
          {aspect.values.map((v) => <option key={v} value={v}>{v}</option>)}
          {aspect.valueCount > aspect.values.length && <option disabled>…{aspect.valueCount - aspect.values.length} more on eBay</option>}
        </select>
      ) : (
        <input
          className="input h-8 flex-1 text-[13px]"
          placeholder={auto ? `${auto}  (from the product)` : 'required'}
          value={value ?? (aspect.source === 'plan' ? aspect.value ?? '' : '')}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
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
