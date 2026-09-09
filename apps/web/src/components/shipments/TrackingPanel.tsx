import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  carriersApi,
  type DeliveryPromise, type ShipmentTrackingDetail, type ShipmentTrackingScan, type TrackingStatusPill,
} from '../../lib/api';
import { formatDate } from '../../lib/format';

/**
 * Ask the carrier about some shipments now, and say what actually happened.
 *
 * Shared by every surface that offers a Refresh, so they cannot drift apart on the thing that
 * matters most here: a refresh which changed nothing is NOT a success. Reporting one as a success
 * is how an integration that stopped working goes unnoticed for a fortnight, and each of these
 * cases wants a different response from the person who pressed the button.
 */
export function useTrackingRefresh(onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shipmentIds: string[]) => carriersApi.refreshTracking(shipmentIds),
    onSuccess: (r) => {
      if (r.updated) toast.success(r.updated === 1 ? 'Tracking updated' : `Tracking updated for ${r.updated} parcels`);
      else if (r.unaccounted) toast.error('No active production FedEx account for this company — add one in Setup → Carrier accounts.');
      else if (r.failedCalls) toast.error(r.messages[0] ?? 'FedEx could not be reached.');
      // Not a failure and not nothing: FedEx keeps a shipment's history for ninety days after
      // delivery and this one is past that, so pressing again will never help.
      else if (r.outOfRetention) toast.message('FedEx no longer holds a history for this parcel — they keep it for 90 days after delivery.');
      else toast.message('FedEx had nothing new.');
      qc.invalidateQueries({ queryKey: ['shipment-tracking'] });
      qc.invalidateQueries({ queryKey: ['transaction-tracking'] });
      onDone?.();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not reach the carrier'),
  });
}

const PILL_TONE: Record<TrackingStatusPill['tone'], { wrap: string; dot: string }> = {
  neutral: { wrap: 'bg-n-100 text-n-600', dot: 'bg-n-400' },
  teal: { wrap: 'bg-teal-50 text-teal-700', dot: 'bg-teal-500' },
  green: { wrap: 'bg-success-bg text-success', dot: 'bg-green-500' },
  warning: { wrap: 'bg-warning-bg text-warning', dot: 'bg-warning' },
};

/**
 * One parcel's tracking, wherever it is shown.
 *
 * Three stacked cards, per the design: what is happening now with the journey attached, then the
 * carrier's description of the parcel, then the scan history. One component rather than three,
 * because this appears on the shipments log, the order summary and the order form — and a journey
 * that reads differently depending on which screen you opened it from is a journey nobody trusts.
 *
 * `compact` is the 340px column on the order form: the same header card and stepper, without the
 * details ledger and with the history cut to the last few scans.
 */
export function TrackingPanel({
  view, onRefresh, refreshing, refreshFailed, compact,
}: {
  view: ShipmentTrackingDetail;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** The last refresh could not reach the carrier. Shown as a caption; the data below stays. */
  refreshFailed?: boolean;
  compact?: boolean;
}) {
  const t = view.tracking;

  if (!view.trackable) {
    return <Note>{view.carrier ?? 'This carrier'} is not connected, so we cannot ask it where the parcel is. FedEx is the only one wired up so far.</Note>;
  }
  if (!view.trackingNumber) return <Note>No tracking number has been recorded for this shipment.</Note>;
  if (!t) {
    return (
      <div className="flex flex-col gap-2">
        <Note>Nobody has asked FedEx about this number yet. Parcels are checked every six hours for their first fortnight, then daily.</Note>
        {onRefresh && <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />}
      </div>
    );
  }
  if (t.found === false) {
    return (
      <div className="flex flex-col gap-2">
        <p className="rounded-md border border-warning-bd bg-warning-bg px-3 py-2.5 text-[12.5px] text-warning">
          <span className="font-semibold">FedEx does not recognise this number.</span> {t.lastError ?? ''}
          {t.failureCount >= 5
            ? ' Asked five times without success, so it is no longer in the sweep — check it against the waybill.'
            : ' If the parcel was booked in the last hour this can be normal; otherwise check it against the waybill.'}
        </p>
        {onRefresh && <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />}
      </div>
    );
  }

  const delivered = !!t.deliveredAt;
  const scans = t.scans ?? [];

  return (
    <div className={`flex flex-col ${compact ? 'gap-3' : 'gap-4'}`}>
      <div className="overflow-hidden rounded-lg border border-n-200 bg-n-0">
        <HeaderRow
          view={view} delivered={delivered} compact={compact}
          onRefresh={onRefresh} refreshing={refreshing} refreshFailed={refreshFailed}
        />
        <Stepper view={view} compact={compact} />
      </div>

      {/* The carrier's description of the parcel. Dropped in the narrow column, where the journey
          is the whole point and the ledger would push it off the card. */}
      {!compact && <DetailsCard view={view} />}

      <HistoryCard scans={scans} compact={compact} />
    </div>
  );
}

