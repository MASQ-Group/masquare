import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { ProgressButton } from '@masquare/ui';
import type { AmazonSweep, AmazonSweepRow, ProductChannelRow } from '../../lib/api';

/** Channel identity, kept clear of the semantic colours so a chip never reads as a status. */
export const CHANNEL_TONE: Record<string, string> = {
  amazon: 'bg-amber-50 text-amber-700 border-amber-200',
  ebay: 'bg-blue-50 text-blue-700 border-blue-200',
  onbuy: 'bg-teal-50 text-teal-700 border-teal-200',
};

const GROUP_LABEL: Record<string, string> = { amazon: 'Amazon', ebay: 'eBay', onbuy: 'OnBuy' };

/**
 * One marketplace family, collapsed to a single heading.
 *
 * Eighteen Amazon rows next to one eBay row read as eighteen unrelated channels rather than one
 * marketplace we sell on in eighteen countries. Grouping restores that, and gives the family-wide
 * search somewhere to live.
 */
export function ChannelGroup({
  channelType, rows, sweep, children,
}: {
  channelType: string;
  rows: ProductChannelRow[];
  /** Only Amazon has a per-country catalogue, so only Amazon gets a sweep. */
  sweep?: {
    running: boolean;
    value: number | null;
    detail: string;
    result: AmazonSweep | null;
    /** A failed sweep has to say so — silence reads as "nothing found", which is a different answer. */
    error: string | null;
    onRun: () => void;
  };
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);

  const listed = rows.filter((r) => r.listing).length;
  const blocked = rows.filter((r) => !r.eligibility.eligible).length;
  const ready = rows.filter((r) => r.readiness.ready && r.eligibility.eligible).length;

  return (
    <div className="overflow-hidden rounded-lg border border-n-200">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-n-200 bg-n-25 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-2 text-left"
        >
          {open ? <ChevronDown size={15} className="text-n-400" /> : <ChevronRight size={15} className="text-n-400" />}
          <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase ${CHANNEL_TONE[channelType] ?? 'border-n-200 bg-n-50 text-n-600'}`}>
            {GROUP_LABEL[channelType] ?? channelType}
          </span>
          <span className="text-[12.5px] text-n-500">
            {rows.length} marketplace{rows.length === 1 ? '' : 's'}
          </span>
        </button>

        {/* Counted before anything else: listing something twice is worse than not listing it. */}
        {listed > 0 && <span className="text-[12px] font-semibold text-teal-700">{listed} already listed</span>}
        {ready > 0 && <span className="text-[12px] text-n-600">{ready} ready</span>}
        {blocked > 0 && <span className="text-[12px] text-danger">{blocked} blocked</span>}

        <div className="flex-1" />

        {sweep && (
          <ProgressButton
            running={sweep.running}
            value={sweep.value}
            detail={sweep.detail}
            onClick={sweep.onRun}
            runningLabel={<><Search size={13} /> Searching</>}
            className="!h-7 !text-[12px]"
            title="Searches every connected Amazon marketplace for this product. Read-only — nothing is listed."
          >
            <Search size={13} /> Search all {GROUP_LABEL[channelType] ?? channelType}
          </ProgressButton>
        )}
      </div>

      {sweep?.error && (
        <div className="flex items-start gap-2 border-b border-danger-bd bg-danger-bg px-3 py-2 text-[12px] text-danger">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{sweep.error}</span>
        </div>
      )}

      {/* While it runs, say so here as well as on the button: the search takes about a minute and
          the button alone is easy to lose track of on a long tab. */}
      {sweep?.running && !sweep.result && (
        <div className="border-b border-n-100 bg-n-25 px-3 py-2 text-[12px] text-n-500">
          Searching each marketplace in turn — {sweep.detail || 'starting…'}
        </div>
      )}

      {sweep?.result && <SweepResult sweep={sweep.result} />}

      {open && <div>{children}</div>}
    </div>
  );
}

/**
 * Where this product exists across a marketplace family, at a glance.
 *
 * A chip per marketplace, coloured by what you can actually do there. The point is to answer
 * "where can we sell this" without opening eighteen rows.
 */
function SweepResult({ sweep }: { sweep: AmazonSweep }) {
  const { summary } = sweep;
  // Ordered by what you would act on: already ours, then what we could take, then what stands in
  // the way, then the ones we could not answer for.
  const order = (r: AmazonSweepRow) =>
    r.alreadyListed ? 0
    : r.found && r.restricted === false ? 1
    : r.restricted === true ? 2
    : r.found ? 3
    : 4;
  const sorted = [...sweep.results].sort((a, b) => order(a) - order(b) || a.marketplace.localeCompare(b.marketplace));

  return (
    <div className="border-b border-n-100 bg-n-0 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        <span className="font-semibold text-n-800">Searched {summary.searched} marketplaces</span>
        {summary.alreadyListed > 0 && (
          <span className="text-teal-700"><b>{summary.alreadyListed}</b> already listed</span>
        )}
        {/* The only figure here that is an opportunity, so it is the only one phrased as one. */}
        <span className="text-green-700"><b>{summary.sellable}</b> new to list</span>
        {summary.restricted > 0 && <span className="text-danger"><b>{summary.restricted}</b> need approval</span>}
        {summary.notFound > 0 && <span className="text-n-500"><b>{summary.notFound}</b> not in the catalogue</span>}
        {summary.failed > 0 && <span className="text-amber-700"><b>{summary.failed}</b> could not be checked</span>}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {sorted.map((r) => <SweepChip key={r.integrationId} row={r} />)}
      </div>
    </div>
  );
}

function SweepChip({ row }: { row: AmazonSweepRow }) {
  // Five answers, and none of them may collapse into another. Already selling there is not the same
  // as free to list; "not in Amazon's catalogue" is not the same as "we need approval"; and neither
  // is the same as "we could not tell". Solid teal for ours, outlined green for an opening — a
  // filled chip reads as settled, an outlined one as available.
  const tone =
    row.alreadyListed ? 'border-teal-500 bg-teal-500 text-white'
    : row.found && row.restricted === false ? 'border-green-300 bg-green-50 text-green-700'
    : row.restricted === true ? 'border-danger-bd bg-danger-bg text-danger'
    : row.found ? 'border-amber-200 bg-amber-50 text-amber-800'
    : 'border-n-200 bg-n-50 text-n-400';

  const title =
    row.alreadyListed ? `Already listed as ${row.listedSku ?? 'this product'} — nothing to do here`
    : row.found && row.restricted === false ? `${row.asin} — we can list here`
    : row.restricted === true ? `${row.asin} — ${row.restrictionReason ?? 'approval needed'}`
    : row.found ? `${row.asin} — could not check restrictions`
    : row.error ?? 'Not in this marketplace catalogue';

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11.5px] font-semibold ${tone}`}
    >
      {row.marketplace || row.name}
      {row.alreadyListed && <span className="font-normal opacity-90">listed</span>}
      {!row.alreadyListed && row.restricted === true && <span className="font-normal">approval</span>}
      {!row.alreadyListed && !row.found && <span className="font-normal">—</span>}
    </span>
  );
}
