import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ModalShell } from '@masquare/ui';
import { shipmentsApi, shippingServicesApi, type Shipment } from '../../lib/api';

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

const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
const today = () => new Date().toISOString().slice(0, 10);

export function ShipmentModal({ transactionId, transactionRef, contextLine, defaultServiceId, shipment, onClose, onSaved }: Props) {
  const editing = !!shipment;
  const { data: services = [] } = useQuery({ queryKey: ['shipping-services'], queryFn: () => shippingServicesApi.list() });

  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const touch = () => setDirty(true);

  const [type, setType] = useState<'outbound' | 'inbound'>(shipment?.type ?? 'outbound');
  const [date, setDate] = useState(shipment ? shipment.shipmentDate.slice(0, 10) : today());
  const [serviceId, setServiceId] = useState<string | null>(shipment?.shippingServiceId ?? defaultServiceId ?? null);
  const [tracking, setTracking] = useState(shipment?.trackingNumber ?? '');
  const [cost, setCost] = useState(shipment?.shippingCostEur?.toString() ?? '');
  const [borneBy, setBorneBy] = useState<'company' | 'customer'>(shipment?.costBorneBy ?? 'company');
  const [duty, setDuty] = useState(shipment?.dutyImportEur?.toString() ?? '');
  const [comments, setComments] = useState(shipment?.comments ?? '');
  const [markShipped, setMarkShipped] = useState(true);

  const save = async () => {
    setBusy(true);
    try {
      const body: any = {
        type, shipmentDate: date,
        shippingServiceId: serviceId,
        trackingNumber: tracking.trim() || null,
        shippingCostEur: numOrNull(cost),
        costBorneBy: borneBy,
        dutyImportEur: numOrNull(duty),
        comments: comments.trim() || null,
      };
      if (editing) {
        await shipmentsApi.update(shipment!.id, body);
      } else {
        await shipmentsApi.create({ ...body, transactionId, markShipped: type === 'outbound' ? markShipped : undefined });
      }
      toast.success(editing ? 'Shipment updated' : 'Shipment recorded');
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
      primaryLabel={editing ? 'Save shipment' : 'Record shipment'}
      onPrimary={save}
      busy={busy}
      onClose={onClose}
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
          <div>
            <label className="label">Shipment type</label>
            <select className="input" value={type} onChange={(e) => { setType(e.target.value as any); touch(); }}>
              <option value="outbound">Outbound (to customer)</option>
              <option value="inbound">Inbound (return / receipt)</option>
            </select>
          </div>
          <div><label className="label">Shipment date</label><input type="date" className="input mono" value={date} onChange={(e) => { setDate(e.target.value); touch(); }} /></div>
          <div>
            <label className="label">Shipping service</label>
            <select className="input" value={serviceId ?? ''} onChange={(e) => { setServiceId(e.target.value || null); touch(); }}>
              <option value="">—</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div><label className="label">Tracking number</label><input className="input mono" value={tracking} onChange={(e) => { setTracking(e.target.value); touch(); }} placeholder="e.g. 1Z…" /></div>
          <div>
            <label className="label">Shipping cost <span className="font-normal text-n-400">(exc. VAT, €)</span></label>
            <input className="input mono" inputMode="decimal" value={cost} onChange={(e) => { setCost(e.target.value); touch(); }} placeholder="0.00" />
          </div>
          <div>
            <label className="label">Cost borne by</label>
            <select className="input" value={borneBy} onChange={(e) => { setBorneBy(e.target.value as any); touch(); }}>
              <option value="company">Company (our cost)</option>
              <option value="customer">Customer</option>
            </select>
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

        {!editing && type === 'outbound' && (
          <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-n-200 bg-n-25 px-3 py-2.5">
            <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={markShipped} onChange={(e) => { setMarkShipped(e.target.checked); touch(); }} />
            <span className="text-[13px] text-n-700">
              Mark transaction as <strong>fully shipped</strong> (removes it from the pending worklist).
              <span className="block text-[11.5px] text-n-400">Uncheck if more items from this order will ship separately.</span>
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
