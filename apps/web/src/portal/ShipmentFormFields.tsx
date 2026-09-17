import { Info, Plus, Trash2 } from 'lucide-react';
import { Select } from '@masquare/ui';
import { CountrySelect } from '../components/common/CountrySelect';
import { INSURANCE_RATE, type BatteryType, type PortalPackage, type PortalShipmentForm } from '../lib/api';

/**
 * The shipment form, section by section.
 *
 * Shared by filing and by correcting, because a customer answering a question about a shipment
 * should be looking at the form they filled in, not a different one with the same fields in another
 * order.
 *
 * Required fields are marked and enforced, but nothing is blocked while it is being typed: the
 * complaint arrives on submit, in a list, naming the package. A form that disables its own button
 * without saying why is a form people telephone about.
 */

export type FormState = Required<Pick<PortalShipmentForm, 'orderReference' | 'serialNumbers' | 'currency'>> & {
  recipient: NonNullable<PortalShipmentForm['recipient']>;
  address: NonNullable<PortalShipmentForm['address']>;
  packages: Array<Omit<PortalPackage, 'id' | 'insuranceAmount'>>;
};

export const emptyPackage = (): FormState['packages'][number] => ({
  lengthCm: '', widthCm: '', heightCm: '', weightKg: '',
  goodsDescription: '', customerReference: '', declaredValue: '',
  insurance: false, dangerousGoods: false, batteryType: null, priorityHandling: false,
});

export const emptyForm = (): FormState => ({
  orderReference: '',
  serialNumbers: [''],
  currency: 'EUR',
  recipient: { companyName: '', vatNumber: '', contactName: '', phone: '', email: '', deliveryInstructions: '' },
  address: { countryIso: '', postalCode: '', city: '', state: '', line1: '', line2: '', line3: '' },
  packages: [emptyPackage()],
});

/** What the platform would charge to insure this package, shown as it is typed. */
export const insurancePreview = (declaredValue: number | string | null, insured: boolean): number | null => {
  const value = Number(declaredValue);
  if (!insured || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * INSURANCE_RATE * 100) / 100;
};

