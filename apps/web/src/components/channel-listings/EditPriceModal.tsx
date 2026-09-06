import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Calculator, Lock, TrendingDown, TrendingUp, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import { amazonListingApi } from '../../lib/api';
import { eurAside } from '../../lib/format';
import { isZeroDecimalCurrency, limitPriceInput } from '../../lib/currencies';
import { useConfirm } from '../ConfirmProvider';
import { CompetitorPrices } from '../products/CompetitorPrices';

const SYMBOL: Record<string, string> = { EUR: '€', GBP: '£', USD: '$', CAD: 'CA$', AUD: 'A$', JPY: '¥', SEK: 'kr', PLN: 'zł', AED: 'AED ', SAR: 'SAR ', MXN: 'MX$', TRY: '₺', SGD: 'S$' };
const money = (cents: number, ccy: string) =>
  `${SYMBOL[ccy] ?? `${ccy} `}${(cents / 100).toFixed(ccy === 'JPY' ? 0 : 2)}`;

/**
 * Change one listing's price, from the card that showed the problem.
 *
 * A card reading "Loss at this price" used to be a dead end: the only way to act on it was the full
 * listing flow, which is six steps about a listing that already exists. The number that is wrong is
 * the price, so the price is what this changes.
 *
 * Nothing is sent until someone confirms, and the profit is quoted by the same engine as everywhere
 * else — a second calculation would be a second answer to the question the card just asked.
 */
