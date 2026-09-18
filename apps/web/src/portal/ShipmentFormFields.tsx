import { useState } from 'react';
import { ChevronDown, Info, Plus, Trash2 } from 'lucide-react';
import { Select } from '@masquare/ui';
import { CountrySelect } from '../components/common/CountrySelect';
import { INSURANCE_RATE, portalApi, type BatteryType, type CustomerProduct, type PortalPackage, type PortalShipmentForm } from '../lib/api';
import { fieldProblem, sectionComplete, type SectionKey } from './formRules';
import { PhoneField } from './PhoneField';
import { GoodsDescriptionField } from './GoodsDescriptionField';

/**
 * The shipment form, section by section.
 *
 * Shared by filing and by correcting, because a customer answering a question about a shipment
 * should be looking at the form they filled in, not a different one with the same fields in another
 * order.
 *
 * Sections fold away and colour themselves by whether they hold everything they need, so a long
 * form can be read as a short checklist. Field complaints appear once a field has been left, not
 * while it is being typed — telling somebody their email address is wrong after two characters is
 * true and useless. Nothing is ever disabled: the complaint on submit still arrives in a list,
 * naming the package.
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

/** The portal's own countries route — the platform's is shut to external accounts. */
const COUNTRY_SOURCE = { key: 'portal', fetch: portalApi.countries };

