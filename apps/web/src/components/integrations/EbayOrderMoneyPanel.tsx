import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Search, AlertTriangle, KeyRound } from 'lucide-react';
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
  const [keyNote, setKeyNote] = useState<string | null>(null);

  const makeKey = useMutation({
    mutationFn: () => integrationsApi.createEbaySigningKey(integrationId),
    onSuccess: (r) => { setKeyNote(r.created ? 'Signing key created — check the order again.' : (r.message ?? 'A signing key already exists.')); },
    onError: (e: any) => setKeyNote(e?.response?.data?.message ?? 'Could not create a signing key.'),
  });

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

          {/* What eBay actually charged, in the currency they pay us in. */}
          <div className="mt-2 border-t border-n-200 pt-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-n-500">What eBay charged (Finances)</div>
            {data.finances.ok && data.finances.feeInPayoutCurrency != null ? (
              <div className="mt-1 flex flex-col gap-0.5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="w-[110px] shrink-0 text-n-500">Fee charged</span>
                  <span className="mono text-[11.5px] text-n-800">
                    {data.finances.feeInPayoutCurrency} {data.finances.payoutCurrency ?? ''}
                  </span>
                </div>
                {data.ebayRate != null && (
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="w-[110px] shrink-0 text-n-500">eBay&rsquo;s rate</span>
                    <span className="mono text-[11.5px] font-semibold text-n-800">{data.ebayRate}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-1 text-[11.5px] text-n-500">
                {/^Missing x-ebay-signature/i.test(data.finances.message ?? '') ? (
                  <>
                    eBay requires digitally signed requests on the Finances API for EU/UK sellers, and this
                    connection has no signing key yet. Until it does, their payout figures cannot be read and
                    the platform falls back to its own exchange rate.
                    <div className="mt-1.5">
                      <button
                        onClick={() => makeKey.mutate()}
                        disabled={makeKey.isPending}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-2.5 text-[12px] font-semibold text-n-700 hover:border-n-300 disabled:opacity-50"
                      >
                        <KeyRound size={13} /> {makeKey.isPending ? 'Creating…' : 'Create signing key'}
                      </button>
                      {keyNote && <span className="ml-2 text-[11.5px] text-n-600">{keyNote}</span>}
                    </div>
                  </>
                ) : (
                  data.finances.message ?? 'No finance transactions returned for this order yet — eBay posts them once the order settles.'
                )}
              </div>
            )}
          </div>

          {data.signatureSent && (
            <details className="mt-2 border-t border-n-200 pt-2">
              <summary className="cursor-pointer text-[11.5px] font-semibold text-n-600">
                What we signed and sent (for diagnosing a rejection)
              </summary>
              <div className="mt-1.5 flex flex-col gap-1 text-[11px]">
                {/* The two things eBay support asks for first. */}
                <div className="rounded bg-n-100 px-2 py-1.5">
                  <div className="text-n-500">
                    Give these to eBay support — they identify this exact call in their logs:
                  </div>
                  <div className="mono mt-0.5 break-all text-n-800">
                    rlogid: {data.signatureSent.rlogId ?? 'not returned'}
                  </div>
                  <div className="mono break-all text-n-800">
                    error: {data.signatureSent.errorCode ?? '—'} (HTTP {data.signatureSent.status ?? '—'})
                  </div>
                </div>
                <div className="text-n-500">
                  key <span className="mono">{data.signatureSent.keyId ?? '—'}</span> · {data.signatureSent.cipher} ·
                  jwe <span className="mono">{data.signatureSent.jwePrefix}…</span> ({data.signatureSent.jweLength} chars) ·
                  created <span className="mono">{data.signatureSent.created}</span> ({data.signatureSent.serverTime})
                </div>
                <div className="mono break-all text-n-700">{data.signatureSent.url}</div>
                <div className="text-n-500">signature base, exactly as signed:</div>
                <pre className="mono overflow-x-auto whitespace-pre rounded bg-n-100 px-2 py-1.5 text-[10.5px] text-n-800">{data.signatureSent.base}</pre>
                <div className="mono break-all text-n-700">Signature-Input: {data.signatureSent.signatureInput}</div>
                <div className="mono break-all text-n-700">Signature: {data.signatureSent.signature}</div>
                <div className="text-n-400">No private key appears here — the JWE is a public key.</div>
              </div>
            </details>
          )}

          <div className="mt-2 border-t border-n-200 pt-2">
            {data.interpretation.mismatch ? (
              <div className="flex items-start gap-1.5 text-[11.5px] text-danger">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>{data.interpretation.mismatch}</span>
              </div>
            ) : (
              <div className="text-[11.5px] text-n-600">
                eBay reports the fee in the order&rsquo;s own currency, so there is no conversion here to read.
                eBay converts the whole order at <em>their</em> rate when they pay out, which is not the rate
                we apply — the Finances figures above are the only place their rate can be obtained.
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
