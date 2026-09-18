import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { portalApi, type PortalShipmentForm } from '../lib/api';
import { PORTAL_COUNTRIES, ShipmentFormFields, emptyForm, type FormState } from './ShipmentFormFields';

/**
 * Filing a shipment.
 *
 * The complaint about an incomplete form arrives on submit, as a list, and stays on screen — the
 * server checks the same rules, so what is shown here is what actually refused it rather than a
 * browser's guess at what might.
 */
export function PortalNewShipmentPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm());
  const [problems, setProblems] = useState<string[]>([]);

  const { data: home } = useQuery({ queryKey: ['portal', 'home'], queryFn: portalApi.home });
  const { data: products } = useQuery({ queryKey: ['portal', 'products'], queryFn: portalApi.products });

  const file = useMutation({
    mutationFn: () => portalApi.file(toPayload(form)),
    onSuccess: (s) => {
      toast.success(`Shipment ${s.reference} filed`);
      qc.invalidateQueries({ queryKey: ['portal'] });
      navigate(`/portal/${s.id}`);
    },
    onError: (e: any) => {
      const message = e?.response?.data?.message ?? 'Could not file the shipment.';
      // The API answers with every problem in one sentence; split it back out so the list reads.
      setProblems(String(message).split(/(?<=\.)\s+/).filter(Boolean));
      toast.error('Some details are missing');
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[18px] font-semibold text-n-900">New shipment</h1>
        <p className="text-[13px] text-n-600">
          Tell us what to send and where. We book it with the carrier and the tracking appears here.
        </p>
      </div>

      {problems.length > 0 && (
        <div className="rounded-lg border border-warning-bd bg-warning-bg p-4">
          <p className="mb-1 text-[13px] font-semibold text-warning">This shipment is not ready to send:</p>
          <ul className="ml-4 list-disc text-[12.5px] text-warning">
            {problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}

      <ShipmentFormFields form={form} setForm={setForm} batteryTypes={home?.batteryTypes ?? []} products={products ?? []} countrySource={PORTAL_COUNTRIES} />

      <div className="flex items-center gap-3">
        <button type="button" className="btn btn-primary" disabled={file.isPending} onClick={() => { setProblems([]); file.mutate(); }}>
          {file.isPending ? 'Sending…' : 'File this shipment'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => navigate('/portal')}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * The form as the API takes it.
 *
 * Numbers arrive from the inputs as strings; they are converted once, here, rather than in each
 * field — a field that converts as you type cannot hold "1." while somebody is typing "1.5".
 */
export function toPayload(form: FormState): PortalShipmentForm {
  const num = (v: number | string | null) => {
    const n = Number(String(v ?? '').trim().replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    orderReference: form.orderReference || null,
    serialNumbers: form.serialNumbers.map((s) => s.trim()).filter(Boolean),
    currency: form.currency,
    recipient: form.recipient,
    address: form.address,
    packages: form.packages.map((p) => ({
      ...p,
      lengthCm: num(p.lengthCm),
      widthCm: num(p.widthCm),
      heightCm: num(p.heightCm),
      weightKg: num(p.weightKg),
      declaredValue: num(p.declaredValue),
      batteryType: p.dangerousGoods ? p.batteryType : null,
      quantity: num(p.quantity),
      hsCode: String(p.hsCode ?? '').trim() || null,
      countryOfOrigin: String(p.countryOfOrigin ?? '').trim().toUpperCase() || null,
    })),
    // Sent even when empty: that is how a removed collection address is cleared on the shipment.
    collection: form.collection,
  };
}