export function ShipmentFormFields({ form, setForm, batteryTypes, products = [] }: {
  form: FormState;
  setForm: (next: FormState) => void;
  batteryTypes: BatteryType[];
  /** Their saved goods, offered behind the description field. */
  products?: CustomerProduct[];
}) {
  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch });
  const setPackage = (i: number, patch: Partial<FormState['packages'][number]>) =>
    set({ packages: form.packages.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) });

  // Which fields somebody has finished with. A complaint before then is noise.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const leave = (key: string) => () => setTouched((t) => ({ ...t, [key]: true }));
  const problem = (key: string, kind: Parameters<typeof fieldProblem>[0], value: unknown) =>
    // A phone number with no prefix of its own is read against the delivery country, which is what
    // the API does with the same number.
    (touched[key] ? fieldProblem(kind, value as string, form.address.countryIso) : null);

  const [folded, setFolded] = useState<Partial<Record<SectionKey, boolean>>>({});
  const complete = sectionComplete(form);
  const sectionProps = (key: SectionKey) => ({
    complete: complete[key],
    open: !folded[key],
    onToggle: () => setFolded((f) => ({ ...f, [key]: !f[key] })),
  });

  /** Fill a package from one of their products, leaving anything the product does not say alone. */
  const applyProduct = (i: number, p: CustomerProduct) =>
    setPackage(i, {
      goodsDescription: p.name,
      ...(p.lengthCm != null ? { lengthCm: String(p.lengthCm) } : {}),
      ...(p.widthCm != null ? { widthCm: String(p.widthCm) } : {}),
      ...(p.heightCm != null ? { heightCm: String(p.heightCm) } : {}),
      ...(p.weightKg != null ? { weightKg: String(p.weightKg) } : {}),
      ...(p.declaredValue != null ? { declaredValue: String(p.declaredValue) } : {}),
      dangerousGoods: p.dangerousGoods,
      batteryType: p.dangerousGoods ? p.batteryType : null,
    });

  const yesNo = [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }];

  return (
    <div className="flex flex-col gap-4">
      <Section title="Order details" {...sectionProps('order')}>
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

      <Section title="Customer details" hint="Who is receiving the shipment." {...sectionProps('customer')}>
        <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
          <Field label="Company name">
            <input className="input" value={form.recipient.companyName ?? ''} onChange={(e) => set({ recipient: { ...form.recipient, companyName: e.target.value } })} />
          </Field>
          <Field label="VAT number">
            <input className="input mono" value={form.recipient.vatNumber ?? ''} onChange={(e) => set({ recipient: { ...form.recipient, vatNumber: e.target.value } })} />
          </Field>
          <Field label="Contact name and surname *" problem={problem('contactName', 'required', form.recipient.contactName)}>
            <input
              className={inputClass(problem('contactName', 'required', form.recipient.contactName))}
              value={form.recipient.contactName ?? ''}
              onBlur={leave('contactName')}
              onChange={(e) => set({ recipient: { ...form.recipient, contactName: e.target.value } })}
            />
          </Field>
          <Field label="Contact phone number *" problem={problem('phone', 'phone', form.recipient.phone)}>
            <div onBlur={leave('phone')}>
              <PhoneField
                value={form.recipient.phone}
                addressCountryIso={form.address.countryIso}
                invalid={!!problem('phone', 'phone', form.recipient.phone)}
                onChange={(next) => set({ recipient: { ...form.recipient, phone: next } })}
              />
            </div>
          </Field>
          <Field label="Contact email *" problem={problem('email', 'email', form.recipient.email)}>
            <input
              className={inputClass(problem('email', 'email', form.recipient.email))}
              type="email"
              value={form.recipient.email ?? ''}
              onBlur={leave('email')}
              onChange={(e) => set({ recipient: { ...form.recipient, email: e.target.value } })}
              placeholder="name@company.com"
            />
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

      <Section title="Shipping address" {...sectionProps('address')}>
        <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
          <Field label="Country *" problem={problem('country', 'required', form.address.countryIso)}>
            <CountrySelect
              value={form.address.countryIso || null}
              valueKind="code"
              source={COUNTRY_SOURCE}
              onChange={(v) => { setTouched((t) => ({ ...t, country: true })); set({ address: { ...form.address, countryIso: v ?? '' } }); }}
            />
          </Field>
          <Field label="Postal code *" problem={problem('postalCode', 'required', form.address.postalCode)}>
            <input
              className={`mono ${inputClass(problem('postalCode', 'required', form.address.postalCode))}`}
              value={form.address.postalCode ?? ''}
              onBlur={leave('postalCode')}
              onChange={(e) => set({ address: { ...form.address, postalCode: e.target.value } })}
            />
          </Field>
          <Field label="City *" problem={problem('city', 'required', form.address.city)}>
            <input
              className={inputClass(problem('city', 'required', form.address.city))}
              value={form.address.city ?? ''}
              onBlur={leave('city')}
              onChange={(e) => set({ address: { ...form.address, city: e.target.value } })}
            />
          </Field>
          <Field label="State or region">
            <input className="input" value={form.address.state ?? ''} onChange={(e) => set({ address: { ...form.address, state: e.target.value } })} />
          </Field>
          <Field label="Address 1 *" className="col-span-2 max-[560px]:col-span-1" problem={problem('line1', 'required', form.address.line1)}>
            <input
              className={inputClass(problem('line1', 'required', form.address.line1))}
              value={form.address.line1 ?? ''}
              onBlur={leave('line1')}
              onChange={(e) => set({ address: { ...form.address, line1: e.target.value } })}
            />
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
        {...sectionProps('packages')}
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
            const size = (field: 'lengthCm' | 'widthCm' | 'heightCm' | 'weightKg') =>
              problem(`p${i}.${field}`, 'positive', p[field]);
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
                  {([
                    ['lengthCm', 'Length (cm) *'],
                    ['widthCm', 'Width (cm) *'],
                    ['heightCm', 'Height (cm) *'],
                    ['weightKg', 'Weight (kg) *'],
                  ] as const).map(([field, label]) => (
                    <Field key={field} label={label} problem={size(field)}>
                      <input
                        className={`mono ${inputClass(size(field))}`}
                        inputMode="decimal"
                        value={p[field] ?? ''}
                        onBlur={leave(`p${i}.${field}`)}
                        onChange={(e) => setPackage(i, { [field]: e.target.value })}
                      />
                    </Field>
                  ))}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 max-[560px]:grid-cols-1">
                  <Field
                    label="Goods description *"
                    className="col-span-2 max-[560px]:col-span-1"
                    hint={products.length > 0 ? 'Choose one of your saved products to fill this package, or type anything.' : undefined}
                    problem={problem(`p${i}.goods`, 'required', p.goodsDescription)}
                  >
                    <div onBlur={leave(`p${i}.goods`)}>
                      <GoodsDescriptionField
                        value={p.goodsDescription ?? ''}
                        products={products}
                        invalid={!!problem(`p${i}.goods`, 'required', p.goodsDescription)}
                        onChange={(v) => setPackage(i, { goodsDescription: v })}
                        onPick={(product) => applyProduct(i, product)}
                      />
                    </div>
                  </Field>
                  <Field label={`Declared value (${form.currency})`}>
                    <input className="input mono" inputMode="decimal" value={p.declaredValue ?? ''} onChange={(e) => setPackage(i, { declaredValue: e.target.value })} />
                  </Field>
                  <Field
                    label="Your reference"
                    hint="Optional. Your own label for this box — a pallet number, a job code. It is shown back to you and to our team; the carrier never sees it."
                  >
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
                    {/* Directly under the question that produces it, rather than at the foot of the
                        card where it read as a note about the whole package. */}
                    {p.insurance && (
                      <p className={`mt-1.5 text-[12.5px] ${insurance == null ? 'text-warning' : 'text-n-600'}`}>
                        {insurance == null
                          ? 'Insurance needs a declared value — the cover is worked out from it.'
                          : `Insurance cost ${form.currency} ${insurance.toFixed(2)}.`}
                      </p>
                    )}
                  </Field>
                </div>

                {/* Only where it applies: a battery type on a parcel of guitar strings is a question
                    nobody should be made to answer. */}
                {p.dangerousGoods && (
                  <div className="mt-3 max-w-[420px]">
                    <Field label="Battery type *" problem={problem(`p${i}.battery`, 'required', p.batteryType)}>
                      <Select
                        searchable
                        value={p.batteryType ?? ''}
                        onChange={(v) => { setTouched((t) => ({ ...t, [`p${i}.battery`]: true })); setPackage(i, { batteryType: v || null }); }}
                        options={[{ value: '', label: 'Choose the packing instruction' }, ...batteryTypes.map((b) => ({ value: b.key, label: b.label }))]}
                      />
                    </Field>
                  </div>
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

/** The ordinary field, or the same field wearing its complaint. */
const inputClass = (problem: string | null) => `input ${problem ? 'border-danger' : ''}`;

/**
 * One section of the form.
 *
 * The header says whether the section is finished before it is opened, which is what makes folding
 * safe: nothing hides behind a collapsed heading without the heading admitting it.
 */
function Section({ title, hint, right, complete, open, onToggle, children }: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
  complete: boolean;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const tone = complete ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger';

  return (
    <section className="card overflow-hidden">
      <div className={`flex flex-wrap items-center gap-2 px-5 py-3 ${tone}`}>
        <button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={onToggle} aria-expanded={open}>
          <ChevronDown size={16} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
          <h2 className="text-[14px] font-semibold">{title}</h2>
        </button>
        {hint && <span className="text-[12.5px] opacity-80">{hint}</span>}
        <div className="flex-1" />
        <span className="text-[12px] font-medium opacity-90">{complete ? 'Complete' : 'Needs detail'}</span>
        {right}
      </div>
      {open && (
        <>
          {/* The breaker: the header is a coloured band, and content butted straight against it. */}
          <div className="h-px bg-n-200" />
          <div className="p-5">{children}</div>
        </>
      )}
    </section>
  );
}

function Field({ label, hint, className, problem, children }: {
  label: string;
  hint?: string;
  className?: string;
  problem?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="label inline-flex items-center gap-1.5">
        {label}
        {/* The rate, where the question about it is asked. */}
        {hint && <span title={hint} className="text-n-400"><Info size={13} /></span>}
      </label>
      {children}
      {problem && <p className="mt-1 text-[12px] text-danger">{problem}</p>}
    </div>
  );
}
