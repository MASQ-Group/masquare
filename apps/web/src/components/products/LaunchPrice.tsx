import { useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Ban, Calculator, TrendingUp, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { amazonListingApi, type AmazonQuote } from '../../lib/api';

const money = (cents: number, currency: string) => {
  const symbol: Record<string, string> = { EUR: '€', GBP: '£', USD: '$', CAD: 'CA$', AUD: 'A$', JPY: '¥', SEK: 'kr', PLN: 'zł', AED: 'AED ', SAR: 'SAR ', MXN: 'MX$', TRY: '₺', INR: '₹', BRL: 'R$', ZAR: 'R', SGD: 'S$' };
  return `${symbol[currency] ?? `${currency} `}${(cents / 100).toFixed(currency === 'JPY' ? 0 : 2)}`;
};

/**
 * What this offer should launch at, and what the price in the box actually earns.
 *
 * Both figures come from the repricing floor engine, so the profit quoted here is the same profit
 * the floors, Individual Pricing and a booked sale compute. A second calculation would be a second
 * answer to the same question.
 *
 * The suggestion is a launch margin, deliberately not the floor: the repricer is in shadow mode, so
 * nothing would raise a price launched at its minimum.
 */
export function LaunchPrice({
  productId, integrationId, price, onPriceChange,
}: {
  productId: string;
  integrationId: string;
  /** The value in the plan's price box, as typed. */
  price: string;
  onPriceChange: (value: string) => void;
}) {
  const quote = useMutation({
    mutationFn: (atPriceCents?: number | null) => amazonListingApi.quote(productId, integrationId, atPriceCents),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not price this listing'),
  });

  // Fetch the suggestion once, so opening a row shows what it ought to sell for without a click.
  useEffect(() => {
    quote.mutate(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, integrationId]);

  const q = quote.data;
  const typedCents = price.trim() === '' ? null : Math.round(Number(price.replace(',', '.')) * 100);

  if (quote.isPending && !q) {
    return <div className="rounded-md border border-n-200 bg-n-0 px-3 py-2 text-[12px] text-n-500">Working out what this should sell for…</div>;
  }
  if (!q) return null;

  if (!q.ok) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
        <Ban size={13} className="mt-0.5 shrink-0 text-amber-600" />
        <span>{q.reason}</span>
      </div>
    );
  }

  // Below breakeven is a loss on every unit, so it is called that rather than "low margin".
  const belowBreakeven = typedCents != null && typedCents <= q.breakevenCents;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-n-200 bg-n-0 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        <span className="font-semibold text-n-800">Suggested {money(q.suggestedCents, q.currency)}</span>
        <span className="text-n-500">at {q.marginPct}% profit</span>
        <span className="text-n-400">breakeven {money(q.breakevenCents, q.currency)}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => onPriceChange((q.suggestedCents / 100).toFixed(2))}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12px] font-semibold text-n-700 hover:border-teal-300 hover:text-teal-700"
        >
          <Wand2 size={13} /> Use suggested
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => quote.mutate(typedCents)}
          disabled={quote.isPending || typedCents == null}
          title={typedCents == null ? 'Enter a price first' : undefined}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12px] font-semibold text-n-700 hover:border-n-300 disabled:opacity-50"
        >
          <Calculator size={13} /> {quote.isPending ? 'Recalculating…' : 'Recalculate profit'}
        </button>

        {/* Only shown for the price that was actually evaluated — a figure that lags the box by an
            edit is worse than no figure, because it looks current. */}
        {q.at && typedCents === q.at.priceCents && (
          <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold ${q.at.aboveBreakeven ? 'text-teal-700' : 'text-danger'}`}>
            <TrendingUp size={13} />
            {money(q.at.profitCents, q.currency)} profit · {q.at.marginPct}%
          </span>
        )}
        {q.at && typedCents !== q.at.priceCents && (
          <span className="text-[11.5px] text-n-400">Price changed since the last calculation.</span>
        )}
      </div>

      {belowBreakeven && (
        <div className="flex items-start gap-1.5 rounded-md border border-danger-bd bg-danger-bg px-2.5 py-1.5 text-[12px] text-danger">
          <Ban size={12} className="mt-0.5 shrink-0" />
          <span>At or below breakeven ({money(q.breakevenCents, q.currency)}) — every sale would lose money.</span>
        </div>
      )}

      <details className="text-[11.5px] text-n-500">
        <summary className="cursor-pointer hover:text-n-700">What this is built on</summary>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
          <span>Landed cost {money(q.inputs.cogsLandedCents, q.currency)}</span>
          {q.inputs.fixedPerUnitCents > 0 && <span>Shipping {money(q.inputs.fixedPerUnitCents, q.currency)}</span>}
          {q.inputs.fbaFulfillmentFeeCents > 0 && <span>FBA fee {money(q.inputs.fbaFulfillmentFeeCents, q.currency)}</span>}
          {q.inputs.closingFeeCents > 0 && <span>Closing fee {money(q.inputs.closingFeeCents, q.currency)}</span>}
          <span>VAT {q.inputs.vatRatePct}%</span>
          <span>Returns {q.inputs.returnsRatePct}%</span>
        </div>
      </details>
    </div>
  );
}
