import { useMutation } from '@tanstack/react-query';
import { Ban, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { toast } from 'sonner';
import { amazonListingApi } from '../../lib/api';
import { eurAside } from '../../lib/format';

const SYMBOL: Record<string, string> = { EUR: '€', GBP: '£', USD: '$', CAD: 'CA$', AUD: 'A$', JPY: '¥', SEK: 'kr', PLN: 'zł', AED: 'AED ', SAR: 'SAR ', MXN: 'MX$', TRY: '₺', INR: '₹', BRL: 'R$', ZAR: 'R', SGD: 'S$' };
const money = (cents: number, currency: string) =>
  `${SYMBOL[currency] ?? `${currency} `}${(cents / 100).toFixed(currency === 'JPY' ? 0 : 2)}`;

/**
 * What everyone else is charging, and what each of those prices would earn us.
 *
 * Amazon shows a seller these same three prices with a Match button beside each. The prices are
 * useful; the button is the dangerous part, because none of those numbers know our costs. So this
 * shows the prices and no Match — the profit chip is the answer to "should I go there", and it is
 * computed by the same engine as every other profit figure in the platform.
 */
export function CompetitorPrices({ productId, integrationId }: { productId: string; integrationId: string }) {
  const load = useMutation({
    mutationFn: () => amazonListingApi.competition(productId, integrationId),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not read the competition'),
  });

  const c = load.data;

  return (
    <div className="rounded-md border border-n-200 bg-n-0 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Users size={14} className="text-n-500" />
        <span className="text-[12.5px] font-semibold text-n-800">What others charge</span>
        {c?.ok && c.offerCount != null && (
          <span className="text-[11.5px] text-n-500">{c.offerCount} offer{c.offerCount === 1 ? '' : 's'} on this listing</span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => load.mutate()}
          disabled={load.isPending}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12px] font-semibold text-n-700 hover:border-n-300 disabled:opacity-50"
        >
          {load.isPending ? 'Asking Amazon…' : c ? 'Refresh' : 'Check the competition'}
        </button>
      </div>

      {!c && !load.isPending && (
        <p className="mt-1.5 text-[11.5px] text-n-400">
          Amazon's featured, competitive and lowest prices for this listing, each with what it would make or lose
          us. Read-only — nothing is matched or changed.
        </p>
      )}

      {c && !c.ok && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-900">
          <Ban size={12} className="mt-0.5 shrink-0 text-amber-600" />
          <span>{c.reason}</span>
        </div>
      )}

      {c?.ok && (
        <div className="mt-2 flex flex-col gap-1">
          {c.prices.map((p) => {
            // Signed the way the chip is: the minus belongs to the figure, not inside the amount.
            const profitEur = eurAside(p.profitEurCents == null ? null : Math.abs(p.profitEurCents), c.currency);
            return (
            <div key={p.kind} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-n-100 py-1.5 first:border-t-0">
              <span className="w-[124px] shrink-0 text-[12px] text-n-600">{p.label}</span>

              {p.priceCents == null ? (
                <span className="text-[12px] text-n-400">Amazon has none for this listing</span>
              ) : (
                <>
                  <span className="mono w-[86px] shrink-0 text-right text-[12.5px] font-semibold tabular-nums text-n-800">
                    {money(p.priceCents, c.currency)}
                  </span>

                  {/* The whole point of the panel: what going there would actually do to us. */}
                  {p.profitCents != null && (
                    <span
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11.5px] font-semibold tabular-nums ${
                        p.aboveBreakeven
                          ? 'border-green-300 bg-green-50 text-green-700'
                          : 'border-danger-bd bg-danger-bg text-danger'
                      }`}
                      title={p.aboveBreakeven ? 'Profit at this price' : 'Loss on every unit sold at this price'}
                    >
                      {p.aboveBreakeven ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                      {p.aboveBreakeven ? '' : '−'}
                      {money(Math.abs(p.profitCents), c.currency)}
                      <span className="font-normal opacity-80">{p.profitMarginPct}%</span>
                    </span>
                  )}

                  {/* Every marketplace quotes its own currency; the comparison a person is
                      actually making across them is in euro. */}
                  {profitEur && (
                    <span className="text-[11.5px] tabular-nums text-n-500">
                      = {p.aboveBreakeven ? '' : '−'}{profitEur}
                    </span>
                  )}
                </>
              )}
            </div>
            );
          })}

          {/* Ours last, as the thing being compared against rather than another option. */}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 border-t border-n-200 pt-1.5 text-[12px]">
            <span className="w-[124px] shrink-0 font-semibold text-n-800">Our suggestion</span>
            <span className="mono w-[86px] shrink-0 text-right text-[12.5px] font-semibold tabular-nums text-teal-700">
              {money(c.suggestedCents, c.currency)}
            </span>
            <span className="text-[11.5px] text-n-500">at {c.marginPct}% · breakeven {money(c.breakevenCents, c.currency)}</span>
            {c.fx.currency !== 'EUR' && (
              <span className="text-[11px] text-n-400">1 {c.fx.currency} = €{c.fx.eurPerUnit.toFixed(4)}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
