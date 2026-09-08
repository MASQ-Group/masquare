import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DatePicker, ModalShell, Select } from '@masquare/ui';
import { salesTransactionsApi, shipmentsApi, shippingServicesApi, type Shipment } from '../../lib/api';
import { FedexRatesPanel } from './FedexRatesPanel';

interface Props {
  transactionId: string;
  transactionRef: string;
  /** Shown under the title (channel · company · destination). */
  contextLine?: string;
  /** Default shipping service to pre-select when creating. */
  defaultServiceId?: string | null;
  /** When editing an existing shipment. */
  shipment?: Shipment;
  onClose: () => void;
  onSaved: () => void;
}

/** One parcel of a same-day consignment. */
interface ParcelForm {
  serviceId: string | null;
  tracking: string;
  cost: string;
}

const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
const today = () => new Date().toISOString().slice(0, 10);
const round2 = (v: number) => Number(v.toFixed(2));

export function ShipmentModal({ transactionId, transactionRef, contextLine, defaultServiceId, shipment, onClose, onSaved }: Props) {
  const editing = !!shipment;
  const { data: services = [] } = useQuery({ queryKey: ['shipping-services'], queryFn: () => shippingServicesApi.list() });

  /**
   * The order's own shipping estimate, shown as the cost box's placeholder.
   *
   * The estimate is what profit already uses until an actual cost replaces it, so it is the figure
   * somebody is implicitly checking against when they type one from a despatch note. Having it in
   * front of them turns a blind entry into a comparison — a €40 charge against a €12 estimate is
   * worth a second look, and nothing on the screen said so before.
   *
   * A placeholder rather than a default value, deliberately. Placeholders are not submitted, so an
   * untouched box still saves as "no actual cost recorded" rather than quietly promoting an
   * estimate into an actual — which is the distinction the whole cost review rests on.
   */
  const { data: transaction } = useQuery({
    queryKey: ['sales-transaction', transactionId],
    queryFn: () => salesTransactionsApi.get(transactionId),
    enabled: !!transactionId,
  });
  const estimate = transaction?.estimatedShippingCost ?? null;

  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const touch = () => setDirty(true);

  // Shared across every parcel of this consignment.
  // This modal edits an order shipment. A settled FBA shipment can appear in the log but is not
  // one of those and never reaches here, so it cannot be a starting type.
  const [type, setType] = useState<'outbound' | 'inbound'>(
    shipment?.type === 'inbound' ? 'inbound' : 'outbound',
  );
  const [date, setDate] = useState(shipment ? shipment.shipmentDate.slice(0, 10) : today());
  const [borneBy, setBorneBy] = useState<'company' | 'customer'>(shipment?.costBorneBy ?? 'company');
  const [duty, setDuty] = useState(shipment?.dutyImportEur?.toString() ?? '');
  const [comments, setComments] = useState(shipment?.comments ?? '');
  const [markShipped, setMarkShipped] = useState(true);

  // Per parcel. Editing always targets the one existing shipment, so it stays a single row.
  const [parcels, setParcels] = useState<ParcelForm[]>([
    shipment
      ? { serviceId: shipment.shippingServiceId ?? null, tracking: shipment.trackingNumber ?? '', cost: shipment.shippingCostEur?.toString() ?? '' }
      : { serviceId: defaultServiceId ?? null, tracking: '', cost: '' },
  ]);
  const setParcel = (i: number, patch: Partial<ParcelForm>) => {
    setParcels((r) => r.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
    touch();
  };
  const totalCost = round2(parcels.reduce((s, p) => s + (Number(p.cost) || 0), 0));

  const save = async () => {
    setBusy(true);
    try {
      if (editing) {
        const p = parcels[0];
        await shipmentsApi.update(shipment!.id, {
          type, shipmentDate: date,
          shippingServiceId: p.serviceId,
          trackingNumber: p.tracking.trim() || null,
          shippingCostEur: numOrNull(p.cost),
          costBorneBy: borneBy,
          dutyImportEur: numOrNull(duty),
          comments: comments.trim() || null,
        });
        toast.success('Shipment updated');
      } else {
        const res = await shipmentsApi.createBatch({
          transactionId, type, shipmentDate: date,
          costBorneBy: borneBy,
          dutyImportEur: numOrNull(duty),
          comments: comments.trim() || null,
          markShipped: type === 'outbound' ? markShipped : undefined,
          parcels: parcels.map((p) => ({
            shippingServiceId: p.serviceId,
            trackingNumber: p.tracking.trim() || null,
            shippingCostEur: numOrNull(p.cost),
          })),
        });
        toast.success(res.created === 1 ? 'Shipment recorded' : `${res.created} parcels recorded`);
      }
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      title={editing ? 'Edit shipment' : 'Record shipment'}
      subtitle={contextLine ? `${transactionRef} · ${contextLine}` : transactionRef}
      dirty={dirty}
      primaryLabel={editing ? 'Save shipment' : parcels.length > 1 ? `Record ${parcels.length} parcels` : 'Record shipment'}
      onPrimary={save}
      busy={busy}
      onClose={onClose}
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 items-start gap-4 max-[560px]:grid-cols-1">
          <div>
            <label className="label">Shipment type</label>
            <Select
              value={type}
              onChange={(v) => { setType(v as any); touch(); }}
              options={[{ value: 'outbound', label: 'Outbound (to customer)' }, { value: 'inbound', label: 'Inbound (return / receipt)' }]}
            />
          </div>
          <div><label className="label">Shipment date</label><DatePicker value={date} onChange={(v) => { setDate(v); touch(); }} /></div>
          <div>
            <label className="label">Cost borne by</label>
            <Select
              value={borneBy}
              onChange={(v) => { setBorneBy(v as any); touch(); }}
              options={[{ value: 'company', label: 'Company (our cost)' }, { value: 'customer', label: 'Customer' }]}
            />
          </div>
          <div>
            <label className="label">Duty / import charges <span className="font-normal text-n-400">(€)</span></label>
            <input className="input mono" inputMode="decimal" value={duty} onChange={(e) => { setDuty(e.target.value); touch(); }} placeholder="0.00" />
          </div>
          <div className="col-span-2 max-[560px]:col-span-1">
            <label className="label">Comments</label>
            <input className="input" value={comments} onChange={(e) => { setComments(e.target.value); touch(); }} placeholder="Optional notes" />
          </div>
        </div>

        {/* Parcels — an order too big for one box goes out as several on the same date, each
            with its own carrier, tracking number and cost. */}
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <label className="label mb-0">
              {editing ? 'Shipment' : 'Parcels'}
              {!editing && <span className="ml-2 font-normal text-n-400">all sent on the date above</span>}
            </label>
            {parcels.length > 1 && <span className="mono text-[12px] text-n-500">Total €{totalCost.toFixed(2)}</span>}
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[520px]">
              <div className="grid gap-2.5 border-b border-n-100 px-1 pb-1.5" style={{ gridTemplateColumns: '1fr 1fr 120px 34px' }}>
                {['Shipping service', 'Tracking number', 'Cost (€)'].map((h) => (
                  <div key={h} className="text-[11px] font-semibold uppercase tracking-wide text-n-500">{h}</div>
                ))}
                <div />
              </div>

              {parcels.map((p, i) => (
                <div key={i} className="grid items-center gap-2.5 px-1 py-2" style={{ gridTemplateColumns: '1fr 1fr 120px 34px' }}>
                  <Select
                    value={p.serviceId ?? ''}
                    onChange={(v) => setParcel(i, { serviceId: v || null })}
                    placeholder="—"
                    options={services.map((s) => ({ value: s.id, label: s.name }))}
                  />
                  <input
                    className="input mono"
                    value={p.tracking}
                    onChange={(e) => setParcel(i, { tracking: e.target.value })}
                    placeholder="e.g. 1Z…"
                  />
                  <input
                    className="input mono"
                    inputMode="decimal"
                    value={p.cost}
                    onChange={(e) => setParcel(i, { cost: e.target.value })}
                    /* On the first parcel only: the estimate is for the consignment, and repeating
                       it against each parcel would read as a per-parcel figure it is not. */
                    placeholder={i === 0 && estimate != null ? `est. ${estimate.toFixed(2)}` : '0.00'}
                    title={i === 0 && estimate != null
                      ? `The order's estimated shipping cost is €${estimate.toFixed(2)}. Enter what was actually charged.`
                      : undefined}
                  />
                  {!editing && (
                    <button
                      type="button"
                      title="Remove parcel"
                      disabled={parcels.length === 1}
                      onClick={() => { setParcels((r) => r.filter((_, idx) => idx !== i)); touch(); }}
                      className="grid h-[34px] w-[34px] place-items-center rounded-md border border-n-200 bg-n-0 text-n-500 hover:border-danger-bd hover:bg-danger-bg hover:text-danger disabled:opacity-40"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {!editing && (
            <button
              type="button"
              onClick={() => { setParcels((r) => [...r, { serviceId: defaultServiceId ?? null, tracking: '', cost: '' }]); touch(); }}
              className="mt-2 inline-flex h-9 items-center gap-2 rounded-md border border-dashed border-n-300 bg-n-25 px-3 text-[13px] font-semibold text-teal-700 hover:border-teal-400 hover:bg-teal-50"
            >
              <Plus size={15} /> Add parcel
            </button>
          )}
          {!editing && parcels.length > 1 && (
            <p className="mt-2 text-[11.5px] text-n-400">
              Each parcel is recorded separately, so every tracking number is kept and the costs add up to €{totalCost.toFixed(2)}.
              Duty is charged once for the consignment, not per parcel.
            </p>
          )}

          {/* Outbound only: an inbound return is not something we buy carriage for on this account,
              so quoting one would answer a question nobody asked. The price lands in the FIRST
              parcel's cost box — a quote covers the consignment, and splitting it across parcels
              would be an invented apportionment. */}
          {type === 'outbound' && (
            <FedexRatesPanel
              transactionId={transactionId}
              onUsePrice={(amount) => setParcel(0, { cost: String(round2(amount)) })}
            />
          )}
        </div>

        {!editing && type === 'outbound' && (
          <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-n-200 bg-n-25 px-3 py-2.5">
            <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={markShipped} onChange={(e) => { setMarkShipped(e.target.checked); touch(); }} />
            <span className="text-[13px] text-n-700">
              Mark transaction as <strong>fully shipped</strong> (removes it from the pending worklist).
              <span className="block text-[11.5px] text-n-400">Uncheck if more of this order will ship later — it stays in the worklist so you can add the next shipment.</span>
            </span>
          </label>
        )}

        <p className="rounded-md border border-info-bd bg-info-bg px-3 py-2 text-[12.5px] text-info">
          The actual outbound shipping cost replaces the transaction's calculated estimate in the profit calculation; duty and any company-borne return shipping are added as extra costs.
        </p>
      </div>
    </ModalShell>
  );
}
