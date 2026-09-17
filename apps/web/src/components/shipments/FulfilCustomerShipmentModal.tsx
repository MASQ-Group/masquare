import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ModalShell, Select } from '@masquare/ui';
import { customerShipmentsApi, shippingServicesApi, type CustomerShipment } from '../../lib/api';

/**
 * Recording what we booked for a customer.
 *
 * Today somebody books on the carrier's own site and types the result here. When FedEx and Cyprus
 * Post can be booked from the platform this is where that happens instead — which is why it asks
 * "what was booked" rather than "what shall we book", and why nothing here is a quote.
 *
 * Two amounts, and the screen says which is which in plain words. The cost is ours and the customer
 * never sees it; the charge is theirs and appears on their screen the moment this is saved.
 */
export function FulfilCustomerShipmentModal({ shipment, onClose }: { shipment: CustomerShipment; onClose: () => void }) {
  const qc = useQueryClient();
  const amending = shipment.status === 'FULFILLED';

  const [serviceId, setServiceId] = useState(shipment.shippingServiceId ?? '');
  const [tracking, setTracking] = useState(shipment.trackingNumber ?? '');
  const [shippedAt, setShippedAt] = useState((shipment.shippedAt ?? new Date().toISOString()).slice(0, 10));
  const [cost, setCost] = useState(shipment.costCents != null ? (shipment.costCents / 100).toFixed(2) : '');
  const [charge, setCharge] = useState(shipment.chargeCents != null ? (shipment.chargeCents / 100).toFixed(2) : '');
  const [currency, setCurrency] = useState(shipment.chargeCurrency || 'EUR');
  const [dirty, setDirty] = useState(false);
  const touch = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDirty(true); };

  const { data: services = [] } = useQuery({ queryKey: ['shipping-services'], queryFn: () => shippingServicesApi.list() });

  const cents = (v: string) => {
    const n = Number(v.trim().replace(',', '.'));
    return v.trim() === '' ? null : Number.isFinite(n) ? Math.round(n * 100) : null;
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        shippingServiceId: serviceId || null,
        trackingNumber: tracking.trim(),
        shippedAt: shippedAt || null,
        costCents: cents(cost),
        chargeCents: cents(charge),
        chargeCurrency: currency,
      };
      return amending ? customerShipmentsApi.amend(shipment.id, body) : customerShipmentsApi.fulfil(shipment.id, body);
    },
    onSuccess: () => {
      toast.success(amending ? `${shipment.reference} updated` : `${shipment.reference} marked as sent`);
      qc.invalidateQueries({ queryKey: ['customer-shipments'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save', { duration: 9000 }),
  });

  const field = 'input';
  const label = 'label';
  const ready = !!serviceId && tracking.trim().length > 0 && !save.isPending;

  return (
    <ModalShell
      open
      title={`${amending ? 'Amend' : 'Fulfil'} ${shipment.reference}`}
      subtitle={`${shipment.customer.name} · ${shipment.parcels.length} parcel${shipment.parcels.length === 1 ? '' : 's'} to ${[shipment.toCity, shipment.toCountryIso].filter(Boolean).join(', ') || 'their recipient'}`}
      dirty={dirty}
      primaryLabel={save.isPending ? 'Saving…' : amending ? 'Save changes' : 'Mark as sent'}
      primaryDisabled={!ready}
      onPrimary={() => save.mutate()}
      onClose={onClose}
      initialSize={{ w: 720, h: 520 }}
    >
      <div className="space-y-5 p-1">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={label}>Carrier</span>
            <Select
              searchable
              value={serviceId}
              onChange={touch(setServiceId)}
              options={[{ value: '', label: '— choose a carrier —' }, ...services.map((s) => ({ value: s.id, label: s.name }))]}
            />
            <span className="mt-1 block text-[11.5px] text-n-500">The same list our own shipments use, so the customer gets a working tracking link.</span>
          </label>
          <label className="block">
            <span className={label}>Tracking number</span>
            <input className={`${field} mono`} value={tracking} onChange={(e) => touch(setTracking)(e.target.value)} placeholder="As the carrier gave it" />
            <span className="mt-1 block text-[11.5px] text-n-500">Required: it is the whole of what the customer gets back from this.</span>
          </label>
          <label className="block">
            <span className={label}>Sent on</span>
            <input type="date" className={field} value={shippedAt} onChange={(e) => touch(setShippedAt)(e.target.value)} />
          </label>
        </div>

        <div className="rounded-lg border border-n-100 bg-n-25 p-4">
          <div className="mb-3 text-[13px] font-semibold text-n-800">Money</div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className={label}>What it cost us</span>
              <input className={`${field} mono`} value={cost} onChange={(e) => touch(setCost)(e.target.value)} placeholder="0.00" inputMode="decimal" />
              <span className="mt-1 block text-[11.5px] text-orange-800">Ours only. The customer never sees this.</span>
            </label>
            <label className="block">
              <span className={label}>What they pay</span>
              <input className={`${field} mono`} value={charge} onChange={(e) => touch(setCharge)(e.target.value)} placeholder="0.00" inputMode="decimal" />
              <span className="mt-1 block text-[11.5px] text-n-500">Appears on their screen once saved.</span>
            </label>
            <label className="block">
              <span className={label}>Currency</span>
              <Select
                value={currency}
                onChange={touch(setCurrency)}
                options={['EUR', 'GBP', 'USD'].map((c) => ({ value: c, label: c }))}
              />
            </label>
          </div>
          {cents(cost) != null && cents(charge) != null && (
            <p className={`mt-3 text-[12px] ${(cents(charge) as number) < (cents(cost) as number) ? 'text-orange-800' : 'text-n-600'}`}>
              {(cents(charge) as number) < (cents(cost) as number)
                ? `That charge is below what it cost us by ${(((cents(cost) as number) - (cents(charge) as number)) / 100).toFixed(2)}.`
                : `Margin ${(((cents(charge) as number) - (cents(cost) as number)) / 100).toFixed(2)} ${currency}.`}
            </p>
          )}
        </div>

        <div>
          <div className="mb-1.5 text-[13px] font-semibold text-n-800">What they asked for</div>
          <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1 text-[12.5px]">
            <dt className="text-n-500">Collect from</dt>
            <dd className="text-n-700">{[shipment.fromCompany || shipment.fromName, shipment.fromCity, shipment.fromCountryIso].filter(Boolean).join(', ') || '—'}</dd>
            <dt className="text-n-500">Deliver to</dt>
            <dd className="text-n-700">{[shipment.toCompany || shipment.toName, shipment.toLine1, shipment.toCity, shipment.toPostalCode, shipment.toCountryIso].filter(Boolean).join(', ') || '—'}</dd>
            <dt className="text-n-500">Goods</dt>
            <dd className="text-n-700">
              {shipment.goodsDescription ?? '—'}
              {shipment.goodsValue ? <span className="text-n-500"> · declared {shipment.goodsValue} {shipment.goodsCurrency ?? ''}</span> : null}
            </dd>
            <dt className="text-n-500">Parcels</dt>
            <dd className="text-n-700">
              {shipment.parcels.map((p, i) => (
                <span key={p.id} className="mono">
                  {i > 0 ? ' · ' : ''}{Number(p.weightKg)}kg
                  {p.lengthCm && p.widthCm && p.heightCm ? ` ${Number(p.lengthCm)}×${Number(p.widthCm)}×${Number(p.heightCm)}cm` : ''}
                </span>
              ))}
            </dd>
            {shipment.notes && (<><dt className="text-n-500">Their note</dt><dd className="text-n-700">{shipment.notes}</dd></>)}
          </dl>
        </div>
      </div>
    </ModalShell>
  );
}
