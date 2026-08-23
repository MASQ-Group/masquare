import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, Check, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Select } from '@masquare/ui';
import { listingApi, type ProductChannelRow } from '../../lib/api';

/** Channel identity, kept clear of the semantic colours so a channel chip never reads as a status. */
const CHANNEL_TONE: Record<string, string> = {
  amazon: 'bg-amber-50 text-amber-700 border-amber-200',
  ebay: 'bg-blue-50 text-blue-700 border-blue-200',
  onbuy: 'bg-teal-50 text-teal-700 border-teal-200',
};

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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-n-200 bg-n-25 px-3.5 py-2.5 text-[12.5px]">
        <span className="font-semibold text-n-800">{summary.total} connected channel{summary.total === 1 ? '' : 's'}</span>
        <span className="text-teal-700"><b>{summary.ready}</b> ready to list</span>
        {summary.blocked > 0 && <span className="text-danger"><b>{summary.blocked}</b> blocked</span>}
        <div className="flex-1" />
        <span className="text-[11.5px] text-n-400">Nothing here is sent to a channel — this is what we intend to list.</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-n-200">
        {data.channels.map((row, i) => (
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
      </div>
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

        {blocked ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-danger">
            <Ban size={13} /> Blocked
          </span>
        ) : row.readiness.ready ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-teal-700">
            <Check size={13} /> Ready to list
          </span>
        ) : (
          <span className="text-[12px] text-n-500">
            Needs {row.readiness.missing.filter((m) => m.severity === 'required').map((m) => m.label.toLowerCase()).join(', ') || 'nothing'}
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

function PlanEditor({
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

  const isEbay = row.channelType === 'ebay';
  const isOnBuy = row.channelType === 'onbuy';

  const save = useMutation({
    mutationFn: () =>
      listingApi.upsertPlan(productId, row.integrationId, {
        categoryRef: categoryRef.trim() || null,
        categoryName: categoryName.trim() || null,
        condition,
        handlingTimeDays: handling.trim() === '' ? null : Number(handling),
        deliveryTemplate: delivery.trim() || null,
        boostPct: Number(boost || 0),
      }),
    onSuccess: () => { toast.success('Saved'); onSaved(); },
    // The boost ceiling is enforced server-side, so its refusal arrives here as the message.
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
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

      <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-n-500">
            {row.channelType === 'amazon' ? 'Product type' : isEbay ? 'eBay category id' : 'Category'}
          </span>
          <input
            value={categoryRef}
            onChange={(e) => setCategoryRef(e.target.value)}
            placeholder={row.channelType === 'amazon' ? 'e.g. COOKWARE' : isEbay ? 'e.g. 20628' : 'category'}
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
