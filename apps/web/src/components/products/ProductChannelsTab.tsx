import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, Check, ChevronDown, ChevronRight, Clock, Loader2, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Select } from '@masquare/ui';
import { amazonListingApi, listingApi, type AmazonSweep, type ProductChannelRow } from '../../lib/api';
import { ChannelGroup, CHANNEL_TONE } from './ChannelGroup';
import { PlanEditor } from './ChannelPlanEditor';
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