export function EditPriceModal({
  productId, integrationId, channelName, onClose, onSaved,
}: {
  productId: string;
  integrationId: string;
  channelName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const confirm = useConfirm();
  const [price, setPrice] = useState('');
  /** The price the profit on screen was actually computed for. */
  const [pricedAt, setPricedAt] = useState<number | null>(null);

  const typedCents = price.trim() === '' ? null : Math.round(Number(price.replace(',', '.')) * 100);

  // The listing as it stands: current price, what it earns, and what we would suggest instead.
  const initial = useQuery({
    queryKey: ['price-check', productId, integrationId],
    queryFn: () => amazonListingApi.priceCheck(productId, integrationId),
  });

  const check = useMutation({
    mutationFn: (cents: number) => amazonListingApi.priceCheck(productId, integrationId, cents),
    onSuccess: (_r, cents) => setPricedAt(cents),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not price that'),
  });

  const save = useMutation({
    mutationFn: (cents: number) => amazonListingApi.updatePrice(productId, integrationId, cents, true),
    onSuccess: (r) => {
      if (!r.ok) { toast.error(r.message || 'The channel rejected the price'); return; }
      toast.success(r.dryRun ? `Validated — ${money(r.priceCents, r.currency)} was NOT sent` : `Price changed to ${money(r.priceCents, r.currency)}`);
      onSaved();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not change the price'),
  });

  const data = check.data ?? initial.data;
  const ok = data?.ok ? data : null;
  const currency = ok?.currency ?? 'EUR';

  // Seed the box with what is live, so the modal opens on the number being questioned.
  useEffect(() => {
    if (initial.data?.ok && initial.data.currentCents != null && price === '') {
      const ccy = initial.data.currency;
      setPrice((initial.data.currentCents / 100).toFixed(isZeroDecimalCurrency(ccy) ? 0 : 2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.data]);

  const proposed = check.data?.ok ? check.data.proposed : null;
  // Only shown for the price it was computed for: a figure that lags the box by one edit is worse
  // than none, because it looks current.
  const stale = pricedAt != null && typedCents !== pricedAt;

  const submit = async () => {
    if (typedCents == null || typedCents <= 0) { toast.error('Enter a price'); return; }
    const ready = await confirm({
      title: `Change the price on ${channelName}?`,
      message: `${money(typedCents, currency)} will be sent to the channel for ${ok?.sku ?? 'this listing'}.`,
      confirmLabel: 'Change the price',
    });
    if (ready) save.mutate(typedCents);
  };

  return (
    <ModalShell
      open
      title={`Edit price — ${channelName}`}
      subtitle={ok?.sku ? `SKU ${ok.sku}` : undefined}
      primaryLabel={save.isPending ? 'Sending…' : 'Change the price'}
      onPrimary={submit}
      onClose={onClose}
      initialSize={{ w: 600, h: 560 }}
    >
      <div className="flex flex-col gap-3">
        {initial.isLoading && <div className="py-6 text-center text-[13px] text-n-500">Reading the listing…</div>}

        {data && !data.ok && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" />
            {/* Without a cost basis there is no profit to quote. The price can still be changed —
                this is a missing figure, not a reason to refuse. */}
            <span>{data.reason} — the price can still be changed, but no profit can be quoted for it.</span>
          </div>
        )}

        {ok?.current && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-n-200 bg-n-25 px-3 py-2 text-[12.5px]">
            <span className="text-n-500">Live now</span>
            <span className="mono font-semibold text-n-800">{money(ok.currentCents!, currency)}</span>
            <span className={ok.current.aboveBreakeven ? 'text-teal-700' : 'text-danger'}>
              {ok.current.aboveBreakeven ? 'earns' : 'loses'} {money(Math.abs(ok.current.profitCents), currency)} · {ok.current.marginPct}%
            </span>
            {eurAside(Math.abs(ok.current.profitEurCents), currency) && (
              <span className="text-n-500">= {ok.current.aboveBreakeven ? '' : '−'}{eurAside(Math.abs(ok.current.profitEurCents), currency)}</span>
            )}
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-n-600">
            New price ({currency})
            {/* Said where the number is entered, because that is where it can still be acted on. */}
            {isZeroDecimalCurrency(currency) && (
              <span className="ml-1.5 font-normal text-n-400">— {currency} has no decimals</span>
            )}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={price}
              // Filtered as it is typed, not checked on submit: a box that silently drops what you
              // typed at the end is worse than one that never accepted it.
              onChange={(e) => setPrice(limitPriceInput(e.target.value, currency))}
              inputMode={isZeroDecimalCurrency(currency) ? 'numeric' : 'decimal'}
              placeholder={isZeroDecimalCurrency(currency) ? 'whole numbers only' : "in this marketplace's currency"}
              className="mono h-9 w-[180px] rounded-md border border-n-200 px-2.5 text-[13px] outline-none focus:border-teal-400"
            />
            <button
              type="button"
              onClick={() => typedCents && check.mutate(typedCents)}
              disabled={check.isPending || typedCents == null}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-n-300 disabled:opacity-50"
            >
              <Calculator size={14} /> {check.isPending ? 'Calculating…' : 'Calculate profit'}
            </button>
            {ok?.suggestedCents != null && (
              <button
                type="button"
                onClick={() => { setPrice((ok.suggestedCents / 100).toFixed(isZeroDecimalCurrency(currency) ? 0 : 2)); setPricedAt(null); }}
                title={`The price that earns ${ok.targetMarginPct}% — breakeven is ${money(ok.breakevenCents, currency)}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-teal-300 hover:text-teal-700"
              >
                <Wand2 size={14} /> Use {money(ok.suggestedCents, currency)} ({ok.targetMarginPct}%)
              </button>
            )}
          </div>
        </label>

        {proposed && !stale && (
          <div className={`flex flex-wrap items-center gap-2 rounded-md px-3 py-2 text-[12.5px] font-semibold ${proposed.aboveBreakeven ? 'bg-teal-50 text-teal-800' : 'bg-danger-bg text-danger'}`}>
            {proposed.aboveBreakeven ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            <span>
              {proposed.aboveBreakeven ? 'Earns' : 'Loses'} {money(Math.abs(proposed.profitCents), currency)} · {proposed.marginPct}%
            </span>
            {eurAside(Math.abs(proposed.profitEurCents), currency) && (
              <span className="font-normal opacity-80">= {proposed.aboveBreakeven ? '' : '−'}{eurAside(Math.abs(proposed.profitEurCents), currency)}</span>
            )}
            {!proposed.aboveBreakeven && ok && (
              <span className="font-normal">— below breakeven of {money(ok.breakevenCents, currency)}</span>
            )}
          </div>
        )}
        {stale && <p className="text-[11.5px] text-n-400">Price changed since the last calculation.</p>}

        {/* The same panel as the listing flow, not a second version of it.
            A price set without knowing what everyone else charges is a guess, and the figures it
            needs are one call away. Read-only and no Match button, deliberately: none of Amazon's
            reference prices knows our costs, and matching one blind is how a listing sells at a
            loss all month. */}
        <CompetitorPrices productId={productId} integrationId={integrationId} />

        {/* Said before the button is pressed, not after. A price that looks sent and was not is
            worse than a refusal, because the card then disagrees with the marketplace. */}
        <PriceWriteNotice />
      </div>
    </ModalShell>
  );
}

/** Whether a real price write is possible, stated plainly before anyone commits to one. */
function PriceWriteNotice() {
  const { data } = useQuery({ queryKey: ['amazon-listing-status'], queryFn: () => amazonListingApi.status() });
  if (data?.priceWritesEnabled) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-n-200 bg-n-25 px-3 py-2 text-[12px] text-n-600">
      <Lock size={12} className="mt-0.5 shrink-0 text-n-400" />
      <span>
        Price writes are switched off, so this will be <b>validated with the channel and not sent</b>. Turn on
        “Change listing prices” in Global settings to make it live. Separate from listing creation and from the
        repricing engine — neither switch turns this one on.
      </span>
    </div>
  );
}
