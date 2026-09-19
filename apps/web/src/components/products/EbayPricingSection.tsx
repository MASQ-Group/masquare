import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ebayListingApi, type EbayPricing } from '../../lib/api';

/**
 * What to sell it for, and how long to take posting it.
 *
 * Deliberately the same shape as the Amazon launch price: what others charge, what we should charge,
 * and what the price in the box actually earns — all visible at once, because a margin quoted without
 * the competition beside it is half an answer.
 *
 * Every figure is worked out on the server. The browser sends the price being typed and displays
 * what comes back; it does not know eBay's fee, VAT or the margin formula, so it cannot drift from
 * the numbers the publish will use.
 */
export function EbayPricingSection({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const [price, setPrice] = useState('');
  const [handling, setHandling] = useState('');
  /** Debounced, so typing a price is not one request per keystroke. */
  const [quoteAt, setQuoteAt] = useState<number | null>(null);

  const pricing = useQuery({
    queryKey: ['ebay', 'pricing', productId, quoteAt],
    queryFn: () => ebayListingApi.pricing(productId, quoteAt != null ? { atPriceCents: quoteAt } : {}),
  });

  // Seed the boxes from what is saved, once, without stamping on anything being typed.
  useEffect(() => {
    const d = pricing.data;
    if (!d || price !== '' || handling !== '') return;
    if (d.current) setPrice((d.current.priceCents / 100).toFixed(2));
    if (d.handlingTimeDays != null) setHandling(String(d.handlingTimeDays));
  }, [pricing.data]);

  useEffect(() => {
    const cents = Math.round(Number(price) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return;
    const t = setTimeout(() => setQuoteAt(cents), 400);
    return () => clearTimeout(t);
  }, [price]);

  const save = useMutation({
    mutationFn: () => {
      const d = pricing.data;
      if (!d) throw new Error('not loaded');
      // No categoryId: the category was chosen in eBay content and must not be touched here.
      return ebayListingApi.savePlan(productId, {
        offerPriceCents: Math.round(Number(price) * 100),
        handlingTimeDays: handling.trim() ? Number(handling) : null,
      });
    },
    onSuccess: () => {
      toast.success('Price and handling time saved');
      qc.invalidateQueries({ queryKey: ['ebay'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });

  const d = pricing.data;
  if (pricing.isLoading) {
    return <Wrap><span className="flex items-center gap-1.5 text-[12.5px] text-n-500"><Loader2 size={13} className="animate-spin" /> Working out what this should sell for…</span></Wrap>;
  }
  if (!d) return null;

  const money = (cents: number) => `${(cents / 100).toFixed(2)} ${d.currency}`;
  const shown = d.at ?? d.current;

  return (
    <Wrap>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Price and dispatch</span>
        {d.costCents != null && (
          <span className="text-[11.5px] text-n-400">
            costs {money(d.costCents)}
            {d.costCurrency !== d.currency && <> (converted from {d.costCurrency} at today&apos;s rate)</>}
          </span>
        )}
      </div>

      {/* ── what the market is doing ── */}
      <Competitors pricing={d} />

      {/* ── what we should charge ── */}
      {d.suggestion.ok ? (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="font-semibold text-n-800">Suggested {money(d.suggestion.outcome.priceCents)}</span>
          <span className="text-n-500">for a {d.suggestion.targetMarginPct}% margin</span>
          <button
            type="button"
            className="hbtn"
            onClick={() => setPrice((d.suggestion as { outcome: { priceCents: number } }).outcome.priceCents / 100 + '')}
          >
            Use suggested
          </button>
        </div>
      ) : (
        <div className="flex items-start gap-2 text-[12.5px] text-warning">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{d.suggestion.reason}</span>
        </div>
      )}
      {d.suggestion.ok && d.suggestion.problems?.length ? (
        <div className="flex items-start gap-2 text-[11.5px] text-warning">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>Worked out without: {d.suggestion.problems.join('; ')}.</span>
        </div>
      ) : null}

      {/* ── what we will charge ── */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-n-700">Price ({d.currency})</span>
          <input
            className="input mono h-9 w-32 text-[13px]"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-n-700">Dispatch within (days)</span>
          <input
            className="input mono h-9 w-28 text-[13px]"
            inputMode="numeric"
            value={handling}
            onChange={(e) => setHandling(e.target.value)}
            placeholder="2"
          />
        </label>
        <button
          type="button"
          className="hbtn mb-0.5"
          onClick={() => save.mutate()}
          disabled={save.isPending || !price.trim()}
        >
          {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save
        </button>
      </div>

      {/*
        * The breakdown, because "30% profit" means nothing without what was taken out of it. Worked out
        * on the sales channel's settings, exactly as OnBuy and Change price are, so the same product
        * on two channels set up alike gets the same answer.
        */}
      {shown && (
        <div className="flex flex-col gap-0.5 rounded-md border border-n-200 bg-n-0 px-3 py-2 text-[12px]">
          <div className={shown.profitCents >= 0 ? 'text-n-800' : 'text-danger'}>
            <b>{money(shown.profitCents)}</b> profit · {shown.marginPct}% of the price
            {shown.profitCents < 0 && <span className="ml-1 font-semibold">— a loss on every unit</span>}
          </div>
          <div className="text-n-500">
            {money(shown.priceCents)} − {money(shown.vatCents)} VAT − {money(shown.feesCents)} eBay fees
            − {money(shown.shippingCents)} shipping − {money(shown.costCents)} cost
          </div>
          {/*
            * What it was worked out from. The fee measured from this account's own settled orders is
            * shown beside the channel's fee rather than used: when they disagree, the channel setting is
            * what to correct, because every screen and every booked sale reads it.
            */}
          {d.assumptions.basis && (
            <div className="text-[11px] text-n-400">
              Priced on {d.assumptions.basis.channelName ?? 'the sales channel'}: {d.assumptions.basis.feePct}% fee,{' '}
              {d.assumptions.basis.vatPct}% VAT at the suggested price
              {d.assumptions.basis.shippingServiceName && <>, shipped by {d.assumptions.basis.shippingServiceName}</>}.
              {d.assumptions.measured ? (
                <span className="block">
                  Your last {d.assumptions.measured.sampleSize} settled eBay orders measure eBay&apos;s fee at{' '}
                  {(d.assumptions.measured.feePct * 100).toFixed(1)}% plus {money(d.assumptions.measured.fixedFeeCents)} an order.
                </span>
              ) : d.assumptions.measuredWhyNot ? (
                <span className="block">eBay&apos;s fee not measured from your own orders: {d.assumptions.measuredWhyNot}.</span>
              ) : null}
            </div>
          )}
        </div>
      )}
    </Wrap>
  );
}

/**
 * What other sellers charge — and, as loudly, what was left out.
 *
 * eBay's catalogue does not carry our barcodes, so this is a word search and it returns neighbouring
 * models freely. Only listings carrying the part number count. The rejected ones are kept behind a
 * toggle rather than hidden: seeing that an £89 result was a different model is what stops somebody
 * wondering why the suggestion looks low.
 */
function Competitors({ pricing }: { pricing: EbayPricing }) {
  const [showRejected, setShowRejected] = useState(false);
  const c = pricing.competitors;
  /**
   * An offer's own currency, never the listing's. eBay returns what each seller charges in the
   * currency they charge it in, and labelling a GBP price "EUR" is worse than showing no price.
   */
  const offerMoney = (cents: number | null, currency: string | null) =>
    cents == null ? '—' : `${(cents / 100).toFixed(2)} ${currency ?? ''}`.trim();

  if (!c.available) {
    return (
      <div className="flex items-start gap-2 text-[12px] text-n-500">
        <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warning" />
        <span>Could not check what others charge: {c.message}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 rounded-md border border-n-200 bg-n-0 px-3 py-2">
      {c.summary ? (
        <div className="text-[12.5px] text-n-800">
          <b>{c.matched.length}</b> other {c.matched.length === 1 ? 'seller has' : 'sellers have'} this exact model:{' '}
          {offerMoney(c.summary.lowestCents, c.summary.currency)} – {offerMoney(c.summary.highestCents, c.summary.currency)}
          <span className="text-n-500"> · middle {offerMoney(c.summary.medianCents, c.summary.currency)}</span>
        </div>
      ) : (
        <div className="text-[12.5px] text-n-600">
          Nobody else is listing this exact model new.
          <span className="block text-[11.5px] text-n-400">
            Searched eBay for &ldquo;{c.searchedFor}&rdquo;. Price from your own costs below.
          </span>
        </div>
      )}

      {c.matched.slice(0, 5).map((o, i) => (
        <div key={i} className="flex items-baseline gap-2 text-[11.5px] text-n-600">
          <span className="mono w-20 shrink-0 text-n-800">{offerMoney(o.priceCents, o.currency)}</span>
          <span className="truncate">{o.title}</span>
          {o.url && (
            <a href={o.url} target="_blank" rel="noreferrer" className="shrink-0 text-n-400 hover:text-teal-600">
              <ExternalLink size={11} />
            </a>
          )}
        </div>
      ))}

      {c.rejected.length > 0 && (
        <>
          <button
            type="button"
            className="self-start text-[11.5px] font-semibold text-n-500 hover:text-n-700"
            onClick={() => setShowRejected((v) => !v)}
          >
            {showRejected ? 'Hide' : 'Show'} {c.rejected.length} result{c.rejected.length === 1 ? '' : 's'} not counted
          </button>
          {showRejected && c.rejected.slice(0, 10).map((r, i) => (
            <div key={i} className="text-[11px] text-n-400">
              <span className="mono">{offerMoney(r.offer.priceCents, r.offer.currency)}</span>{' '}
              {r.offer.title} — <span className="italic">{r.why}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2.5 border-t border-n-200 pt-3">{children}</div>;
}