// ------------------------------------------------------------------ header

function HeaderRow({
  view, delivered, compact, onRefresh, refreshing, refreshFailed,
}: {
  view: ShipmentTrackingDetail;
  delivered: boolean;
  compact?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  refreshFailed?: boolean;
}) {
  const t = view.tracking!;
  const pill = view.pill ?? { tone: 'neutral' as const, label: t.statusDescription ?? 'Unknown' };
  const tone = PILL_TONE[pill.tone];

  return (
    <div className="px-5 py-4 max-[767px]:px-4">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3">
        <span className={`inline-flex h-[30px] shrink-0 items-center gap-2 rounded-pill px-3 text-[13px] font-semibold ${tone.wrap}`}>
          <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
          {pill.label}
        </span>

        <TrackingNumber view={view} />

        <div className="flex-1 max-[767px]:hidden" />

        {/* On a narrow screen these wrap to their own line — delivery left, refresh right — which
            is why they share a row of their own rather than sitting inline. */}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-3 max-[767px]:basis-full">
          <ExpectedDelivery promise={view.promise} deliveredAt={t.deliveredAt} />
          {/* Hidden once delivered: there is nothing left for the carrier to tell us, and the sweep
              stops asking for the same reason. */}
          {onRefresh && !delivered && <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />}
        </div>
      </div>

      {/*
        A failed poll never blanks the screen.
        Everything above is the last thing the carrier told us and is still true as of then; saying
        so is more use than an empty card, and the button stays live so it can be tried again.
      */}
      {refreshFailed && (
        <p className="mt-2.5 text-[11.5px] text-warning">
          Couldn’t reach {view.carrier ?? 'the carrier'} — showing the last update
          {t.checkedAt ? ` from ${formatDate(t.checkedAt)}` : ''}.
        </p>
      )}
      {!compact && !refreshFailed && t.checkedAt && (
        <p className="mt-2.5 text-[11.5px] text-n-400">Updated {formatDate(t.checkedAt)}</p>
      )}
    </div>
  );
}

function TrackingNumber({ view }: { view: ShipmentTrackingDetail }) {
  const [copied, setCopied] = useState(false);
  const number = view.trackingNumber!;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(number);
      setCopied(true);
      toast.success('Tracking number copied');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // A browser that refuses the clipboard is not a failure worth a red toast — the number is on
      // screen and can be selected. Say what happened and leave it there.
      toast.message('Could not reach the clipboard — select the number to copy it.');
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-px">
      <span className="text-eyebrow uppercase text-n-400">Tracking{view.carrier ? ` · ${view.carrier}` : ''}</span>
      <span className="flex items-center gap-2">
        {/* A link only where the service carries a tracking URL template. Otherwise plain text —
            a link that goes nowhere is worse than no link. */}
        {view.trackingUrl ? (
          <a
            href={view.trackingUrl}
            target="_blank"
            rel="noreferrer"
            className="code inline-flex items-center gap-1.5 text-[14.5px] font-medium text-n-800 hover:text-teal-700 hover:underline"
            title={`Open on the ${view.carrier ?? 'carrier'} tracking page`}
          >
            {number}
            <ExternalLink size={12} className="shrink-0 text-n-400" />
          </a>
        ) : (
          <span className="code text-[14.5px] font-medium text-n-800">{number}</span>
        )}
        <button
          type="button"
          onClick={copy}
          title="Copy tracking number"
          aria-label="Copy tracking number"
          // Padding, not a bigger icon: the tap target has to clear 44px on a phone while the
          // control still reads as 24px on a desktop.
          className="grid h-6 w-6 shrink-0 place-items-center rounded-sm border border-n-200 bg-n-0 text-n-500 hover:border-teal-300 hover:text-teal-700 max-[767px]:h-11 max-[767px]:w-11"
        >
          {copied ? <Check size={12} className="text-teal-600" /> : <Copy size={12} />}
        </button>
      </span>
    </div>
  );
}

