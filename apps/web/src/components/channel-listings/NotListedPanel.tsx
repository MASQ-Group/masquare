import { Ban, Lock, Search, TrendingDown, TrendingUp } from 'lucide-react';
import type { AmazonSweepRow, ProductChannelRow } from '../../lib/api';

const SYMBOL: Record<string, string> = { EUR: '€', GBP: '£', USD: '$', CAD: 'CA$', AUD: 'A$', JPY: '¥', SEK: 'kr', PLN: 'zł', AED: 'AED ', SAR: 'SAR ', MXN: 'MX$', TRY: '₺', INR: '₹', BRL: 'R$', ZAR: 'R', SGD: 'S$' };
const money = (cents: number, currency = 'EUR') =>
  `${SYMBOL[currency] ?? `${currency} `}${(cents / 100).toFixed(currency === 'JPY' ? 0 : 2)}`;

/**
 * A channel this product is not on yet, and whether it is worth going there.
 *
 * The button is only live when listing is actually possible. Offering it against a brand we are not
 * approved for, or an ASIN Amazon does not hold, produces a form that cannot succeed — and a person
 * who fills one in twice stops trusting the rest of the screen.
 */
export function NotListedPanel({
  channelName, integrationId, plan, sweep, analysed, onList,
}: {
  channelName: string;
  integrationId: string | null;
  /** Readiness and eligibility for this channel. Absent while it loads. */
  plan: ProductChannelRow | null;
  /** The competitive read, once the analysis has run. */
  sweep: AmazonSweepRow | null;
  analysed: boolean;
  onList: (integrationId: string) => void;
}) {
  // Four reasons the button stays down, and each says which one applies. "Disabled" without a
  // reason is the least useful control there is.
  const blocked = plan && !plan.eligibility.eligible;
  const blockReason = blocked
    ? plan.eligibility.findings.filter((f) => f.severity === 'block').map((f) => f.reason)[0] ?? 'Not permitted on this marketplace'
    : null;
  const restricted = sweep?.restricted === true;
  const notInCatalogue = analysed && sweep != null && !sweep.found;

  const canList = !!integrationId && !blocked && !restricted && !notInCatalogue;

  return (
    <div className="flex flex-col items-stretch gap-2.5 px-4 py-5">
      <div className="text-center text-[13px] text-n-500">Not listed on {channelName} yet.</div>

      {/* The competitive read, when we have one: the number that decides whether to bother. */}
      {sweep?.competitive != null && sweep.featuredPriceCents != null && (
        <div
          className={`flex flex-col gap-0.5 rounded-md border px-2.5 py-2 text-[12px] ${
            sweep.competitive ? 'border-green-300 bg-green-50 text-green-800' : 'border-danger-bd bg-danger-bg text-danger'
          }`}
          title="Judged against the offer that currently wins the Buy Box — the price that actually takes the sales."
        >
          <span className="inline-flex items-center gap-1.5 font-semibold">
            {sweep.competitive ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {sweep.competitive ? 'Competitive here' : 'Cannot compete here'}
          </span>
          <span className="text-[11.5px]">
            Featured offer {money(sweep.featuredPriceCents)} ·{' '}
            {sweep.featuredProfitCents != null
              ? `${sweep.competitive ? '' : '−'}${money(Math.abs(sweep.featuredProfitCents))} at that price`
              : 'profit unknown'}
            {sweep.featuredMarginPct != null && ` · ${sweep.featuredMarginPct}%`}
          </span>
        </div>
      )}

      {restricted && (
        <div className="flex items-start gap-1.5 rounded-md border border-danger-bd bg-danger-bg px-2.5 py-2 text-[12px] text-danger">
          <Lock size={12} className="mt-0.5 shrink-0" />
          <span>{sweep?.restrictionReason ?? 'Approval needed to list in this brand'}</span>
        </div>
      )}
      {notInCatalogue && !restricted && (
        <div className="flex items-start gap-1.5 rounded-md border border-n-200 bg-n-25 px-2.5 py-2 text-[12px] text-n-600">
          <Search size={12} className="mt-0.5 shrink-0 text-n-400" />
          <span>Amazon has no catalogue entry for this product here, so there is no listing to offer on.</span>
        </div>
      )}
      {blocked && (
        <div className="flex items-start gap-1.5 rounded-md border border-danger-bd bg-danger-bg px-2.5 py-2 text-[12px] text-danger">
          <Ban size={12} className="mt-0.5 shrink-0" />
          <span>{blockReason}</span>
        </div>
      )}

      <button
        type="button"
        disabled={!canList}
        onClick={() => integrationId && onList(integrationId)}
        title={
          canList ? `Prepare and create a listing on ${channelName}`
            : blocked ? blockReason ?? undefined
            : restricted ? 'Approval needed for this brand'
            : notInCatalogue ? 'No catalogue entry to offer on'
            : 'This channel is not connected'
        }
        className="h-9 rounded-md bg-teal-500 px-4 text-[13px] font-semibold text-white hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-n-200 disabled:text-n-500"
      >
        + List on {channelName}
      </button>

      {!analysed && !blocked && (
        <span className="text-center text-[11px] text-n-400">
          Run “Check all Amazon channels” above to see whether this one is worth listing on.
        </span>
      )}
    </div>
  );
}
