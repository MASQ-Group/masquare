import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Search, AlertTriangle } from 'lucide-react';
import { integrationsApi, type EbayOrderMoney } from '../../lib/api';

/**
 * What eBay actually reports for one order's money fields.
 *
 * eBay converts to the payout currency and reports both sides on its Amount type. We read only
 * the converted value and assume the order's currency, so a fee eBay has already turned into EUR
 * gets converted a second time — and one it has not gets our FX rate where eBay used theirs.
 * Which is happening cannot be told from a stored transaction, where both have collapsed into a
 * single number, so this shows the raw fields.
 */
export function EbayOrderMoneyPanel({ integrationId }: { integrationId: string }) {
  const [orderId, setOrderId] = useState('');
  const [data, setData] = useState<EbayOrderMoney | null>(null);

  const run = useMutation({
    mutationFn: () => integrationsApi.ebayOrderMoney(integrationId, orderId.trim()),
    onSuccess: setData,
    onError: () => setData(null),
  });

  const amt = (a: EbayOrderMoney['amounts']['totalMarketplaceFee'] | undefined) =>
    !a || a.value == null
      ? '—'
      : a.converted
        ? `${a.value} ${a.currency}  ← converted from ${a.convertedFromValue} ${a.convertedFromCurrency}`
        : `${a.value} ${a.currency ?? ''}`.trim();

  return (
    <div className="mt-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Order money check</div>
      <p className="mt-1 text-[11.5px] text-n-500">
        Reads one order&rsquo;s amounts exactly as eBay returns them, to see whether eBay already converted
        the fee to our payout currency. Nothing is changed.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          className="input mono h-8 w-[210px] text-[12.5px]"
          placeholder="eBay order id"
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && orderId.trim()) run.mutate(); }}
        />
        <button
          onClick={() => run.mutate()}
          disabled={!orderId.trim() || run.isPending}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-n-300 disabled:opacity-50"
        >
          <Search size={14} /> {run.isPending ? 'Reading…' : 'Check order'}
        </button>
      </div>

      {run.isError && (
        <div className="mt-2 text-[12px] text-danger">
          {(run.error as any)?.response?.data?.message ?? 'Could not read that order.'}
        </div>
      )}

      {data && (
        <div className="mt-2.5 rounded-lg border border-n-200 bg-n-25 px-3 py-2.5 text-[12px]">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-n-600">
            <span>Order <span className="mono">{data.orderId}</span></span>
            <span>{data.marketplaceId ?? '—'}</span>
            <span>order currency <b>{data.orderCurrency ?? '—'}</b></span>
          </div>
          <div className="mt-2 flex flex-col gap-0.5">
            {([
              ['Order total', data.amounts.pricingTotal],
              ['Item subtotal', data.amounts.priceSubtotal],
              ['Shipping', data.amounts.deliveryCost],
              ['eBay fee', data.amounts.totalMarketplaceFee],
            ] as const).map(([label, a]) => (
              <div key={label} className="flex flex-wrap items-baseline gap-2">
                <span className="w-[110px] shrink-0 text-n-500">{label}</span>
                <span className="mono text-[11.5px] text-n-800">{amt(a)}</span>
              </div>
            ))}
          </div>

          <div className="mt-2 border-t border-n-200 pt-2">
            {data.interpretation.mismatch ? (
              <div className="flex items-start gap-1.5 text-[11.5px] text-danger">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>{data.interpretation.mismatch}</span>
              </div>
            ) : (
              <div className="text-[11.5px] text-n-600">
                eBay reports the fee in the order&rsquo;s own currency, so our exchange rate is the right one to
                apply. A gap against eBay&rsquo;s statement would then be the fee amount, not the conversion.
              </div>
            )}
            {data.interpretation.ebayImpliedRate != null && (
              <div className="mt-1 text-[11.5px] text-n-600">
                eBay&rsquo;s own rate on this order: <b className="mono">{data.interpretation.ebayImpliedRate}</b>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
