import { useMutation } from '@tanstack/react-query';
import { Calculator, Loader2 } from 'lucide-react';
import { repricingApi, type RepricingProfitLine } from '../../lib/api';

const fmt = (c: number, ccy: string) => `${c < 0 ? '−' : ''}${(Math.abs(c) / 100).toFixed(2)} ${ccy}`;

/** The lines of one price's profit, in the order a person reads a P&L. */
function lines(r: RepricingProfitLine): [string, number][] {
  return ([
    ['VAT', r.vatCents],
    ['Amazon referral fee', r.referralFeeCents],
    ['Fulfilment fee', r.fulfilmentFeeCents],
    ['Closing fee', r.closingFeeCents],
    ['Product cost', r.costCents],
    ['Shipping & fixed costs', r.shippingAndFixedCents],
    ['Returns allowance', r.returnsCents],
    ['Storage', r.storageCents],
    ['Advertising', r.adsCents],
  ] as [string, number][]).filter(([, v]) => v !== 0);
}

/**
 * What the product earns at the minimum and maximum a person is typing — worked out on request, from
 * the same VAT, Amazon fees, fulfilment, returns and costs the floor is solved from.
 *
 * On a button rather than on every keystroke: each check asks the server for the SKU's fees and
 * costs, and a half-typed "1" is not a price anyone wants priced.
 */
export function RangeProfitCheck({ skuPricingId, currency, prices }: {
  skuPricingId: string;
  currency: string;
  /** Label → price in cents; entries without a valid price are skipped. */
  prices: { label: string; cents: number | null }[];
}) {
  const wanted = prices.filter((p) => p.cents != null && p.cents > 0) as { label: string; cents: number }[];
  const check = useMutation({ mutationFn: () => repricingApi.profitAt(skuPricingId, wanted.map((p) => p.cents)) });
  const data = check.data;
  // A result belongs to the prices it was asked for; once they change it is stale and is hidden.
  const asked = check.variables === undefined ? null : wanted.map((p) => p.cents).join(',');
  const stale = data?.ok && data.results.map((r) => r.priceCents).join(',') !== [...new Set(wanted.map((p) => p.cents))].join(',');

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="hbtn" disabled={wanted.length === 0 || check.isPending} onClick={() => check.mutate()}>
          {check.isPending ? <Loader2 size={14} className="animate-spin" /> : <Calculator size={14} />} Calculate profit
        </button>
        <span className="text-[11.5px] text-n-500">
          {wanted.length === 0 ? 'Enter a minimum or maximum price first.' : 'Per unit, after VAT, Amazon fees, fulfilment, returns and cost.'}
        </span>
      </div>

      {data && !data.ok && <p className="text-[12px] text-danger">Profit can’t be worked out: {data.reason}</p>}
      {check.isError && <p className="text-[12px] text-danger">Could not calculate the profit.</p>}

      {data?.ok && !stale && asked && (
        <div className="grid gap-2 md:grid-cols-2">
          {wanted.map((p) => {
            const r = data.results.find((x) => x.priceCents === p.cents);
            if (!r) return null;
            const loss = r.profitCents < 0;
            return (
              <div key={p.label} className={`rounded-md border p-2.5 ${loss ? 'border-danger-bd bg-danger-bg' : 'border-n-200 bg-n-25'}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] font-semibold text-n-700">{p.label} · {fmt(r.priceCents, currency)}</span>
                  <span className={`font-mono text-[13px] font-semibold tabular-nums ${loss ? 'text-danger' : 'text-teal-700'}`}>
                    {fmt(r.profitCents, currency)}
                  </span>
                </div>
                <div className={`text-right text-[11.5px] ${loss ? 'text-danger' : 'text-n-500'}`}>
                  {r.marginPct == null ? '—' : `${r.marginPct}% margin`}{loss ? ' — a loss on every sale' : ''}
                </div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-[11px] text-n-500">How it adds up</summary>
                  <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-[11.5px]">
                    <dt className="text-n-600">Price</dt><dd className="text-right font-mono tabular-nums">{fmt(r.priceCents, currency)}</dd>
                    {lines(r).map(([label, v]) => (
                      <div key={label} className="contents">
                        <dt className="text-n-500">{label}</dt>
                        <dd className="text-right font-mono tabular-nums text-n-600">{fmt(-v, currency)}</dd>
                      </div>
                    ))}
                    <dt className="border-t border-n-200 pt-0.5 font-semibold text-n-700">Profit</dt>
                    <dd className="border-t border-n-200 pt-0.5 text-right font-mono font-semibold tabular-nums">{fmt(r.profitCents, currency)}</dd>
                  </dl>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
