import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CircleCheck, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { carriersApi, type ShipmentTrackingDetail } from '../../lib/api';
import { formatDate } from '../../lib/format';

/**
 * Ask FedEx about some shipments now, and say what actually happened.
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

/**
 * One shipment's tracking, wherever it is shown.
 *
 * One component rather than three, because it appears in three places — the shipments log, the
 * order summary and the order form — and a journey that reads differently depending on which screen
 * you opened it from is a journey nobody trusts.
 *
 * `compact` is for the 340px column on the order form: the stages and the last scan, without the
 * carrier's small print.
 */
export function TrackingPanel({
  view, onRefresh, refreshing, compact,
}: {
  view: ShipmentTrackingDetail;
  onRefresh?: () => void;
  refreshing?: boolean;
  compact?: boolean;
}) {
  const t = view.tracking;

  if (!view.trackable) {
    return (
      <Note>
        This carrier is not connected, so we cannot ask it where the parcel is. FedEx is the only one
        wired up so far.
      </Note>
    );
  }
  if (!view.trackingNumber) return <Note>No tracking number has been recorded for this shipment.</Note>;
  if (!t) {
    return (
      <div className="flex flex-col gap-2">
        <Note>
          Nobody has asked FedEx about this number yet. Parcels are checked every six hours for their
          first fortnight, then daily.
        </Note>
        {onRefresh && <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />}
      </div>
    );
  }
  if (t.found === false) {
    return (
      <div className="flex flex-col gap-2">
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900">
          <span className="font-semibold">FedEx does not recognise this number.</span> {t.lastError ?? ''}
          {t.failureCount >= 5
            ? ' Asked five times without success, so it is no longer in the sweep — check it against the waybill.'
            : ' If the parcel was booked in the last hour this can be normal; otherwise check it against the waybill.'}
        </p>
        {onRefresh && <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />}
      </div>
    );
  }

  /**
   * An exception is a TASK while the parcel is out and HISTORY once it has arrived.
   *
   * Two thirds of our delivered parcels carry one — mostly "Package available for clearance", which
   * is customs doing its job. Flagging those would train everybody to ignore the flag within a week.
   */
  const held = !t.deliveredAt ? t.exceptionDescription : null;
  const scans = t.scans ?? [];
  const shown = compact ? scans.slice(0, 4) : scans;
  const d = t.detailsJson ?? null;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {t.deliveredAt
            ? <CircleCheck size={16} className="shrink-0 text-teal-600" />
            : <AlertTriangle size={16} className={`shrink-0 ${held ? 'text-amber-600' : 'text-n-400'}`} />}
          <span className="text-[14px] font-semibold text-n-900">{t.statusDescription ?? 'Unknown'}</span>
          <span className="code text-[12px] text-n-500">{view.trackingNumber}</span>
        </div>
        {onRefresh && <RefreshButton onRefresh={onRefresh} refreshing={refreshing} small />}
      </div>

      {held && (
        <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          <AlertTriangle size={15} className="mt-px shrink-0" />
          <span><span className="font-semibold">Held up:</span> {held}</span>
        </p>
      )}

      <Stages view={view} />

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
        {/* Dates only, no clock. These come from stored timestamp columns, which have lost the
            offset of the place the event happened — the timeline below keeps it. */}
        {!t.deliveredAt && t.estimatedDeliveryAt && <Pair k="Due" v={formatDate(t.estimatedDeliveryAt)} />}
        {t.serviceName && <Pair k="Service" v={t.serviceName} />}
        {/* The carrier's own measurement of the box, and the figure they billed on. */}
        {t.weightKg != null && <Pair k="Weighed" v={<>{t.weightKg} kg <span className="text-n-500">by FedEx</span></>} />}
        {!compact && t.shipperReference && <Pair k="Waybill ref" v={<span className="mono">{t.shipperReference}</span>} />}
        {!compact && d?.packageDetails?.packagingDescription?.description && (
          <Pair k="Packaging" v={d.packageDetails.packagingDescription.description} />
        )}
        {!compact && dimensionsOf(d) && <Pair k="Dimensions" v={dimensionsOf(d)} />}
        {!compact && d?.deliveryDetails?.locationDescription && (
          <Pair k="Left at" v={d.deliveryDetails.locationDescription} />
        )}
        {!compact && d?.deliveryDetails?.deliveryAttempts != null && Number(d.deliveryDetails.deliveryAttempts) > 0 && (
          <Pair k="Attempts" v={String(d.deliveryDetails.deliveryAttempts)} />
        )}
        {!compact && handlingOf(d) && <Pair k="Handling" v={handlingOf(d)} />}
      </dl>

      {shown.length > 0 && (
        <div>
          {!compact && (
            <div className="mb-1.5 text-[10.5px] uppercase tracking-wide text-n-400">
              History · times are local to each scan
            </div>
          )}
          <ol>
            {shown.map((s, i) => (
              <li key={`${s.at}-${i}`} className="flex gap-3 border-l border-n-200 pb-2.5 pl-3 last:pb-0">
                <div className="w-[84px] shrink-0 text-[11.5px] text-n-500">
                  <div>{formatDate(s.at)}</div>
                  <div className="mono">{clock(s.at)}</div>
                </div>
                <div className="min-w-0">
                  <div className={`text-[12.5px] ${i === 0 ? 'font-semibold text-n-900' : 'text-n-700'}`}>{s.description}</div>
                  <div className="text-[11.5px] text-n-500">{[s.city, s.countryCode].filter(Boolean).join(', ') || '—'}</div>
                  {s.exceptionDescription && <div className="text-[11.5px] text-amber-700">{s.exceptionDescription}</div>}
                </div>
              </li>
            ))}
          </ol>
          {compact && scans.length > shown.length && (
            <div className="pl-3 pt-1 text-[11.5px] text-n-500">+{scans.length - shown.length} earlier scans</div>
          )}
        </div>
      )}

      <div className="text-[11px] text-n-400">
        {t.checkedAt ? `Last checked ${formatDate(t.checkedAt)}` : ''}
        {/* Said here rather than left to be discovered: proof of delivery is deliberately not held. */}
        {t.deliveredAt ? ' · signature proof of delivery is available in the FedEx portal' : ''}
      </div>
    </div>
  );
}

