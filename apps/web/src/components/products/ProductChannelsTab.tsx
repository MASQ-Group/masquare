import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, Check, ChevronDown, ChevronRight, Clock, Loader2, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Select } from '@masquare/ui';
import { amazonListingApi, listingApi, type AmazonSweep, type ProductChannelRow } from '../../lib/api';
import { AmazonCandidates } from './AmazonCandidates';
import { AmazonOfferPreview } from './AmazonOfferPreview';
import { LaunchPrice } from './LaunchPrice';
import { CompetitorPrices } from './CompetitorPrices';
import { ChannelGroup, CHANNEL_TONE } from './ChannelGroup';
import { useJobProgress } from '../../lib/useJobProgress';

const CONDITIONS = [
  { value: 'NEW', label: 'New' },
  { value: 'OPEN_BOX', label: 'Open box' },
  { value: 'USED', label: 'Used' },
];

/**
 * Where this product meets each connected channel.
 *
 * Two verdicts per row, and they mean different things. Readiness is what nobody has typed yet and
 * reads as a to-do. Eligibility is whether the product may be sold there at all — a 230V appliance
 * on a 120V market is not incomplete, it is forbidden — so it refuses rather than warns.
 */
export function ProductChannelsTab({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['listing', 'product-channels', productId],
    queryFn: () => listingApi.productChannels(productId),
  });

  // One sweep per product, keyed so a reload during a minute-long search re-attaches to it.
  const sweep = useJobProgress(`listing.amazon.sweep.${productId}`);

  if (isLoading) {
    return <div className="flex items-center gap-2 py-10 text-[13px] text-n-500"><Loader2 size={15} className="animate-spin" /> Reading channels…</div>;
  }
  if (!data) return <div className="py-10 text-center text-[13px] text-n-500">Could not read the channels for this product.</div>;

  if (data.channels.length === 0) {
    return (
      <div className="py-12 text-center">
        <div className="text-[13.5px] font-medium text-n-700">No channels connected</div>
        <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-n-500">
          Connect an Amazon, eBay or OnBuy account under Setup → Marketplace integrations, and it will
          appear here.
        </p>
      </div>
    );
  }

  const { summary } = data;

  // Insertion order follows the API's ordering (channelType asc), which keeps the groups stable.
  const groups = [...new Map(
    data.channels.map((r) => [r.channelType, data.channels.filter((c) => c.channelType === r.channelType)]),
  ).entries()];

  return (
    <div className="flex flex-col gap-3">
      {/* Where it is already live, first and in its own line: the costly mistake here is listing a
          product a second time, and that has to be visible before anyone starts searching. */}
      {summary.listed > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3.5 py-2.5 text-[12.5px] text-teal-900">
          <PackageCheck size={15} className="shrink-0 text-teal-600" />
          <span className="font-semibold">Already listed on {summary.listed} channel{summary.listed === 1 ? '' : 's'}</span>
          <span className="text-teal-700">
            {data.channels.filter((c) => c.listing).map((c) => c.marketplace || c.name).join(', ')}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-n-200 bg-n-25 px-3.5 py-2.5 text-[12.5px]">
        <span className="font-semibold text-n-800">{summary.total} connected channel{summary.total === 1 ? '' : 's'}</span>
        <span className="text-teal-700"><b>{summary.ready}</b> ready to list</span>
        {summary.blocked > 0 && <span className="text-danger"><b>{summary.blocked}</b> blocked</span>}
        <div className="flex-1" />
        <span className="text-[11.5px] text-n-400">Nothing here is sent to a channel — this is what we intend to list.</span>
      </div>

      {/* Grouped by marketplace family: eighteen Amazon rows beside one eBay row read as eighteen
          unrelated channels rather than one marketplace in eighteen countries. */}
      {groups.map(([channelType, rows]) => (
        <ChannelGroup
          key={channelType}
          channelType={channelType}
          rows={rows}
          // Only Amazon keeps a separate catalogue per country, so only Amazon has anything to sweep.
          sweep={channelType === 'amazon' ? {
            running: sweep.running,
            value: sweep.value,
            detail: sweep.detail,
            result: (sweep.result as AmazonSweep | null) ?? null,
            error: sweep.error,
            onRun: () => sweep.start(() => amazonListingApi.sweep(productId)),
          } : undefined}
        >
          {rows.map((row, i) => (
            <ChannelRow
              key={row.integrationId}
              row={row}
              productId={productId}
              first={i === 0}
              expanded={open === row.integrationId}
              onToggle={() => setOpen(open === row.integrationId ? null : row.integrationId)}
              onSaved={() => qc.invalidateQueries({ queryKey: ['listing', 'product-channels', productId] })}
            />
          ))}
        </ChannelGroup>
      ))}
    </div>
  );
}

