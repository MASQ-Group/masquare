import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DatePicker, Select } from '@masquare/ui';
import {
  companiesApi, purchaseOrdersApi, vendorsApi, warehousesApi,
  ALLOCATION_LABELS,
  type AllocationMethod, type Product, type PurchaseOrderInput, type RefLite,
} from '../lib/api';
import { RefField } from '../components/products/RefField';
import { CurrencySelect } from '../components/common/CurrencySelect';
import { ProductSkuField } from '../components/sales/ProductSkuField';
import { CostComparisonHint } from '../components/purchase-orders/CostComparisonHint';
import { useConfirm } from '../components/ConfirmProvider';

interface LineForm {
  productId: string | null;
  /** True once the user edits the cost by hand — auto-fill then leaves it alone. */
  costTouched?: boolean;
  sku: string;
  quantityOrdered: string;
  unitCost: string;
  notes: string;
}

/** The three costs that get spread over the goods, plus reporting-only import VAT. */
interface CostState {
  shippingCost: string; shippingCurrency: string; shippingAllocation: AllocationMethod;
  customsDuty: string; customsDutyCurrency: string; customsDutyAllocation: AllocationMethod;
  importHandling: string; importHandlingCurrency: string; importHandlingAllocation: AllocationMethod;
  importVat: string; importVatCurrency: string;
}

// Defaults differ by cost type on purpose: freight is charged on weight, while duty and
// clearance fees are assessed on the value of the goods.
const emptyCosts: CostState = {
  shippingCost: '', shippingCurrency: 'EUR', shippingAllocation: 'weight',
  customsDuty: '', customsDutyCurrency: 'EUR', customsDutyAllocation: 'value',
  importHandling: '', importHandlingCurrency: 'EUR', importHandlingAllocation: 'value',
  importVat: '', importVatCurrency: 'EUR',
};

const VAT_TREATMENT_LABEL: Record<string, string> = {
  standard: 'Standard — VAT per product class',
  reverse_charge: 'EU reverse charge — 0%',
  outside_scope: 'Outside EU — 0%',
};

const emptyLine = (): LineForm => ({ productId: null, sku: '', quantityOrdered: '1', unitCost: '', notes: '' });
const num = (v: string) => (v.trim() === '' ? null : Number(v));
const money = (v: number, ccy = 'EUR') => `${ccy === 'EUR' ? '€' : ccy + ' '}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Label-above-field wrapper. Keeps the field itself fixed in the row even when hint
 *  text appears below, so fields stay aligned across a row (house rule). */
function Field({ label, hint, className, children }: { label: ReactNode; hint?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col ${className ?? ''}`}>
      <label className="mb-1.5 block h-4 truncate text-[12px] font-semibold leading-4 text-n-600">{label}</label>
      {children}
      {hint ? <div className="mt-1 text-[11px] leading-4 text-n-400">{hint}</div> : null}
    </div>
  );
}

/** Amount + its currency + how it is spread over the goods. */
function CostRow({
  label, hint, amount, onAmount, currency, onCurrency, method, onMethod,
}: {
  label: string; hint: string;
  amount: string; onAmount: (v: string) => void;
  currency: string; onCurrency: (v: string) => void;
  method: AllocationMethod; onMethod: (v: AllocationMethod) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_120px] items-start gap-2">
        <Field label={label} hint={hint}>
          <input className="input mono text-right" inputMode="decimal" placeholder="0.00"
            value={amount} onChange={(e) => onAmount(e.target.value)} />
        </Field>
        <Field label="&nbsp;">
          <CurrencySelect value={currency} onChange={(v) => onCurrency(v ?? 'EUR')} />
        </Field>
      </div>
      <Select
        value={method}
        onChange={(v) => onMethod(v as AllocationMethod)}
        options={(Object.keys(ALLOCATION_LABELS) as AllocationMethod[]).map((k) => ({ value: k, label: `Split by ${ALLOCATION_LABELS[k].toLowerCase()}` }))}
      />
    </div>
  );
}