/**
 * The journey as five steps.
 *
 * A step marked done with no time under it is not a gap in the data — it means a later step
 * happened, so this one must have. That is the honest rendering for parcels tracked before the raw
 * scan type was stored: fewer times, rather than a delivered parcel that apparently never left.
 */
function Stages({ view }: { view: ShipmentTrackingDetail }) {
  if (!view.stages.length) return null;
  return (
    <ol className="flex flex-wrap items-start gap-x-1 gap-y-2">
      {view.stages.map((s, i) => (
        <li key={s.key} className="flex items-start gap-1">
          <div className="flex flex-col items-center gap-1 px-1">
            <span
              className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${
                s.done ? 'bg-teal-600 text-white' : 'border border-dashed border-n-300 text-n-300'
              }`}
            >
              {s.done ? <Check size={12} /> : ''}
            </span>
            <span className={`text-center text-[10.5px] leading-tight ${s.done ? 'text-n-700' : 'text-n-400'}`}>
              {s.label}
            </span>
            <span className="mono text-[10px] text-n-400">{s.at ? formatDate(s.at) : ''}</span>
          </div>
          {i < view.stages.length - 1 && (
            <span className={`mt-[9px] h-px w-4 ${view.stages[i + 1].done ? 'bg-teal-600' : 'bg-n-200'}`} />
          )}
        </li>
      ))}
    </ol>
  );
}

/** The clock part of a carrier timestamp, as it was where the scan happened rather than where we are. */
function clock(iso: string): string {
  const m = iso.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : '';
}

function dimensionsOf(d: any): string | null {
  const dim = d?.packageDetails?.weightAndDimensions?.dimensions;
  const cm = Array.isArray(dim) ? dim.find((x: any) => String(x?.units).toUpperCase() === 'CM') : null;
  return cm ? `${cm.length} × ${cm.width} × ${cm.height} cm` : null;
}

/** Special handling FedEx applied — customs clearance, residential delivery, signature required. */
function handlingOf(d: any): string | null {
  const list = d?.specialHandlings;
  if (!Array.isArray(list) || !list.length) return null;
  return list.map((h: any) => h?.description).filter(Boolean).join(' · ') || null;
}

function Pair({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="text-n-500">{k}</dt>
      <dd className="min-w-0 text-n-800">{v}</dd>
    </>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-n-200 bg-n-25 px-3 py-2.5 text-[12.5px] text-n-600">{children}</p>;
}

function RefreshButton({ onRefresh, refreshing, small }: { onRefresh: () => void; refreshing?: boolean; small?: boolean }) {
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-md border border-n-200 bg-n-0 font-semibold text-n-700 hover:border-teal-300 hover:text-teal-700 disabled:opacity-50 ${
        small ? 'h-7 px-2 text-[11.5px]' : 'h-8 self-start px-2.5 text-[12.5px]'
      }`}
      disabled={refreshing}
      title="Ask FedEx now, whatever the schedule says"
      onClick={onRefresh}
    >
      {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
      {refreshing ? 'Asking…' : 'Refresh'}
    </button>
  );
}