/**
 * When it is due, or when it arrived.
 *
 * Delivered replaces the estimate with the fact, because by then the promise is only interesting
 * beside the actual — and that comparison is made in the details ledger, where there is room to
 * label which of the two it was.
 */
function ExpectedDelivery({ promise, deliveredAt }: { promise: DeliveryPromise | null; deliveredAt: string | null }) {
  const expected = promise?.at ?? null;
  const expectedWindow = expected && promise?.from && formatDate(promise.from) !== formatDate(expected)
    ? `${formatDate(promise.from)} – ${formatDate(expected)}`
    : expected ? formatDate(expected) : null;

  return (
    <div className="flex min-w-0 flex-col items-end gap-px">
      <span className="text-eyebrow uppercase text-n-400">{deliveredAt ? 'Delivered' : 'Expected delivery'}</span>
      {deliveredAt
        ? <span className="mono truncate text-[14.5px] font-semibold text-teal-700">{formatDate(deliveredAt)}</span>
        : expectedWindow
          ? <span className="mono truncate text-[14.5px] font-semibold text-teal-700">{expectedWindow}</span>
          : <span className="text-[14.5px] font-semibold text-n-400">Pending</span>}
      {/*
        The promise stays on screen after the parcel arrives, quietly, under the fact.
        Those two dates together are the only thing that says whether the carrier did what we paid
        for — and that question is asked most often once a delivery is already history.
      */}
      {deliveredAt && expectedWindow && (
        <span className="mono truncate text-[11.5px] text-n-400">
          {promise?.source === 'estimate' ? 'Estimated' : 'Expected'} {expectedWindow}
          {promise?.late === true && <span className="ml-1 font-medium text-warning">late</span>}
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ stepper

/**
 * The journey as five steps.
 *
 * A step marked done with no date under it is not missing data — it means a later step happened, so
 * this one must have. That is the honest rendering for parcels tracked before the raw scan type was
 * stored: fewer dates, rather than a delivered parcel that apparently never left.
 *
 * Empty date slots are never rendered, so the row does not gain a line of blank space per unreached
 * step.
 */
function Stepper({ view, compact }: { view: ShipmentTrackingDetail; compact?: boolean }) {
  if (!view.stages.length) return null;
  const warn = view.pill?.tone === 'warning';
  /**
   * The furthest step reached is "current" — the one the parcel is sitting at right now.
   *
   * Except when the journey is over. A delivered parcel is not "currently delivering": every step
   * including the last is behind it, so nothing is current and the final node fills and ticks like
   * the rest. Without this, an arrived parcel showed a hollow ring on Delivered, which reads as the
   * one thing that has not happened.
   */
  const complete = view.stages[view.stages.length - 1]?.done === true;
  const currentIndex = complete ? -1 : view.stages.reduce((acc, s, i) => (s.done ? i : acc), -1);

  return (
    <div className="grid grid-cols-5 border-t border-n-100 bg-n-25 px-6 pb-[22px] pt-5 max-[767px]:px-3">
      {view.stages.map((s, i) => {
        const current = i === currentIndex;
        const done = s.done && !current;
        const prevDone = i > 0 && view.stages[i - 1].done;
        return (
          <div key={s.key} className="relative flex flex-col items-center gap-2">
            {i > 0 && (
              <span className={`absolute right-1/2 top-[11px] left-0 mr-3 h-0.5 rounded-sm ${prevDone ? 'bg-teal-500' : 'bg-n-200'}`} />
            )}
            {i < view.stages.length - 1 && (
              <span className={`absolute left-1/2 top-[11px] right-0 ml-3 h-0.5 rounded-sm ${s.done ? 'bg-teal-500' : 'bg-n-200'}`} />
            )}
            <span
              className={`relative z-[1] grid h-6 w-6 place-items-center rounded-full ${
                done
                  ? 'bg-teal-500 text-n-0'
                  : current
                    ? `border-2 bg-n-0 ${warn ? 'border-warning' : 'border-teal-500'}`
                    : 'border-2 border-dashed border-n-300 bg-n-50'
              }`}
            >
              {done && <Check size={12} strokeWidth={3} />}
            </span>
            <span
              className={`text-center text-[12.5px] leading-tight ${
                current
                  ? `font-semibold ${warn ? 'text-warning' : 'text-teal-700'}`
                  : s.done ? 'font-medium text-n-800' : 'text-n-400'
              } ${compact && !s.done && i !== currentIndex + 1 ? 'max-[420px]:hidden' : ''}`}
            >
              {s.label}
            </span>
            {s.at && <span className="mono -mt-1 text-[11px] text-n-400">{formatDate(s.at)}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ details

function DetailsCard({ view }: { view: ShipmentTrackingDetail }) {
  const t = view.tracking!;
  const d = t.detailsJson ?? null;
  const promise = view.promise;

  /** A field with no value renders nothing — no dashes, no empty rows. House rule. */
  const rows: Array<{ k: string; v: React.ReactNode }> = [];
  const add = (k: string, v: React.ReactNode | null | undefined) => { if (v) rows.push({ k, v }); };

  add('Service', t.serviceName);
  add('Waybill ref', t.shipperReference ? <span className="code">{t.shipperReference}</span> : null);
  add('Weight', t.weightKg != null
    ? <span className="mono">{t.weightKg} kg <span className="font-normal text-n-400">weighed by FedEx</span></span>
    : null);
  add('Dimensions', dimensionsOf(d) ? <span className="mono">{dimensionsOf(d)}</span> : null);
  add('Packaging', d?.packageDetails?.packagingDescription?.description);
  add('Handling', handlingOf(d));
  add('Pieces', piecesOf(d) ? <span className="mono">{piecesOf(d)}</span> : null);
  add('Route', routeOf(d));
  // The promise and the actual, side by side — the only thing on screen that says whether the
  // carrier did what we paid for.
  add(promise?.source === 'estimate' ? 'Estimated' : 'Committed by', promise?.at
    ? (
      <span className="mono">
        {formatDate(promise.at)}
        {t.deliveredAt && promise.late === true && <span className="ml-1.5 font-medium text-warning">delivered late</span>}
        {t.deliveredAt && promise.late === false && <span className="ml-1.5 font-normal text-n-400">met</span>}
      </span>
    )
    : null);
  add('Collected', t.shippedAt ? <span className="mono">{formatDate(t.shippedAt)}</span> : null);

  if (!rows.length) return null;

  return (
    <div className="rounded-lg border border-n-200 bg-n-0 px-5 py-[18px] max-[767px]:px-4">
      <div className="mb-2.5 text-eyebrow uppercase text-n-400">Shipment details</div>
      <div className="grid grid-cols-2 gap-x-10 max-[767px]:grid-cols-1">
        {rows.map((r) => (
          <div key={r.k} className="grid grid-cols-[120px_1fr] items-baseline border-b border-n-100 px-0.5 py-[9px] text-[13.5px]">
            <span className="text-n-500">{r.k}</span>
            <span className="min-w-0 font-medium text-n-800">{r.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ history

/** Beyond this, the older days fold away — a month of hub scans is not a thing anyone reads. */
const HISTORY_VISIBLE = 12;

function HistoryCard({ scans, compact }: { scans: ShipmentTrackingScan[]; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (!scans.length) {
    return (
      <div className="rounded-lg border border-n-200 bg-n-0 px-5 py-[18px] max-[767px]:px-4">
        <div className="mb-2.5 text-eyebrow uppercase text-n-400">History</div>
        <p className="text-[13.5px] text-n-400">Waiting for the first carrier scan.</p>
      </div>
    );
  }

  const limit = compact ? 4 : HISTORY_VISIBLE;
  const collapsed = !expanded && scans.length > limit;
  const shown = collapsed ? scans.slice(0, limit) : scans;
  const days = groupByDay(shown);

  return (
    <div className="rounded-lg border border-n-200 bg-n-0 px-5 py-[18px] max-[767px]:px-4">
      <div className="mb-3.5 flex items-baseline gap-2.5">
        <span className="text-eyebrow uppercase text-n-400">History</span>
        {!compact && <span className="text-[11.5px] text-n-300">Times are local to each scan</span>}
      </div>

      {days.map((day) => (
        <div key={day.key} className="flex flex-col">
          <div className="flex items-center gap-2.5 pb-2.5 pt-1.5">
            <span className="text-[12px] font-semibold text-n-800">{day.label}</span>
            <span className="mono text-[11px] text-n-400">{day.date}</span>
            <span className="h-px flex-1 bg-n-100" />
          </div>
          {day.events.map((e, i) => {
            const latest = e === scans[0];
            const last = i === day.events.length - 1;
            return (
              <div key={`${e.at}-${i}`} className="grid grid-cols-[52px_20px_1fr] items-start gap-x-2.5">
                <span className="mono pt-0.5 text-right text-[12px] text-n-500">{clock(e.at)}</span>
                <span className="flex flex-col items-center self-stretch">
                  <span className={`mt-1 h-[9px] w-[9px] flex-none rounded-full border-2 ${latest ? 'border-teal-100 bg-teal-500' : 'border-n-100 bg-n-300'}`} />
                  {/* No connector under the last event of a day — the day header below is the break. */}
                  {!last && <span className="mt-[3px] w-0.5 flex-1 rounded-sm bg-n-100" />}
                </span>
                <span className="flex flex-col gap-px pb-4">
                  <span className={`text-[13.5px] text-n-800 ${latest ? 'font-semibold' : ''}`}>{e.description}</span>
                  <span className="text-[12px] text-n-400">
                    {[e.city, e.countryCode].filter(Boolean).join(', ')}
                    {e.exceptionDescription && <span className="text-warning"> · {e.exceptionDescription}</span>}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      ))}

      {collapsed && (
        <button
          type="button"
          className="text-[12.5px] font-semibold text-teal-700 hover:underline"
          onClick={() => setExpanded(true)}
        >
          Show full history ({scans.length - limit} earlier {scans.length - limit === 1 ? 'event' : 'events'})
        </button>
      )}
    </div>
  );
}

/**
 * Group scans into days by the date they carry.
 *
 * By the date STRING, not by converting to the reader's timezone. Each scan is stamped where it
 * happened, and a parcel scanned at 01:05 in Paris belongs to that Paris day — moving it because
 * the reader is two hours east would put the same event under two different headings depending on
 * who was looking.
 */
function groupByDay(scans: ShipmentTrackingScan[]) {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const out: Array<{ key: string; label: string; date: string; events: ShipmentTrackingScan[] }> = [];
  for (const s of scans) {
    const key = s.at.slice(0, 10);
    let group = out.find((g) => g.key === key);
    if (!group) {
      const label = key === iso(today)
        ? 'Today'
        : key === iso(yesterday)
          ? 'Yesterday'
          : new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long' });
      group = { key, label, date: formatDate(s.at), events: [] };
      out.push(group);
    }
    group.events.push(s);
  }
  return out;
}

// ------------------------------------------------------------------ bits

/** The clock part of a carrier timestamp, as it read where the scan happened rather than here. */
function clock(iso: string): string {
  const m = iso.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : '';
}

function dimensionsOf(d: any): string | null {
  const dim = d?.packageDetails?.weightAndDimensions?.dimensions;
  const cm = Array.isArray(dim) ? dim.find((x: any) => String(x?.units).toUpperCase() === 'CM') : null;
  return cm ? `${cm.length} × ${cm.width} × ${cm.height} cm` : null;
}

/** Special handling the carrier applied — customs clearance, residential delivery, a signature. */
function handlingOf(d: any): string | null {
  const list = d?.specialHandlings;
  if (!Array.isArray(list) || !list.length) return null;
  return list.map((h: any) => h?.description).filter(Boolean).join(' · ') || null;
}

/** Only worth a row when the consignment is more than one box. */
function piecesOf(d: any): string | null {
  const n = Number(d?.packageDetails?.count);
  return Number.isFinite(n) && n > 1 ? String(n) : null;
}

function routeOf(d: any): string | null {
  const place = (a: any) => [a?.city, a?.countryCode].filter(Boolean).join(', ');
  const from = place(d?.shipperInformation?.address);
  const to = place(d?.recipientInformation?.address);
  return from && to ? `${from} → ${to}` : null;
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-n-200 bg-n-25 px-4 py-3 text-[13px] text-n-600">{children}</p>;
}

function RefreshButton({ onRefresh, refreshing }: { onRefresh: () => void; refreshing?: boolean }) {
  return (
    <button
      type="button"
      className="inline-flex h-[34px] shrink-0 items-center gap-[7px] rounded-md border border-n-200 bg-n-0 px-3.5 text-[13px] font-medium text-n-800 hover:border-teal-300 hover:text-teal-700 disabled:opacity-50"
      disabled={refreshing}
      title="Ask the carrier now, whatever the schedule says"
      onClick={onRefresh}
    >
      {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
      {refreshing ? 'Refreshing…' : 'Refresh'}
    </button>
  );
}