export function PurchaseOrderFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const editing = !!id;

  const { data: companies = [] } = useQuery({ queryKey: ['companies'], queryFn: () => companiesApi.list() });
  const { data: warehouses = [] } = useQuery({ queryKey: ['warehouses'], queryFn: () => warehousesApi.list() });
  const { data: existing } = useQuery({ queryKey: ['purchase-order', id], queryFn: () => purchaseOrdersApi.get(id!), enabled: editing });

  const [busy, setBusy] = useState(false);
  const [companyId, setCompanyId] = useState('');
  const [vendor, setVendor] = useState<RefLite | null>(null);
  const [currency, setCurrency] = useState('EUR');
  const [expectedDelivery, setExpectedDelivery] = useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineForm[]>([emptyLine()]);
  const [fxRate, setFxRate] = useState('');
  const [amountPaidEur, setAmountPaidEur] = useState('');
  const [costs, setCosts] = useState<CostState>(emptyCosts);
  /** True once the user picks a currency by hand — stops the vendor default overriding it. */
  const [currencyTouched, setCurrencyTouched] = useState(false);

  // The vendor's card decides whether this order carries VAT, so show it as soon as one is picked.
  const { data: vendorCard } = useQuery({
    queryKey: ['vendor', vendor?.id],
    queryFn: () => vendorsApi.get(vendor!.id),
    enabled: !!vendor?.id,
  });

  // Adopt the vendor's trading currency — goods are priced in what they invoice in.
  useEffect(() => {
    if (editing || currencyTouched || !vendorCard?.currency) return;
    setCurrency(vendorCard.currency);
  }, [vendorCard, editing, currencyTouched]);

  // Default the issuing company once the list loads (single-company shops shouldn't have to pick).
  useEffect(() => {
    if (!editing && !companyId && companies.length) setCompanyId(companies[0].id);
  }, [companies, editing, companyId]);

  // Hydrate when editing an existing draft.
  useEffect(() => {
    if (!existing) return;
    setCompanyId(existing.company?.id ?? '');
    setVendor(existing.vendor ? { id: existing.vendor.id, name: existing.vendor.name } : null);
    setCurrency(existing.currency);
    setExpectedDelivery(existing.expectedDeliveryDate ? existing.expectedDeliveryDate.slice(0, 10) : '');
    setDestinationWarehouseId(existing.destinationWarehouse?.id ?? '');
    setNotes(existing.notes ?? '');
    setFxRate(existing.fxRate != null ? String(existing.fxRate) : '');
    setAmountPaidEur(existing.amountPaidEur != null ? String(existing.amountPaidEur) : '');
    setCosts({
      shippingCost: existing.shippingCost != null ? String(existing.shippingCost) : '',
      shippingCurrency: existing.shippingCurrency ?? 'EUR',
      shippingAllocation: existing.shippingAllocation ?? 'weight',
      customsDuty: existing.customsDuty != null ? String(existing.customsDuty) : '',
      customsDutyCurrency: existing.customsDutyCurrency ?? 'EUR',
      customsDutyAllocation: existing.customsDutyAllocation ?? 'value',
      importHandling: existing.importHandling != null ? String(existing.importHandling) : '',
      importHandlingCurrency: existing.importHandlingCurrency ?? 'EUR',
      importHandlingAllocation: existing.importHandlingAllocation ?? 'value',
      importVat: existing.importVat != null ? String(existing.importVat) : '',
      importVatCurrency: existing.importVatCurrency ?? 'EUR',
    });
    setLines(
      existing.lines.length
        ? existing.lines.map((l) => ({
            productId: l.productId,
            sku: l.sku ?? '',
            quantityOrdered: String(l.quantityOrdered),
            unitCost: String(l.unitCost),
            costTouched: true,
            notes: l.notes ?? '',
          }))
        : [emptyLine()],
    );
  }, [existing]);

  const setLine = (i: number, patch: Partial<LineForm>) => setLines((r) => r.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  /**
   * Pre-fill the unit cost from the product's registered purchase cost. Skipped when
   * the user has typed their own cost, or when the product's cost is in a different
   * currency than the order (converting silently would understate or inflate the PO).
   */
  const fillCostFromProduct = (i: number, p: Product) => {
    setLines((rows) =>
      rows.map((l, idx) => {
        if (idx !== i || l.costTouched) return l;
        const { amount, currency: costCcy } = p.purchaseCost ?? { amount: null, currency: 'EUR' };
        if (amount == null || costCcy !== currency) return l;
        return { ...l, unitCost: String(amount) };
      }),
    );
  };

  const isEur = currency === 'EUR';
  // What one unit of the order currency is worth in EUR. A settled payment beats the
  // estimate, because it is the rate we actually got.
  const goodsNet = lines.reduce((sum, l) => sum + (Number(l.quantityOrdered) || 0) * (Number(l.unitCost) || 0), 0);
  const paid = Number(amountPaidEur);
  const rate = Number(fxRate);
  const effectiveRate = isEur
    ? 1
    : paid > 0 && goodsNet > 0
      ? paid / goodsNet
      : rate > 0
        ? 1 / rate
        : null;

  const lineTotals = lines.map((l) => (Number(l.quantityOrdered) || 0) * (Number(l.unitCost) || 0));
  const grandTotal = lineTotals.reduce((s, v) => s + v, 0);
  const totalQty = lines.reduce((s, l) => s + (Number(l.quantityOrdered) || 0), 0);

  // Editing is only offered for drafts; guard in case a submitted PO is reached by URL.
  const locked = editing && existing && existing.status !== 'draft';

  const build = (): PurchaseOrderInput | null => {
    if (!companyId) { toast.error('Pick the issuing company'); return null; }
    if (!vendor) { toast.error('Pick a vendor'); return null; }
    const clean = lines.filter((l) => l.productId && Number(l.quantityOrdered) > 0);
    if (!clean.length) { toast.error('Add at least one line with a product and quantity'); return null; }
    for (const l of clean) {
      if (l.unitCost.trim() === '' || Number(l.unitCost) < 0) { toast.error(`Enter a unit cost for ${l.sku || 'each line'}`); return null; }
    }
    return {
      companyId,
      vendorId: vendor.id,
      currency,
      expectedDeliveryDate: expectedDelivery || null,
      fxRate: num(fxRate),
      amountPaidEur: num(amountPaidEur),
      shippingCost: num(costs.shippingCost),
      shippingCurrency: costs.shippingCurrency,
      shippingAllocation: costs.shippingAllocation,
      customsDuty: num(costs.customsDuty),
      customsDutyCurrency: costs.customsDutyCurrency,
      customsDutyAllocation: costs.customsDutyAllocation,
      importHandling: num(costs.importHandling),
      importHandlingCurrency: costs.importHandlingCurrency,
      importHandlingAllocation: costs.importHandlingAllocation,
      importVat: num(costs.importVat),
      importVatCurrency: costs.importVatCurrency,
      destinationWarehouseId: destinationWarehouseId || null,
      notes: notes.trim() || null,
      lines: clean.map((l) => ({
        productId: l.productId!,
        quantityOrdered: Number(l.quantityOrdered),
        unitCost: Number(l.unitCost),
        notes: l.notes.trim() || null,
      })),
    };
  };

  const save = async (thenSubmit: boolean) => {
    const body = build();
    if (!body) return;
    // Submitting locks the order and raises its goods receipt — confirm it. Saving a draft is free.
    if (thenSubmit && !(await confirm({
      title: 'Submit this purchase order?',
      message: 'It locks the order and prepares a goods receipt to receive against. Drafts stay editable.',
      confirmLabel: 'Submit',
    }))) return;
    setBusy(true);
    try {
      const po = editing ? await purchaseOrdersApi.update(id!, body) : await purchaseOrdersApi.create(body);
      if (thenSubmit) {
        await purchaseOrdersApi.submit(po.id);
        toast.success(`${po.poNumber} submitted`);
      } else {
        toast.success(editing ? `${po.poNumber} saved` : `${po.poNumber} created`);
      }
      navigate(`/purchase-orders/${po.id}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  if (locked) {
    return (
      <div className="w-full">
        <button onClick={() => navigate(`/purchase-orders/${id}`)} className="mb-4 inline-flex items-center gap-1 text-[13px] font-semibold text-n-600 hover:text-n-900">
          <ChevronLeft size={16} /> Back to purchase order
        </button>
        <div className="card p-6 text-[13px] text-n-600">This purchase order has been submitted and can no longer be edited.</div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="sticky -top-7 z-10 -mx-8 mb-5 flex items-center gap-3 border-b border-n-200 bg-n-0/95 px-8 py-3 backdrop-blur max-[760px]:-top-5">
        <button onClick={() => navigate(editing ? `/purchase-orders/${id}` : '/purchase-orders')} className="inline-flex items-center gap-1 text-[13px] font-semibold text-n-600 hover:text-n-900">
          <ChevronLeft size={16} /> Back
        </button>
        <div className="flex-1">
          <h1 className="text-[17px] font-bold tracking-tight text-n-900">{editing ? `Edit ${existing?.poNumber ?? 'purchase order'}` : 'New purchase order'}</h1>
        </div>
        <button
          onClick={() => save(false)}
          disabled={busy}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-n-200 bg-n-0 px-3.5 text-[13px] font-semibold text-n-700 hover:border-n-300 hover:bg-n-25 disabled:opacity-50"
        >
          Save draft
        </button>
        <button
          onClick={() => save(true)}
          disabled={busy}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-teal-500 px-3.5 text-[13px] font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
        >
          Submit
        </button>
      </div>

      <div className="flex flex-col gap-5">
        {/* Header */}
        <div className="card p-5">
          <div className="grid grid-cols-[1.3fr_1.3fr_0.6fr_0.6fr_1fr_1.1fr] items-start gap-4 max-[900px]:grid-cols-2 max-[560px]:grid-cols-1">
            <Field label="Issuing company">
              <Select
                value={companyId}
                onChange={setCompanyId}
                placeholder="— select"
                options={companies.map((c) => ({ value: c.id, label: c.officialName }))}
              />
            </Field>
            <Field label="Vendor">
              <RefField value={vendor} placeholder="Search vendors…" list={(q) => vendorsApi.list(q)} onChange={setVendor} />
            </Field>
            <Field label="Currency">
              <CurrencySelect value={currency} onChange={(v) => { setCurrency(v ?? 'EUR'); setCurrencyTouched(true); }} />
            </Field>
            <Field label="VAT treatment" hint="From the vendor's card">
              <div className="input flex items-center bg-n-50 text-n-500">
                {vendor ? VAT_TREATMENT_LABEL[vendorCard?.vatTreatment ?? 'standard'] : '— pick a vendor'}
              </div>
            </Field>
            <Field label="Expected delivery" hint="Optional">
              <DatePicker value={expectedDelivery} onChange={setExpectedDelivery} />
            </Field>
            <Field label="Receive into" hint="Default landing warehouse">
              <Select
                value={destinationWarehouseId}
                onChange={setDestinationWarehouseId}
                placeholder="— decide at receiving"
                options={warehouses.filter((w) => w.includeInInventory).map((w) => ({ value: w.id, label: w.name }))}
              />
            </Field>
          </div>
        </div>


        {/* Lines */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-n-100 px-5 py-3">
            <h2 className="text-[14px] font-bold text-n-800">Line Items</h2>
            <button
              onClick={() => setLines((r) => [...r, emptyLine()])}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-n-300 bg-n-25 px-2.5 text-[12.5px] font-semibold text-teal-700 hover:border-teal-400 hover:bg-teal-50"
            >
              <Plus size={14} /> Add line
            </button>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[720px] px-5 py-3">
              <div className="grid items-center gap-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-n-500" style={{ gridTemplateColumns: '2.4fr 0.8fr 1fr 1fr 1.6fr 34px' }}>
                <div>Product</div>
                <div className="text-right">Qty</div>
                <div className="text-right">Unit cost</div>
                <div className="text-right">Line total</div>
                <div>Notes</div>
                <div />
              </div>

              {lines.map((l, i) => (
                <div key={i} className="border-t border-n-100">
                <div className="grid items-center gap-3 pt-2.5" style={{ gridTemplateColumns: '2.4fr 0.8fr 1fr 1fr 1.6fr 34px' }}>
                  <ProductSkuField
                    value={{ productId: l.productId, sku: l.sku }}
                    onChange={(v) => setLine(i, v)}
                    onPick={(p) => fillCostFromProduct(i, p)}
                    vendorId={vendor?.id ?? null}
                    disabled={!vendor}
                    placeholder={vendor ? `Search ${vendor.name}'s products…` : 'Choose a vendor first'}
                  />
                  <input
                    className="input mono text-right"
                    inputMode="numeric"
                    value={l.quantityOrdered}
                    onChange={(e) => setLine(i, { quantityOrdered: e.target.value })}
                    placeholder="0"
                  />
                  <input
                    className="input mono text-right"
                    inputMode="decimal"
                    value={l.unitCost}
                    onChange={(e) => setLine(i, { unitCost: e.target.value, costTouched: true })}
                    placeholder="0.00"
                  />
                  <div className="mono text-right text-[13px] font-semibold text-n-800">{money(lineTotals[i], currency)}</div>
                  <input
                    className="input"
                    value={l.notes}
                    onChange={(e) => setLine(i, { notes: e.target.value })}
                    placeholder="Optional"
                  />
                  <button
                    type="button"
                    title="Remove line"
                    disabled={lines.length === 1}
                    onClick={() => setLines((r) => r.filter((_, idx) => idx !== i))}
                    className="grid h-[34px] w-[34px] place-items-center rounded-md border border-n-200 bg-n-0 text-n-500 hover:border-danger-bd hover:bg-danger-bg hover:text-danger disabled:opacity-40"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                {/* Full-width sub-row so the input grid above stays aligned. */}
                <div className="pb-2.5 pl-1">
                  <CostComparisonHint productId={l.productId} enteredCost={l.unitCost} currency={currency} />
                </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-8 border-t border-n-100 bg-n-25 px-5 py-3">
            <div className="text-[12.5px] text-n-500">{lines.filter((l) => l.productId).length} line{lines.filter((l) => l.productId).length === 1 ? '' : 's'} · {totalQty} unit{totalQty === 1 ? '' : 's'}</div>
            <div className="text-[13px] font-semibold text-n-700">Total <span className="mono ml-2 text-[15px] text-n-900">{money(grandTotal, currency)}</span></div>
          </div>
        </div>

        {/* Landed costs — freight and clearance charges that become part of product cost */}
        <div className="card p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[14px] font-bold text-n-800">Shipping &amp; Import Costs</h2>
            <span className="text-[12px] text-n-500">
              Spread over the goods when received, so they land in each product&apos;s average cost.
            </span>
          </div>

          <div className="grid grid-cols-3 gap-4 max-[900px]:grid-cols-1">
            <CostRow
              label="Shipping cost"
              hint="Freight to us"
              amount={costs.shippingCost} onAmount={(v) => setCosts((c) => ({ ...c, shippingCost: v }))}
              currency={costs.shippingCurrency} onCurrency={(v) => setCosts((c) => ({ ...c, shippingCurrency: v }))}
              method={costs.shippingAllocation} onMethod={(v) => setCosts((c) => ({ ...c, shippingAllocation: v }))}
            />
            <CostRow
              label="Customs duty"
              hint="Non-recoverable — enters cost"
              amount={costs.customsDuty} onAmount={(v) => setCosts((c) => ({ ...c, customsDuty: v }))}
              currency={costs.customsDutyCurrency} onCurrency={(v) => setCosts((c) => ({ ...c, customsDutyCurrency: v }))}
              method={costs.customsDutyAllocation} onMethod={(v) => setCosts((c) => ({ ...c, customsDutyAllocation: v }))}
            />
            <CostRow
              label="Import handling fees"
              hint="Carrier clearance charge"
              amount={costs.importHandling} onAmount={(v) => setCosts((c) => ({ ...c, importHandling: v }))}
              currency={costs.importHandlingCurrency} onCurrency={(v) => setCosts((c) => ({ ...c, importHandlingCurrency: v }))}
              method={costs.importHandlingAllocation} onMethod={(v) => setCosts((c) => ({ ...c, importHandlingAllocation: v }))}
            />
          </div>

          <div className="mt-4 grid grid-cols-3 gap-4 border-t border-n-100 pt-4 max-[900px]:grid-cols-1">
            <div className="grid grid-cols-[1fr_auto] items-start gap-2">
              <Field label="Import VAT" hint="Reporting only — never enters cost">
                <input className="input mono text-right" inputMode="decimal" placeholder="0.00"
                  value={costs.importVat} onChange={(e) => setCosts((c) => ({ ...c, importVat: e.target.value }))} />
              </Field>
              <Field label="&nbsp;" className="w-[120px]">
                <CurrencySelect value={costs.importVatCurrency} onChange={(v) => setCosts((c) => ({ ...c, importVatCurrency: v ?? 'EUR' }))} />
              </Field>
            </div>

            {!isEur && (
              <>
                <Field label={`FX rate (${currency} per €1)`} hint="Working estimate until the invoice is paid">
                  <input className="input mono text-right" inputMode="decimal" placeholder="0.00000000"
                    value={fxRate} onChange={(e) => setFxRate(e.target.value)} />
                </Field>
                <Field
                  label="Amount paid (EUR)"
                  hint={
                    effectiveRate != null
                      ? `Costing at €${effectiveRate.toFixed(6)} per ${currency}`
                      : 'Actual EUR settled — overrides the rate above'
                  }
                >
                  <input className="input mono text-right" inputMode="decimal" placeholder="0.00"
                    value={amountPaidEur} onChange={(e) => setAmountPaidEur(e.target.value)} />
                </Field>
              </>
            )}
          </div>
        </div>

        {/* Notes */}
        <div className="card p-5">
          <Field label="Notes" hint="Shown on the purchase order and its PDF">
            <textarea
              className="input min-h-[72px] py-2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Delivery instructions, payment terms, references…"
            />
          </Field>
        </div>
      </div>
    </div>
  );
}
