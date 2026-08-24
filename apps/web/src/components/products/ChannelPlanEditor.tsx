import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Ban, Check, ChevronDown, Lock, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Select } from '@masquare/ui';
import { listingApi, type ProductChannelRow } from '../../lib/api';
import { AmazonCandidates } from './AmazonCandidates';
import { AmazonOfferPreview } from './AmazonOfferPreview';
import { CompetitorPrices } from './CompetitorPrices';
import { LaunchPrice } from './LaunchPrice';

const CONDITIONS = [
  { value: 'NEW', label: 'New' },
  { value: 'OPEN_BOX', label: 'Open box' },
  { value: 'USED', label: 'Used' },
];

type StepState = 'done' | 'current' | 'locked';

/**
 * One step of listing a product on a channel.
 *
 * Collapsed steps show their answer, not their controls: the point of the sequence is that you can
 * see what is settled and what is left without opening anything. A locked step says what it is
 * waiting for rather than simply refusing to open — "disabled" with no reason is the least useful
 * state a control can be in.
 */
function Step({
  n, title, state, summary, waitingFor, open, onOpen, children,
}: {
  n: number;
  title: string;
  state: StepState;
  summary?: React.ReactNode;
  waitingFor?: string;
  open: boolean;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  const locked = state === 'locked';
  return (
    <div className={`overflow-hidden rounded-lg border ${open ? 'border-teal-300' : 'border-n-200'} ${locked ? 'opacity-60' : ''}`}>
      <button
        type="button"
        onClick={locked ? undefined : onOpen}
        aria-expanded={open}
        disabled={locked}
        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${locked ? 'cursor-not-allowed' : 'hover:bg-n-25'}`}
      >
        {/* The number carries the sequence; the tick carries the progress. */}
        <span
          className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[11px] font-bold ${
            state === 'done' ? 'bg-teal-500 text-white'
              : state === 'current' ? 'bg-teal-50 text-teal-700 ring-1 ring-teal-400'
              : 'bg-n-100 text-n-400'
          }`}
        >
          {state === 'done' ? <Check size={12} /> : locked ? <Lock size={10} /> : n}
        </span>
        <span className={`text-[13px] font-semibold ${locked ? 'text-n-500' : 'text-n-800'}`}>{title}</span>

        <span className="min-w-0 flex-1 truncate text-right text-[12px] text-n-500">
          {locked ? waitingFor : summary}
        </span>
        {!locked && <ChevronDown size={14} className={`shrink-0 text-n-400 transition-transform ${open ? '' : '-rotate-90'}`} />}
      </button>

      {open && !locked && <div className="border-t border-n-100 bg-n-25 px-3 py-2.5">{children}</div>}
    </div>
  );
}

/**
 * Listing a product on one channel, as an ordered sequence.
 *
 * These panels used to sit in a stack with no stated order — find the listing, price it, check the
 * competition, validate, list — and nothing said which came first or what was still outstanding.
 * The steps encode the real dependencies rather than a preferred order: validation genuinely cannot
 * run before there is an ASIN to attach to and a price to quote, so those steps are locked until
 * there are.
 */