export function ShipmentFormFields({ form, setForm, batteryTypes }: {
  form: FormState;
  setForm: (next: FormState) => void;
  batteryTypes: BatteryType[];
}) {
  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch });
  const setPackage = (i: number, patch: Partial<FormState['packages'][number]>) =>
    set({ packages: form.packages.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) });

  const yesNo = [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }];

  return (
    <div className="flex flex-col gap-5">
      <Section title="Order details">
        <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
          <Field label="Order reference">
            <input className="input" value={form.orderReference ?? ''} onChange={(e) => set({ orderReference: e.target.value })} placeholder="Your own order number" />
          </Field>
          <div>
            <label className="label">Product serial numbers</label>
            <div className="flex flex-col gap-2">
              {form.serialNumbers.map((serial, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className="input mono"
                    value={serial}
                    onChange={(e) => set({ serialNumbers: form.serialNumbers.map((s, idx) => (idx === i ? e.target.value : s)) })}
                    placeholder="Serial number"
                  />
                  {form.serialNumbers.length > 1 && (
                    <button
                      type="button"
                      className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger"
                      onClick={() => set({ serialNumbers: form.serialNumbers.filter((_, idx) => idx !== i) })}
                      title="Remove"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
              <div>
                <button type="button" className="btn btn-ghost" onClick={() => set({ serialNumbers: [...form.serialNumbers, ''] })}>
                  <Plus size={16} /> Add more
                </button>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Customer details" hint="Who is receiving the shipment.">
        <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
          <Field label="Company name">
            <input className="input" value={form.recipient.companyName ?? ''} onChange={(e) => set({ recipient: { ...form.recipient, companyName: e.target.value } })} />
          </Field>
          <Field label="VAT number">
            <input className="input mono" value={form.recipient.vatNumber ?? ''} onChange={(e) => set({ recipient: { ...form.recipient, vatNumber: e.target.value } })} />
          </Field>
          <Field label="Contact name and surname *">
            <input className="input" value={form.recipient.contactName ?? ''} onChange={(e) => set({ recipient: { ...form.recipient, contactName: e.target.value } })} />
          </Field>
          <Field label="Contact phone number *">
            <input className="input mono" value={form.recipient.phone ?? ''} onChange={(e) => set({ recipient: { ...form.recipient, phone: e.target.value } })} />
          </Field>
          <Field label="Contact email *">
            <input className="input" value={form.recipient.email ?? ''} onChange={(e) => set({ recipient: { ...form.recipient, email: e.target.value } })} />
          </Field>
          <Field label="Delivery instructions" className="col-span-2 max-[560px]:col-span-1">
            <textarea
              className="input h-20 py-2"
              value={form.recipient.deliveryInstructions ?? ''}
              onChange={(e) => set({ recipient: { ...form.recipient, deliveryInstructions: e.target.value } })}
              placeholder="A gate code, a delivery window, who to ask for"
            />
          </Field>
        </div>
      </Section>

      <Section title="Shipping address">
        <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
          <Field label="Country *">
            <CountrySelect value={form.address.countryIso || null} valueKind="code" onChange={(v) => set({ address: { ...form.address, countryIso: v ?? '' } })} />
          </Field>
          <Field label="Postal code *">
            <input className="input mono" value={form.address.postalCode ?? ''} onChange={(e) => set({ address: { ...form.address, postalCode: e.target.value } })} />
          </Field>
          <Field label="City *">
            <input className="input" value={form.address.city ?? ''} onChange={(e) => set({ address: { ...form.address, city: e.target.value } })} />
          </Field>
          <Field label="State or region">
            <input className="input" value={form.address.state ?? ''} onChange={(e) => set({ address: { ...form.address, state: e.target.value } })} />
          </Field>
          <Field label="Address 1 *" className="col-span-2 max-[560px]:col-span-1">
            <input className="input" value={form.address.line1 ?? ''} onChange={(e) => set({ address: { ...form.address, line1: e.target.value } })} />
          </Field>
          <Field label="Address 2">
            <input className="input" value={form.address.line2 ?? ''} onChange={(e) => set({ address: { ...form.address, line2: e.target.value } })} />
          </Field>
          <Field label="Address 3">
            <input className="input" value={form.address.line3 ?? ''} onChange={(e) => set({ address: { ...form.address, line3: e.target.value } })} />
          </Field>
        </div>
      </Section>

      <Section
        title="Package details"
        hint={form.packages.length > 1 ? `${form.packages.length} packages` : undefined}
        right={
          <Select
            dense
            className="w-28"
            value={form.currency ?? 'EUR'}
            onChange={(v) => set({ currency: v })}
            options={['EUR', 'GBP', 'USD'].map((c) => ({ value: c, label: c }))}
          />
        }
      >
        <div className="flex flex-col gap-4">
          {form.packages.map((p, i) => {
            const insurance = insurancePreview(p.declaredValue, p.insurance);
            return (
              <div key={i} className="rounded-lg border border-n-200 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-n-800">Package {i + 1}</span>
                  <div className="flex-1" />
                  {form.packages.length > 1 && (
                    <button
                      type="button"
                      className="grid h-8 w-8 place-items-center rounded-md text-n-500 hover:bg-danger-bg hover:text-danger"
                      title="Remove this package"
                      onClick={() => set({ packages: form.packages.filter((_, idx) => idx !== i) })}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-3 max-[700px]:grid-cols-2">
                  <Field label="Length (cm) *">
                    <input className="input mono" inputMode="decimal" value={p.lengthCm ?? ''} onChange={(e) => setPackage(i, { lengthCm: e.target.value })} />
                  </Field>
                  <Field label="Width (cm) *">
                    <input className="input mono" inputMode="decimal" value={p.widthCm ?? ''} onChange={(e) => setPackage(i, { widthCm: e.target.value })} />
                  </Field>
                  <Field label="Height (cm) *">
                    <input className="input mono" inputMode="decimal" value={p.heightCm ?? ''} onChange={(e) => setPackage(i, { heightCm: e.target.value })} />
                  </Field>
                  <Field label="Weight (kg) *">
                    <input className="input mono" inputMode="decimal" value={p.weightKg ?? ''} onChange={(e) => setPackage(i, { weightKg: e.target.value })} />
                  </Field>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 max-[560px]:grid-cols-1">
                  <Field label="Goods description *" className="col-span-2 max-[560px]:col-span-1">
                    <input className="input" value={p.goodsDescription ?? ''} onChange={(e) => setPackage(i, { goodsDescription: e.target.value })} placeholder="What is in this box" />
                  </Field>
                  <Field label={`Declared value (${form.currency})`}>
                    <input className="input mono" inputMode="decimal" value={p.declaredValue ?? ''} onChange={(e) => setPackage(i, { declaredValue: e.target.value })} />
                  </Field>
                  <Field label="Your reference">
                    <input className="input mono" value={p.customerReference ?? ''} onChange={(e) => setPackage(i, { customerReference: e.target.value })} />
                  </Field>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-3 max-[700px]:grid-cols-1">
                  <Field label="Dangerous goods *">
                    <Select
                      value={p.dangerousGoods ? 'yes' : 'no'}
                      onChange={(v) => setPackage(i, { dangerousGoods: v === 'yes', batteryType: v === 'yes' ? p.batteryType : null })}
                      options={yesNo}
                    />
                  </Field>
                  <Field label="Priority handling *">
                    <Select value={p.priorityHandling ? 'yes' : 'no'} onChange={(v) => setPackage(i, { priorityHandling: v === 'yes' })} options={yesNo} />
                  </Field>
                  <Field
                    label="Insurance *"
                    hint={`Insurance cost is ${INSURANCE_RATE * 100}% of the declared value`}
                  >
                    <Select value={p.insurance ? 'yes' : 'no'} onChange={(v) => setPackage(i, { insurance: v === 'yes' })} options={yesNo} />
                  </Field>
                </div>

                {/* Only where it applies: a battery type on a parcel of guitar strings is a question
                    nobody should be made to answer. */}
                {p.dangerousGoods && (
                  <div className="mt-3 max-w-[420px]">
                    <Field label="Battery type *">
                      <Select
                        searchable
                        value={p.batteryType ?? ''}
                        onChange={(v) => setPackage(i, { batteryType: v || null })}
                        options={[{ value: '', label: 'Choose the packing instruction' }, ...batteryTypes.map((b) => ({ value: b.key, label: b.label }))]}
                      />
                    </Field>
                  </div>
                )}

                {p.insurance && (
                  <p className={`mt-3 text-[12.5px] ${insurance == null ? 'text-warning' : 'text-n-600'}`}>
                    {insurance == null
                      ? 'Insurance needs a declared value — the cover is worked out from it.'
                      : `Insurance cost ${form.currency} ${insurance.toFixed(2)}.`}
                  </p>
                )}
              </div>
            );
          })}

          <div>
            <button type="button" className="btn btn-ghost" onClick={() => set({ packages: [...form.packages, emptyPackage()] })}>
              <Plus size={16} /> Add new package
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, hint, right, children }: { title: string; hint?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="text-[14px] font-semibold text-n-900">{title}</h2>
        {hint && <span className="text-[12.5px] text-n-500">{hint}</span>}
        <div className="flex-1" />
        {right}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label className="label inline-flex items-center gap-1.5">
        {label}
        {/* The rate, where the question about it is asked. */}
        {hint && <span title={hint} className="text-n-400"><Info size={13} /></span>}
      </label>
      {children}
    </div>
  );
}