function ChannelRow({
  row, productId, first, expanded, onToggle, onSaved,
}: {
  row: ProductChannelRow;
  productId: string;
  first: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const blocked = !row.eligibility.eligible;
  const blockFindings = row.eligibility.findings.filter((f) => f.severity === 'block');
  const warnFindings = row.eligibility.findings.filter((f) => f.severity === 'warn');

  return (
    <div className={first ? '' : 'border-t border-n-100'}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full flex-wrap items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-n-25"
      >
        {expanded ? <ChevronDown size={14} className="shrink-0 text-n-400" /> : <ChevronRight size={14} className="shrink-0 text-n-400" />}
        <span className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase ${CHANNEL_TONE[row.channelType] ?? 'border-n-200 bg-n-50 text-n-600'}`}>
          {row.channelType}
        </span>
        <span className="text-[13px] font-medium text-n-800">{row.name}</span>
        {row.marketplace && <span className="mono text-[11.5px] text-n-500">{row.marketplace}</span>}

        <div className="flex-1" />

        {row.listing && (
          <span
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-teal-700"
            title={`Listed as ${row.listing.channelSku}${row.listing.asin ? ` (${row.listing.asin})` : ''}`}
          >
            <PackageCheck size={13} /> Listed
          </span>
        )}
        {/* Submitted but not yet seen by a sync. Without this the row reads "Ready to list" for a
            listing that was created minutes ago, which invites listing it a second time. */}
        {!row.listing && row.plan?.status === 'SUBMITTED' && (
          <span
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-amber-700"
            title="Sent to Amazon. It will show as listed once a channel sync picks it up."
          >
            <Clock size={13} /> Submitted
          </span>
        )}
        {blocked ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-danger">
            <Ban size={13} /> Blocked
          </span>
        ) : row.listing || row.plan?.status === 'SUBMITTED' ? null : row.readiness.ready ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-teal-700">
            <Check size={13} /> Ready to list
          </span>
        ) : (
          <span className="text-[12px] text-n-500">
            Needs {row.readiness.missing.map((m) => m.label).join(', ')}
          </span>
        )}
        <span className="mono shrink-0 text-[11px] tabular-nums text-n-400">
          {row.readiness.satisfiedCount}/{row.readiness.totalCount}
        </span>
      </button>

      {/* A block is stated on the collapsed row too — it is the one thing you must not have to
          open a panel to discover. */}
      {blockFindings.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-danger-bd bg-danger-bg px-3.5 py-2 text-[12px] text-danger">
          {blockFindings.map((f) => (
            <div key={f.code} className="flex items-start gap-1.5">
              <Ban size={12} className="mt-0.5 shrink-0" />
              <span>{f.reason}. Fix the product's technical facts, or do not list it here.</span>
            </div>
          ))}
        </div>
      )}

      {expanded && (
        <PlanEditor
          row={row}
          productId={productId}
          warnings={warnFindings.map((f) => f.reason)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

/** Exported so the Channel Listings page can run the same flow for one channel, in a modal. */
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
  // Always new on Amazon and OnBuy; eBay occasionally carries open box or used.
  const [condition, setCondition] = useState(plan?.condition ?? 'NEW');
  const [handling, setHandling] = useState(plan?.handlingTimeDays?.toString() ?? '');
  const [delivery, setDelivery] = useState(plan?.deliveryTemplate ?? '');
  const [boost, setBoost] = useState(plan?.boostPct?.toString() ?? '0');
  const [price, setPrice] = useState(plan?.offerPriceCents != null ? (plan.offerPriceCents / 100).toFixed(2) : '');
  // The ASIN we attach the offer to. Kept on the plan's aspects rather than as a column: it is one
  // channel's identifier for this product, and eBay's equivalent will not look like it.
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
    // The boost ceiling is enforced server-side, so its refusal arrives here as the message.
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });

  // Saved on the spot rather than left for the Save button: choosing which Amazon listing we attach
  // to is a decision in its own right, and losing it to an unsaved form is worse than an extra call.
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

  const missingByKey = new Map(row.readiness.missing.map((m) => [m.key, m]));
  const flag = (key: string) => (missingByKey.has(key) ? 'border-amber-300 bg-amber-50' : 'border-n-200');

  return (
    <div className="flex flex-col gap-3 border-t border-n-100 bg-n-25 px-3.5 py-3">
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
          Settings → Marketplace profiles to have voltage judged here.
        </div>
      )}

      {isAmazon && (
        <AmazonCandidates
          productId={productId}
          integrationId={row.integrationId}
          selectedAsin={asin}
          onSelect={(pickedAsin, productType) => match.mutate({ asin: pickedAsin, productType })}
        />
      )}

      <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-n-500">
            {isAmazon ? 'Product type' : isEbay ? 'eBay category id' : 'Category'}
          </span>
          <input
            value={categoryRef}
            onChange={(e) => setCategoryRef(e.target.value)}
            placeholder={isAmazon ? 'filled in by matching a listing' : isEbay ? 'e.g. 20628' : 'category'}
            className={`input mono h-8 text-[12.5px] ${flag('category')}`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Category name</span>
          <input
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            placeholder="for people, not the API"
            className="input h-8 text-[12.5px]"
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

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-n-500">
            Launch price{row.listing?.currency ? ` (${row.listing.currency})` : ''}
          </span>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="in this marketplace's currency"
            className={`input mono h-8 text-right text-[12.5px] ${flag('price')}`}
          />
          {/* The repricing engine takes over once the offer exists; this is only the opening price. */}
          <span className="text-[11px] text-n-400">What the offer starts at. Repricing manages it afterwards.</span>
        </label>

        {/* Read-only: Availability owns sellable stock for the whole platform, and a per-channel
            number typed here would immediately disagree with what we actually hold. */}
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
            className={`input mono h-8 text-[12.5px] ${flag('handlingTime')}`}
          />
        </label>

        {isOnBuy && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Delivery template</span>
              <input
                value={delivery}
                onChange={(e) => setDelivery(e.target.value)}
                placeholder="OnBuy template name"
                className={`input h-8 text-[12.5px] ${flag('deliveryTemplate')}`}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-n-500">Boost %</span>
              <input
                value={boost}
                onChange={(e) => setBoost(e.target.value)}
                inputMode="decimal"
                className="input mono h-8 text-[12.5px]"
              />
              {/* OnBuy's own default is 20% of revenue. Ours is 0, and anything above the company
                  ceiling is refused by the server rather than warned about. */}
              <span className="text-[11px] text-n-400">0% unless someone decides otherwise. OnBuy defaults this to 20%.</span>
            </label>
          </>
        )}
      </div>

      {isEbay && row.aspectsPending && (
        <div className="rounded-md border border-n-200 bg-n-0 px-2.5 py-2 text-[12px] text-n-600">
          Required item specifics are not checked yet — eBay's per-category schema is read live when
          listing creation is built. Treat this row's readiness as covering everything except aspects.
        </div>
      )}

      {isAmazon && asin && (
        <LaunchPrice productId={productId} integrationId={row.integrationId} price={price} onPriceChange={setPrice} />
      )}

      {isAmazon && asin && <CompetitorPrices productId={productId} integrationId={row.integrationId} />}

      {isAmazon && (
        <AmazonOfferPreview
          productId={productId}
          integrationId={row.integrationId}
          asin={asin}
          quantity={row.quantity.value}
          onListed={onSaved}
          savePlan={() => save.mutateAsync()}
        />
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-teal-500 px-3 text-[12.5px] font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save plan'}
        </button>
        {plan?.status && <span className="text-[11.5px] text-n-400">Status {plan.status}</span>}
        {plan?.externalListingId && (
          <span className="mono text-[11.5px] text-n-500">listing {plan.externalListingId}</span>
        )}
      </div>
    </div>
  );
}