export function PlanEditor({
  row, productId, warnings, onSaved,
}: {
  row: ProductChannelRow;
  productId: string;
  warnings: string[];
  onSaved: () => void;
}) {
  const plan = row.plan;
  const [categoryRef, setCategoryRef] = useState(plan?.categoryRef ?? '');
  const [categoryName, setCategoryName] = useState(plan?.categoryName ?? '');
  const [condition, setCondition] = useState(plan?.condition ?? 'NEW');
  const [handling, setHandling] = useState(plan?.handlingTimeDays?.toString() ?? '');
  const [delivery, setDelivery] = useState(plan?.deliveryTemplate ?? '');
  const [boost, setBoost] = useState(plan?.boostPct?.toString() ?? '0');
  const [price, setPrice] = useState(plan?.offerPriceCents != null ? (plan.offerPriceCents / 100).toFixed(2) : '');
  const asin = ((plan?.aspects as Record<string, string> | null) ?? {}).asin ?? null;

  const isAmazon = row.channelType === 'amazon';
  const isEbay = row.channelType === 'ebay';
  const isOnBuy = row.channelType === 'onbuy';

  const save = useMutation({
    mutationFn: () =>
      listingApi.upsertPlan(productId, row.integrationId, {
        categoryRef: categoryRef.trim() || null,
        categoryName: categoryName.trim() || null,
        condition,
        handlingTimeDays: handling.trim() === '' ? null : Number(handling),
        offerPriceCents: price.trim() === '' ? null : Math.round(Number(price.replace(',', '.')) * 100),
        deliveryTemplate: delivery.trim() || null,
        boostPct: Number(boost || 0),
      }),
    onSuccess: () => { toast.success('Saved'); onSaved(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });

  const match = useMutation({
    mutationFn: (picked: { asin: string; productType: string | null }) =>
      listingApi.upsertPlan(productId, row.integrationId, {
        aspects: { ...((plan?.aspects as Record<string, unknown>) ?? {}), asin: picked.asin },
        ...(picked.productType ? { categoryRef: picked.productType } : {}),
      }),
    onSuccess: (_r, picked) => {
      if (picked.productType) setCategoryRef(picked.productType);
      toast.success(`Matched to ${picked.asin}`);
      onSaved();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save the match'),
  });

  // What each step needs, in the order it is needed. Amazon attaches to a catalogue entry, so the
  // match comes first; eBay and OnBuy have no equivalent and start at the terms.
  const priceSet = price.trim() !== '' && Number(price.replace(',', '.')) > 0;
  const termsSet = handling.trim() !== '' && (!isOnBuy || delivery.trim() !== '');
  const matched = !isAmazon || !!asin;

  const done = { match: matched, price: priceSet, terms: termsSet };
  const firstOpen = !done.match ? 1 : !done.price ? 2 : !done.terms ? 3 : 4;
  const [open, setOpen] = useState<number | null>(null);
  const current = open ?? firstOpen;

  const stateOf = (n: number, isDone: boolean, unlocked: boolean): StepState =>
    isDone && current !== n ? 'done' : unlocked ? 'current' : 'locked';

  // Already selling here: the sequence is over, and what matters is the live listing's state.
  if (row.listing) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2.5 text-[12.5px] text-teal-900">
          <PackageCheck size={15} className="shrink-0 text-teal-600" />
          <span className="font-semibold">Already listed here</span>
          <span className="mono">{row.listing.channelSku}</span>
          {row.listing.asin && <span className="mono text-teal-700">{row.listing.asin}</span>}
          {row.listing.price != null && <span>{row.listing.currency} {row.listing.price}</span>}
          <span>qty {row.listing.quantity ?? '—'}</span>
        </div>
        {isAmazon && (
          <AmazonOfferPreview
            productId={productId}
            integrationId={row.integrationId}
            asin={asin ?? row.listing.asin}
            quantity={row.quantity.value}
            onListed={onSaved}
            savePlan={() => save.mutateAsync()}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {warnings.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-900">
          {warnings.map((w) => (
            <div key={w} className="flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-600" /> <span>{w}.</span></div>
          ))}
        </div>
      )}

      {row.eligibility.noProfile && (
        <div className="rounded-md border border-n-200 bg-n-0 px-2.5 py-2 text-[12px] text-n-600">
          No mains or plug profile exists for this market, so nothing was checked. Add one under
          Settings → Marketplace profiles.
        </div>
      )}

      {isAmazon && (
        <Step
          n={1}
          title="Find it on Amazon"
          state={stateOf(1, done.match, true)}
          summary={asin ? <span className="mono text-teal-700">{asin}{categoryRef ? ` · ${categoryRef}` : ''}</span> : 'Not matched yet'}
          open={current === 1}
          onOpen={() => setOpen(current === 1 ? -1 : 1)}
        >
          <AmazonCandidates
            productId={productId}
            integrationId={row.integrationId}
            selectedAsin={asin}
            onSelect={(pickedAsin, productType) => match.mutate({ asin: pickedAsin, productType })}
          />
        </Step>
      )}

      <Step
        n={isAmazon ? 2 : 1}
        title="Set the price"
        state={stateOf(2, done.price, done.match)}
        summary={priceSet ? `${price}` : 'No launch price yet'}
        waitingFor="Match a listing first"
        open={current === 2}
        onOpen={() => setOpen(current === 2 ? -1 : 2)}
      >
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Launch price</span>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="in this marketplace's currency"
              className="input mono h-8 w-[160px] text-right text-[12.5px]"
            />
          </label>
          {isAmazon && asin && (
            <>
              <LaunchPrice productId={productId} integrationId={row.integrationId} price={price} onPriceChange={setPrice} />
              <CompetitorPrices productId={productId} integrationId={row.integrationId} />
            </>
          )}
        </div>
      </Step>

      <Step
        n={isAmazon ? 3 : 2}
        title="Stock and dispatch"
        state={stateOf(3, done.terms, done.price)}
        summary={termsSet ? `${row.quantity.value ?? 0} units · ${handling} day${handling === '1' ? '' : 's'}` : 'Handling time not set'}
        waitingFor="Set a price first"
        open={current === 3}
        onOpen={() => setOpen(current === 3 ? -1 : 3)}
      >
        <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Quantity to list</span>
            <div className={`flex h-8 items-center rounded-lg border px-2.5 text-[12.5px] ${row.quantity.value ? 'border-n-200 bg-n-50 text-n-700' : 'border-amber-300 bg-amber-50 text-amber-800'}`}>
              <span className="mono font-semibold">{row.quantity.value ?? 'none'}</span>
            </div>
            <span className="text-[11px] text-n-400">
              {row.quantity.source === 'availability' ? 'From Availability'
                : row.quantity.source === 'this-listing' ? 'From the live listing here'
                : row.quantity.source === 'sibling-listing' ? `Borrowed from ${row.quantity.from ?? 'another marketplace'} — no Availability recorded`
                : 'No sellable quantity recorded — set it on the Availability page'}
              {row.quantity.value === 0 && ' · nobody can buy at zero'}
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Handling time (days)</span>
            <input
              value={handling}
              onChange={(e) => setHandling(e.target.value)}
              inputMode="numeric"
              placeholder="days to dispatch"
              className="input mono h-8 text-[12.5px]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Condition</span>
            {isEbay ? (
              <Select dense value={condition} onChange={setCondition} options={CONDITIONS} />
            ) : (
              <div className="flex h-8 items-center rounded-lg border border-n-200 bg-n-50 px-2.5 text-[12.5px] text-n-500">
                New — {row.channelType} sells new only
              </div>
            )}
          </label>

          {!isAmazon && (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-n-500">
                {isEbay ? 'eBay category id' : 'Category'}
              </span>
              <input value={categoryRef} onChange={(e) => setCategoryRef(e.target.value)} className="input mono h-8 text-[12.5px]" />
            </label>
          )}

          {isOnBuy && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Delivery template</span>
                <input value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="OnBuy template name" className="input h-8 text-[12.5px]" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Boost %</span>
                <input value={boost} onChange={(e) => setBoost(e.target.value)} inputMode="decimal" className="input mono h-8 text-[12.5px]" />
                <span className="text-[11px] text-n-400">0% unless someone decides otherwise. OnBuy defaults this to 20%.</span>
              </label>
            </>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Category name</span>
            <input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="for people, not the API" className="input h-8 text-[12.5px]" />
          </label>
        </div>
      </Step>

      <Step
        n={isAmazon ? 4 : 3}
        title="Check and list"
        state={stateOf(4, false, done.match && done.price && done.terms)}
        summary={plan?.status === 'SUBMITTED' ? 'Submitted to the channel' : 'Not listed yet'}
        waitingFor={!done.price ? 'Set a price first' : 'Set a handling time first'}
        open={current === 4}
        onOpen={() => setOpen(current === 4 ? -1 : 4)}
      >
        {isAmazon ? (
          <AmazonOfferPreview
            productId={productId}
            integrationId={row.integrationId}
            asin={asin}
            quantity={row.quantity.value}
            onListed={onSaved}
            savePlan={() => save.mutateAsync()}
          />
        ) : (
          <div className="rounded-md border border-n-200 bg-n-0 px-3 py-2.5 text-[12px] text-n-500">
            Listing on {row.channelType} is not built yet. The plan is saved and will be used when it is.
          </div>
        )}
      </Step>

      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-n-200 bg-n-0 px-3 text-[12.5px] font-semibold text-n-700 hover:border-n-300 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save plan'}
        </button>
        {/* Saving is not the goal, so it does not get the primary button — listing does, at step 4. */}
        <span className="text-[11.5px] text-n-400">
          Saved automatically when you validate or list.
        </span>
        {plan?.status && plan.status !== 'DRAFT' && <span className="text-[11.5px] text-n-500">Status {plan.status}</span>}
      </div>
    </div>
  );
}

/** Kept for callers that only need to know a channel is blocked. */
export function BlockedNotice({ reasons }: { reasons: string[] }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-danger-bd bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
      <Ban size={14} className="mt-0.5 shrink-0" />
      <span>{reasons.join('; ') || 'This product may not be sold on this marketplace.'}</span>
    </div>
  );
}
