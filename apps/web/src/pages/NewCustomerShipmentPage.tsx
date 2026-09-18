import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { SmartReferenceInput, type ReferenceOption } from '@masquare/ui';
import { LOGISTICS_TYPE, customerShipmentsApi, customersApi } from '../lib/api';
import { PageHeader } from '../components/common/PageHeader';
import { ShipmentFormFields, emptyForm, type FormState } from '../portal/ShipmentFormFields';
import { toPayload } from '../portal/PortalNewShipmentPage';

/**
 * Filing a shipment for a customer who did not file it themselves.
 *
 * Some customers email the details instead of using the portal, and that shipment still has to go
 * through the same queue, carry the same reference and be fulfilled the same way. So this is their
 * own form, not a shorter one for us: a second set of rules about what a shipment needs would drift
 * from theirs, and a parcel filed by telephone would reach the warehouse missing something a parcel
 * filed through the portal never could.
 *
 * The customer is chosen first because everything else depends on it — their saved products fill
 * the package fields, and the reference cannot be allocated without knowing whose it is.
 */
export function NewCustomerShipmentPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [problems, setProblems] = useState<string[]>([]);

  const customers = useQuery({
    queryKey: ['customers', { type: LOGISTICS_TYPE }],
    queryFn: () => customersApi.list({ type: LOGISTICS_TYPE, active: 'true' }),
  });

  /** Their catalogue and the battery list, fetched once a customer is chosen. */
  const options = useQuery({
    queryKey: ['customer-shipments', 'form-options', customerId],
    queryFn: () => customerShipmentsApi.formOptions(customerId!),
    enabled: !!customerId,
  });

  const chosen = customers.data?.find((c) => c.id === customerId) ?? null;

  const file = useMutation({
    mutationFn: () => customerShipmentsApi.fileForm(customerId!, toPayload(form)),
    onSuccess: (s) => {
      toast.success(`Shipment ${s.reference} filed for ${chosen?.name ?? 'the customer'}`);
      qc.invalidateQueries({ queryKey: ['customer-shipments'] });
      navigate('/shipments');
    },
    onError: (e: any) => {
      const message = e?.response?.data?.message ?? 'Could not file the shipment.';
      // The API answers with every problem in one sentence; split it back out so the list reads.
      setProblems(String(message).split(/(?<=\.)\s+/).filter(Boolean));
      toast.error('Some details are missing');
    },
  });

  const suggestions = async (q: string): Promise<ReferenceOption[]> =>
    (customers.data ?? [])
      .filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || (c.referencePrefix ?? '').toLowerCase().includes(q.toLowerCase()))
      .slice(0, 30)
      .map((c) => ({ id: c.id, label: c.name, sub: c.referencePrefix ?? undefined }));

  return (
    <div className="w-full">
      <PageHeader
        module="Logistics"
        title="File a shipment for a customer"
        parent={{ label: 'Shipments', href: '/shipments' }}
        info="For a customer who sends their details by email or telephone instead of filing in their own portal. It enters the same queue, with the same reference, as one they filed themselves."
      />

      <div className="flex flex-col gap-4">
        <section className="card p-5">
          <h2 className="mb-1 text-[14px] font-semibold text-n-900">Which customer</h2>
          <p className="mb-3 text-[12.5px] text-n-500">
            Only customers set up for logistics appear here — a shipment has to be numbered from somebody's prefix.
          </p>
          <div className="max-w-[420px]">
            <SmartReferenceInput
              placeholder="Search customers…"
              value={chosen ? { id: chosen.id, label: chosen.name, sub: chosen.referencePrefix ?? undefined } : null}
              fetchSuggestions={suggestions}
              onSelect={(o) => { setCustomerId(o.id); setProblems([]); }}
              onClear={() => setCustomerId(null)}
            />
          </div>
          {chosen?.nextReference && (
            <p className="mono mt-2 text-[12.5px] text-n-600">
              This shipment will be <span className="font-semibold text-n-800">{chosen.nextReference}</span>
            </p>
          )}
        </section>

        {!customerId ? (
          <p className="text-[13px] text-n-500">Choose a customer to fill in their shipment.</p>
        ) : (
          <>
            {problems.length > 0 && (
              <div className="rounded-lg border border-warning-bd bg-warning-bg p-4">
                <p className="mb-1 text-[13px] font-semibold text-warning">This shipment is not ready to send:</p>
                <ul className="ml-4 list-disc text-[12.5px] text-warning">
                  {problems.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            )}

            {/*
              Their own products, and no country source: our session can read the platform's country
              list, which the portal's cannot. Everything else is the form they see.
            */}
            <ShipmentFormFields
              form={form}
              setForm={setForm}
              batteryTypes={options.data?.batteryTypes ?? []}
              products={options.data?.products ?? []}
            />

            <div className="flex items-center gap-3 pb-4">
              <button
                type="button"
                className="btn btn-primary"
                disabled={file.isPending}
                onClick={() => { setProblems([]); file.mutate(); }}
              >
                {file.isPending ? 'Filing…' : 'File this shipment'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => navigate('/shipments')}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
