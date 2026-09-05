import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, Check, ChevronDown, ChevronRight, Clock, Loader2, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Select } from '@masquare/ui';
import { amazonListingApi, listingApi, type AmazonSweep, type ProductChannelRow } from '../../lib/api';
import { ChannelGroup, SweepResult } from './ChannelGroup';
import { PlanEditor } from './ChannelPlanEditor';
import { useJobProgress } from '../../lib/useJobProgress';
import { CHANNEL_GROUPS, channelGroupOf } from '../../lib/channelGroups';
import { Flag } from '../common/Flag';
import { ProgressButton } from '@masquare/ui';
import { Search } from 'lucide-react';

/**
 * Amazon calls the United Kingdom "UK"; ISO — and therefore the flag set and the grouping tables —
 * calls it "GB". Everything else Amazon sends is already an ISO-2 code.
 */
const isoOf = (marketplace?: string | null): string => {
  const m = (marketplace ?? '').trim().toUpperCase();
  return m === 'UK' ? 'GB' : m;
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

  /**
   * Rows by marketplace family, in the platform's canonical order.
   *
   * The same grouping the Channel Listings page uses, so a channel sits in the same place wherever
   * you meet it. A row whose region cannot be worked out is not dropped — it falls into a group of
   * its own, because a channel that quietly vanishes from this tab is how something goes unlisted.
   */
  const grouped = CHANNEL_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    platform: g.platform,
    rows: data.channels.filter((r) => channelGroupOf({ name: r.name, countryIso: isoOf(r.marketplace) })?.key === g.key),
  })).filter((g) => g.rows.length > 0);

  const placed = new Set(grouped.flatMap((g) => g.rows.map((r) => r.integrationId)));
  const ungrouped = data.channels.filter((r) => !placed.has(r.integrationId));
  const groups = ungrouped.length
    ? [...grouped, { key: 'other', label: 'Other channels', platform: 'other' as const, rows: ungrouped }]
    : grouped;

  const hasAmazon = data.channels.some((c) => c.channelType === 'amazon');

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
        {/* One sweep for the whole tab. It searches every Amazon marketplace at once, so repeating
            the button on each of the four Amazon regions would offer the same action four times. */}
        {hasAmazon && (
          <ProgressButton
            running={sweep.running}
            value={sweep.value}
            detail={sweep.detail}
            onClick={() => sweep.start(() => amazonListingApi.sweep(productId))}
            runningLabel={<><Search size={13} /> Searching</>}
            className="!h-7 !text-[12px]"
            title="Searches every connected Amazon marketplace for this product. Read-only — nothing is listed."
          >
            <Search size={13} /> Search all Amazon
          </ProgressButton>
        )}
      </div>
      <p className="-mt-1.5 text-[11.5px] text-n-400">Nothing here is sent to a channel — this is what we intend to list.</p>

      {/* The sweep answers for every Amazon marketplace at once, so it is reported once — inside a
          region it would repeat the same full result in each of the four. */}
      {sweep.error && (
        <div className="flex items-start gap-2 rounded-lg border border-danger-bd bg-danger-bg px-3.5 py-2 text-[12px] text-danger">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{sweep.error}</span>
        </div>
      )}
      {sweep.running && !sweep.result && (
        <div className="rounded-lg border border-n-200 bg-n-25 px-3.5 py-2 text-[12px] text-n-500">
          Searching each marketplace in turn — {sweep.detail || 'starting…'}
        </div>
      )}
      {sweep.result != null && (
        <div className="overflow-hidden rounded-lg border border-n-200">
          <SweepResult sweep={sweep.result as AmazonSweep} />
        </div>
      )}

      {groups.map(({ key, label, rows }) => (
        <ChannelGroup key={key} label={label} rows={rows}>
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
    /* An open row is a drawer, and says so: a tinted body, a darker header, and a teal edge down
       the left so the eye can find where it starts and ends in a list of eighteen. */
    <div className={`${first ? '' : 'border-t border-n-100'} ${expanded ? 'border-l-2 border-l-teal-400 bg-n-25' : ''}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={`flex w-full flex-wrap items-center gap-2.5 px-3.5 py-2.5 text-left ${
          expanded ? 'bg-n-100' : 'hover:bg-n-25'
        }`}
      >
        {expanded ? <ChevronDown size={14} className="shrink-0 text-n-400" /> : <ChevronRight size={14} className="shrink-0 text-n-400" />}
        {/* The flag says which market at a glance; the group heading above already says which
            platform, so a repeated "AMAZON" chip on every row was saying nothing. */}
        <Flag code={isoOf(row.marketplace)} title={row.name} />
        <span className="text-[13px] font-medium text-n-800">{row.name}</span>

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

      {/* Inset rather than edge-to-edge: the steps are a panel within the row, and running them to
          both edges made them read as a continuation of the list instead of as its contents. */}
      {expanded && (
        <div className="px-3.5 pb-3.5 pt-1">
          <PlanEditor
            row={row}
            productId={productId}
            warnings={warnFindings.map((f) => f.reason)}
            onSaved={onSaved}
          />
        </div>
      )}
    </div>
  );
}
