import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { carriersApi, type FedexRateOption } from '../../lib/api';

interface Props {
  transactionId: string;
  /** Fills the parcel's cost box with a price the operator chose. */
  onUsePrice: (amount: number) => void;
}

/**
 * What FedEx would charge for this order, while somebody is recording the shipment.
 *
 * Decision support, not a cost entry. The cost field on a shipment is what we were ACTUALLY charged
 * — it is what accounting later checks against the carrier's invoice, and what the review tick
 * signs off. A quote is a different kind of fact, so nothing here writes into that field on its own:
 * taking a quoted price is a deliberate click, and the panel says plainly that it is a quote.
 *
 * Production accounts only, and the API enforces that. A sandbox quote is canned data, and putting
 * a fictitious price in front of somebody deciding what to charge would be worse than showing none.
 */
export function FedexRatesPanel({ transactionId, onUsePrice }: Props) {
  const [weightKg, setWeightKg] = useState('');
  /**
   * A postcode for this quote alone.
   *
   * Most orders hold no delivery address — they only began accumulating when that work shipped,
   * eBay and OnBuy supply them from the next sync forward, and Amazon's are typed by hand. A quote
   * needs a postcode and a country and nothing more, so asking for the one missing piece beats
   * refusing to quote the entire back catalogue. It is not saved: a postcode on its own is not a
   * delivery address, and storing it as one would leave a half-address that reads as answered.
   */
  const [postalCode, setPostalCode] = useState('');
  const [used, setUsed] = useState<string | null>(null);

  const quote = useMutation({
    mutationFn: () =>
      carriersApi.quoteForTransaction({
        transactionId,
        weightKg: weightKg.trim() === '' ? null : Number(weightKg),
        postalCode: postalCode.trim() === '' ? null : postalCode.trim(),
      }),
    onSuccess: (r) => {
      if (!r.ok) toast.error(r.reason ?? 'No rates returned', { duration: 8000 });
      else if ((r.quote?.options.length ?? 0) === 0) toast.info('FedEx returned no services for this lane');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not reach FedEx'),
  });

  const r = quote.data;
  const options: FedexRateOption[] = r?.quote?.options ?? [];

  return (
    <div className="mt-4 rounded-md border border-n-200 bg-n-25 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <div className="text-[12.5px] font-semibold text-n-700">FedEx rates</div>
          <p className="mt-0.5 text-[11.5px] text-n-500">
            What FedEx would charge, at our negotiated prices. A quote — not what we were billed.
          </p>
        </div>
        <div className="w-32">
          <label className="label">Postcode</label>
          <input
            className="input mono h-9"
            placeholder={r?.destination?.postalCode ?? 'from order'}
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
          />
        </div>
        <div className="w-28">
          <label className="label">Weight (kg)</label>
          <input
            className="input mono h-9"
            inputMode="decimal"
            placeholder="auto"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[13px] font-semibold text-n-700 hover:border-teal-300 hover:text-teal-700 disabled:opacity-50"
          disabled={quote.isPending}
          onClick={() => quote.mutate()}
        >
          {quote.isPending ? <><Loader2 size={14} className="animate-spin" /> Asking…</> : <><Truck size={14} /> Get rates</>}
        </button>
      </div>

      {/* A refusal names what is missing. "No rates" and "no delivery address on this order" look
          identical otherwise, and only one of them is something a person can go and fix. */}
      {r && !r.ok && r.reason && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-900">
          {r.reason}
          {/* The country is known on every order even where no address was captured, so say so
              rather than leaving somebody to wonder whether that is missing too. */}
          {r.destination?.countryIso && !r.destination.postalCode && (
            <span className="mt-1 block text-amber-800">
              Destination country is <span className="mono">{r.destination.countryIso}</span> — only the postcode is missing.
            </span>
          )}
        </p>
      )}

      {r?.ok && (
        <>
          <p className="mt-2 text-[11.5px] text-n-500">
            {/* The assumption, shown rather than left to be inferred. A quote for the wrong weight
                is not visibly wrong — it is simply a number. */}
            Rated {r.weightKg} kg{r.weightSource === 'products' ? ' (from the products on this order)' : ' (as entered)'}
            {r.destination ? ` to ${r.destination.postalCode} ${r.destination.countryIso}` : ''}.
          </p>

          {/* An under-weighed parcel quotes cheap, and a cheap number is not visibly wrong. Said
              plainly rather than left in the arithmetic. */}
          {!!r.linesWithoutWeight && (
            <p className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-900">
              {r.linesWithoutWeight} line{r.linesWithoutWeight === 1 ? ' has' : 's have'} no weight in the
              catalogue, so this quote is for less than the whole order and will be too low. Enter a
              weight above, or add the missing ones to the products.
            </p>
          )}

          {options.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {options.map((o) => (
                <div key={o.serviceType} className="flex flex-wrap items-center gap-2 rounded-md border border-n-100 bg-n-0 px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium text-n-800">{o.serviceName}</div>
                    <div className="text-[11.5px] text-n-500">
                      {o.deliveryAt ? new Date(o.deliveryAt).toLocaleDateString() : 'no committed date'}
                      {o.listCharge != null && o.listCharge !== o.netCharge && (
                        <> · list <span className="mono">{o.listCharge.toFixed(2)}</span></>
                      )}
                      {/* Never passed off as ours. Overstating cost is the safer direction for a
                          decision and still untrue in a profit figure. */}
                      {o.isListPriceOnly && <span className="text-orange-700"> · published price, not negotiated</span>}
                    </div>
                  </div>
                  <span className="mono text-[13px] font-semibold text-n-900">{o.netCharge.toFixed(2)} {o.currency}</span>
                  <button
                    type="button"
                    className="inline-flex h-8 items-center rounded-md border border-n-200 bg-n-0 px-2.5 text-[12.5px] font-semibold text-teal-700 hover:border-teal-300"
                    onClick={() => { onUsePrice(o.netCharge); setUsed(o.serviceType); }}
                  >
                    Use this price
                  </button>
                </div>
              ))}
            </div>
          )}

          {used && (
            /* Said once the price has been taken, because from here on it looks like any other
               typed figure — and accounting's review still has to check it against an invoice. */
            <p className="mt-2 text-[11.5px] text-n-500">
              A quoted price has been put in the cost box. It is still a quote until the invoice
              confirms it — worth marking reviewed only once it has.
            </p>
          )}

          {r.quote && r.quote.options.length > 0 && (
            <p className="mt-1 text-[11.5px] text-n-400">
              Carriage only — duties, taxes and clearance fees are charged separately.
            </p>
          )}
        </>
      )}
    </div>
  );
}
