import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { portalApi, type PortalShipment } from '../lib/api';
import { useConfirm } from '../components/ConfirmProvider';
import { PORTAL_COUNTRIES, ShipmentFormFields, emptyCollection, emptyForm, type FormState } from './ShipmentFormFields';
import { toPayload } from './PortalNewShipmentPage';
import { portalStatus } from './PortalShipmentsPage';
import { TrackingPanel } from '../components/shipments/TrackingPanel';

/**
 * One shipment, from the customer's side.
 *
 * Reads as a record until it needs to be acted on. While it is still with us it can be corrected or
 * withdrawn; once we have booked it, the details are on a label and the page says so rather than
 * offering buttons that would be refused.
 */
export function PortalShipmentPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<FormState | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const { data: home } = useQuery({ queryKey: ['portal', 'home'], queryFn: portalApi.home });
  const { data: products } = useQuery({ queryKey: ['portal', 'products'], queryFn: portalApi.products });
  const { data: s, isLoading } = useQuery({ queryKey: ['portal', 'shipment', id], queryFn: () => portalApi.get(id), enabled: !!id });

  const refresh = () => qc.invalidateQueries({ queryKey: ['portal'] });
  const failed = (e: any) => {
    const message = e?.response?.data?.message ?? 'That did not work.';
    setProblems(String(message).split(/(?<=\.)\s+/).filter(Boolean));
    toast.error('Could not save');
  };

  const save = useMutation({
    mutationFn: (resubmit: boolean) => portalApi.update(id, { ...toPayload(editing!), resubmit }),
    onSuccess: (updated) => {
      toast.success(updated.status === 'SUBMITTED' && s?.status === 'NEEDS_INFO' ? 'Sent back to maSquare' : 'Shipment updated');
      setEditing(null);
      setProblems([]);
      refresh();
    },
    onError: failed,
  });
  const cancel = useMutation({
    mutationFn: () => portalApi.cancel(id),
    onSuccess: () => { toast.success('Shipment cancelled'); refresh(); },
    onError: failed,
  });
  const archive = useMutation({
    mutationFn: () => portalApi.archive(id),
    onSuccess: () => { toast.success('Archived'); refresh(); navigate('/portal'); },
    onError: failed,
  });

  if (isLoading) return <p className="text-[13px] text-n-500">Loading…</p>;
  if (!s) return <p className="text-[13px] text-n-500">This shipment could not be found.</p>;

  const state = portalStatus(s);
  const pending = s.status === 'SUBMITTED' || s.status === 'NEEDS_INFO';
  const money = (amount: number, currency: string) => `${currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : `${currency} `}${amount.toFixed(2)}`;

  return (
    <div className="flex flex-col gap-4">
      <Link to="/portal" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-n-600 hover:text-n-800">
        <ArrowLeft size={15} /> All shipments
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mono text-[20px] font-semibold text-n-900">{s.reference}</h1>
        <span className={`tag ${state.tone}`}>{state.label}</span>
        <div className="flex-1" />
        <span className="text-[12.5px] text-n-500">Filed {new Date(s.createdAt).toLocaleDateString()}</span>
      </div>

      {s.status === 'NEEDS_INFO' && s.infoRequest && (
        <div className="rounded-lg border border-warning-bd bg-warning-bg p-4">
          <p className="text-[13px] font-semibold text-warning">maSquare needs something from you</p>
          <p className="mt-1 text-[13px] text-warning">{s.infoRequest}</p>
          {!editing && (
            <button type="button" className="btn btn-primary mt-3" onClick={() => setEditing(formFrom(s))}>Answer and resend</button>
          )}
        </div>
      )}

      {problems.length > 0 && (
        <div className="rounded-lg border border-warning-bd bg-warning-bg p-4">
          <ul className="ml-4 list-disc text-[12.5px] text-warning">
            {problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}

      {editing ? (
        <>
          <ShipmentFormFields form={editing} setForm={setEditing} batteryTypes={home?.batteryTypes ?? []} products={products ?? []} countrySource={PORTAL_COUNTRIES} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate(s.status === 'NEEDS_INFO')}>
              {save.isPending ? 'Saving…' : s.status === 'NEEDS_INFO' ? 'Send back to maSquare' : 'Save changes'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { setEditing(null); setProblems([]); }}>Discard changes</button>
          </div>
        </>
      ) : (
        <>
          {/* Where it is, first: it is the question somebody opens this page to ask. */}
          {(s.carrier || s.trackingNumber) && (
            <section className="flex flex-col gap-4">
              <h2 className="text-[14px] font-semibold text-n-900">Where it is</h2>

              {/*
                The panel our own people look at, reading the same journey from the same rule.
                No refresh button: asking the carrier is ours to do, on the sweep, and a button that
                spent our API quota on somebody else's impatience would be a poor trade. The number
                itself is a link to the carrier, which is the thing they actually want.
              */}
              {s.trackingDetail
                ? <TrackingPanel view={s.trackingDetail} />
                : (
                  <div className="card p-5 text-[13px] text-n-600">
                    {s.carrier ? `Booked with ${s.carrier}. ` : ''}
                    There is no tracking number on this shipment yet.
                  </div>
                )}

              {s.charge && (
                <div className="card p-5">
                  <dl className="grid grid-cols-[150px_1fr] gap-x-4 gap-y-2 text-[13px] max-[560px]:grid-cols-1">
                    <dt className="text-n-500">Charged</dt><dd className="text-n-800">{money(s.charge.amount, s.charge.currency)}</dd>
                  </dl>
                </div>
              )}
            </section>
          )}

          <section className="card p-5">
            <h2 className="mb-3 text-[14px] font-semibold text-n-900">Going to</h2>
            <dl className="grid grid-cols-[150px_1fr] gap-x-4 gap-y-2 text-[13px] max-[560px]:grid-cols-1">
              <dt className="text-n-500">Contact</dt>
              <dd className="text-n-800">
                {s.recipient.contactName}
                {s.recipient.companyName && <span className="text-n-500"> · {s.recipient.companyName}</span>}
              </dd>
              <dt className="text-n-500">Phone</dt><dd className="mono text-n-800">{s.recipient.phone ?? '—'}</dd>
              <dt className="text-n-500">Email</dt><dd className="text-n-800">{s.recipient.email ?? '—'}</dd>
              {s.recipient.vatNumber && (<><dt className="text-n-500">VAT number</dt><dd className="mono text-n-800">{s.recipient.vatNumber}</dd></>)}
              <dt className="text-n-500">Address</dt>
              <dd className="text-n-800">
                {[s.address.line1, s.address.line2, s.address.line3, s.address.city, s.address.state, s.address.postalCode, s.address.countryIso]
                  .filter(Boolean).join(', ')}
              </dd>
              {s.deliveryInstructions && (<><dt className="text-n-500">Instructions</dt><dd className="text-n-800">{s.deliveryInstructions}</dd></>)}
              <dt className="text-n-500">Collected from</dt>
              <dd className="text-n-800">
                {s.collection
                  ? [s.collection.companyName || s.collection.contactName, s.collection.line1, s.collection.line2, s.collection.city, s.collection.postalCode, s.collection.countryIso].filter(Boolean).join(', ')
                  : 'Already at the maSquare warehouse'}
              </dd>
              {s.orderReference && (<><dt className="text-n-500">Order reference</dt><dd className="mono text-n-800">{s.orderReference}</dd></>)}
              {s.serialNumbers.length > 0 && (
                <><dt className="text-n-500">Serial numbers</dt><dd className="mono text-n-800">{s.serialNumbers.join(', ')}</dd></>
              )}
            </dl>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-[14px] font-semibold text-n-900">{s.packages.length} package{s.packages.length === 1 ? '' : 's'}</h2>
            <div className="flex flex-col gap-3">
              {s.packages.map((p, i) => (
                <div key={p.id ?? i} className="rounded-lg border border-n-100 p-3 text-[13px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-n-800">Package {i + 1}</span>
                    <span className="mono text-n-600">
                      {Number(p.weightKg)} kg · {Number(p.lengthCm)}×{Number(p.widthCm)}×{Number(p.heightCm)} cm
                    </span>
                    {p.dangerousGoods && <span className="tag bg-warning-bg text-warning">Dangerous goods</span>}
                    {p.priorityHandling && <span className="tag bg-info-bg text-info">Priority</span>}
                    {p.insurance && <span className="tag bg-teal-50 text-teal-700">Insured</span>}
                  </div>
                  <div className="mt-1 text-n-700">{p.goodsDescription}</div>
                  <div className="mt-0.5 text-[12.5px] text-n-500">
                    {[
                      p.customerReference ? `Ref ${p.customerReference}` : null,
                      Number(p.quantity) > 1 ? `${Number(p.quantity)} items` : null,
                      Number(p.declaredValue) > 0 ? `Declared ${money(Number(p.declaredValue), s.currency)}` : null,
                      p.hsCode ? `HS ${p.hsCode}` : null,
                      p.countryOfOrigin ? `Made in ${p.countryOfOrigin}` : null,
                      Number(p.insuranceAmount) > 0 ? `Insurance ${money(Number(p.insuranceAmount), s.currency)}` : null,
                    ].filter(Boolean).join(' · ')}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            {pending && (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => setEditing(formFrom(s))}>Edit this shipment</button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Cancel ${s.reference}?`,
                      message: 'We will not send it. You can file a new shipment at any time.',
                      confirmLabel: 'Cancel the shipment',
                      tone: 'danger',
                    });
                    if (ok) cancel.mutate();
                  }}
                >
                  Cancel this shipment
                </button>
              </>
            )}
            {(s.status === 'FULFILLED' || s.status === 'CANCELLED') && (
              <button type="button" className="btn btn-ghost" onClick={() => archive.mutate()}>Archive it</button>
            )}
            {s.status === 'FULFILLED' && (
              <p className="text-[12.5px] text-n-500">Booked with the carrier — call us if something needs to change.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** The saved shipment, back in the shape the form edits. */
function formFrom(s: PortalShipment): FormState {
  const base = emptyForm();
  return {
    ...base,
    orderReference: s.orderReference ?? '',
    serialNumbers: s.serialNumbers.length ? s.serialNumbers : [''],
    currency: s.currency,
    recipient: {
      companyName: s.recipient.companyName ?? '',
      vatNumber: s.recipient.vatNumber ?? '',
      contactName: s.recipient.contactName ?? '',
      phone: s.recipient.phone ?? '',
      email: s.recipient.email ?? '',
      deliveryInstructions: s.deliveryInstructions ?? '',
    },
    address: {
      countryIso: s.address.countryIso ?? '',
      postalCode: s.address.postalCode ?? '',
      city: s.address.city ?? '',
      state: s.address.state ?? '',
      line1: s.address.line1 ?? '',
      line2: s.address.line2 ?? '',
      line3: s.address.line3 ?? '',
    },
    packages: s.packages.map((p) => ({
      lengthCm: p.lengthCm != null ? String(Number(p.lengthCm)) : '',
      widthCm: p.widthCm != null ? String(Number(p.widthCm)) : '',
      heightCm: p.heightCm != null ? String(Number(p.heightCm)) : '',
      weightKg: p.weightKg != null ? String(Number(p.weightKg)) : '',
      goodsDescription: p.goodsDescription ?? '',
      customerReference: p.customerReference ?? '',
      declaredValue: p.declaredValue != null ? String(Number(p.declaredValue)) : '',
      insurance: p.insurance,
      dangerousGoods: p.dangerousGoods,
      batteryType: p.batteryType,
      priorityHandling: p.priorityHandling,
      quantity: p.quantity != null ? String(p.quantity) : '1',
      hsCode: p.hsCode ?? '',
      countryOfOrigin: p.countryOfOrigin ?? '',
    })),
    collection: s.collection
      ? Object.fromEntries(Object.entries({ ...emptyCollection(), ...s.collection }).map(([k, v]) => [k, v ?? ''])) as FormState['collection']
      : emptyCollection(),
  };
}
