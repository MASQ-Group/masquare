import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Calculator, Lock, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Select } from '@masquare/ui';
import {
  pricingApi, salesChannelsApi, shippingServicesApi, profitTiersApi,
  type IndividualPricingResult, type Product, type ProfitTier,
} from '../lib/api';
import { PageHeader } from '../components/common/PageHeader';
import { ProductSkuField } from '../components/sales/ProductSkuField';
import { SalesChannelSelect } from '../components/common/SalesChannelSelect';
import { Flag } from '../components/common/Flag';

const eur = (v: number | null | undefined) =>
  v == null ? '—' : `€${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const native = (v: number | null, ccy: string) =>
  v == null ? '—' : `${ccy} ${v.toLocaleString(undefined, { minimumFractionDigits: ccy === 'JPY' ? 0 : 2, maximumFractionDigits: ccy === 'JPY' ? 0 : 2 })}`;
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);

/** Label above field, matching the house form layout. */
function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <label className="mb-1.5 block h-4 truncate text-[12px] font-semibold leading-4 text-n-600">{label}</label>
      {children}
      {hint ? <div className="mt-1 text-[11px] leading-4 text-n-400">{hint}</div> : null}
    </div>
  );
}

/** A value the system derives and the user cannot type over. */
function LockedField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Field label={label}>
      <div className="input flex items-center justify-between bg-n-50 text-n-500">
        <span className="truncate">{value}</span>
        <Lock size={13} className="shrink-0 text-n-300" />
      </div>
    </Field>
  );
}

export function IndividualPricingPage() {
  const [product, setProduct] = useState<{ productId: string | null; sku: string }>({ productId: null, sku: '' });
  const [productTitle, setProductTitle] = useState('');
  const [channelId, setChannelId] = useState('');
  const [price, setPrice] = useState('');
  const [taxMode, setTaxMode] = useState<'include' | 'zero'>('include');
  const [fulfilment, setFulfilment] = useState<'FBM' | 'FBA'>('FBM');
  const [serviceId, setServiceId] = useState('');
  const [ov, setOv] = useState({ cost: '', shipping: '', vat: '', fee: '', importPct: '', fbaFee: '' });
  const [showComparison, setShowComparison] = useState(false);

  const { data: channels = [] } = useQuery({ queryKey: ['sales-channels'], queryFn: () => salesChannelsApi.list() });
  const { data: services = [] } = useQuery({ queryKey: ['shipping-services'], queryFn: () => shippingServicesApi.list() });
  const { data: tiers = [] } = useQuery({ queryKey: ['profit-tiers'], queryFn: () => profitTiersApi.list() });

  useEffect(() => {
    if (!channelId && channels.length) setChannelId(channels[0].id);
  }, [channels, channelId]);

  const [result, setResult] = useState<IndividualPricingResult | null>(null);
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

  const calc = useMutation({
    mutationFn: () =>
      pricingApi.individual({
        productId: product.productId!,
        salesChannelId: channelId,
        price: Number(price),
        taxMode,
        fulfilment,
        shippingServiceId: serviceId || null,
        costEur: num(ov.cost),
        shippingCostEur: num(ov.shipping),
        fbaFeeEur: num(ov.fbaFee),
        vatPct: num(ov.vat),
        feePct: num(ov.fee),
        importPct: num(ov.importPct),
      }),
    onSuccess: setResult,
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not calculate'),
  });

  // Recalculate whenever an input settles — the maths is server-side but cheap.
  const ready = !!product.productId && !!channelId && price.trim() !== '' && Number(price) > 0;
  useEffect(() => {
    if (!ready) { setResult(null); return; }
    const t = setTimeout(() => calc.mutate(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.productId, channelId, price, taxMode, fulfilment, serviceId, ov.cost, ov.shipping, ov.vat, ov.fee, ov.importPct, ov.fbaFee, ready]);

  const hasOverrides = Object.values(ov).some((v) => v.trim() !== '');
  const b = result?.breakdown;
  const profitColor = b == null ? 'text-n-400' : b.profitEur >= 0 ? 'text-teal-700' : 'text-danger';
  const tier = useMemo(
    () => (b ? tiers.find((t: ProfitTier) => b.marginPct >= t.fromPct && b.marginPct <= t.toPct) : undefined),
    [b, tiers],
  );

  const channelCcy = result?.channel.currency ?? channels.find((c) => c.id === channelId)?.nativeCurrency ?? 'EUR';

  // What is still missing, so an empty profit panel is never a mystery.
  const blocker = !product.productId
    ? 'Choose a product from the list to calculate.'
    : !channelId
      ? 'Choose a sales channel.'
      : price.trim() === '' || Number(price) <= 0
        ? 'Enter a selling price.'
        : null;

  return (
    <div className="w-full">
      <PageHeader
        module="Pricing"
        title="Individual Pricing"
        info="Set a listing price for one product on one channel and see exactly what it earns."
        actions={hasOverrides ? (
          <button
            onClick={() => setOv({ cost: '', shipping: '', vat: '', fee: '', importPct: '', fbaFee: '' })}
            className="hbtn"
          >
            <RotateCcw size={15} /> Reset Overrides
          </button>
        ) : undefined}
      />

      <div className="flex items-start gap-5 max-[1100px]:flex-col">
        {/* ---------- inputs ---------- */}
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <div className="card p-5">
            <h2 className="text-[14px] font-bold text-n-800">Pricing Input</h2>
            <p className="mb-4 mt-0.5 text-[12.5px] text-n-500">
              Taxes and fees pre-fill from the channel — override any field below.
            </p>
            <div className="grid grid-cols-[1.5fr_1.2fr] gap-4 max-[700px]:grid-cols-1">
              <Field label="Product SKU" hint={productTitle || undefined}>
                <ProductSkuField
                  value={product}
                  onChange={(v) => { setProduct(v); if (!v.productId) setProductTitle(''); }}
                  onPick={(p: Product) => setProductTitle(p.title)}
                  autoSelectExact
                />
              </Field>
              <Field label="Sales channel">
                <SalesChannelSelect channels={channels} value={channelId} onChange={setChannelId} />
              </Field>
              <Field label={`Selling price (${channelCcy})`} hint="Listed in the channel currency.">
                <input
                  className="input mono w-[150px] text-left"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </Field>
              {/* FBM ships from us, FBA from Amazon — which changes what "shipping" even means,
                  so it belongs next to the price rather than buried in the inputs below. */}
              <Field label="Fulfilment">
                <div className="flex h-[38px] items-center gap-1 rounded-md bg-n-100 p-1">
                  {(['FBM', 'FBA'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setFulfilment(m)}
                      className={`h-full flex-1 rounded text-[12.5px] font-semibold transition ${
                        fulfilment === m
                          ? 'border border-teal-300 bg-teal-50 text-teal-800 shadow-sm'
                          : 'border border-transparent text-n-500 hover:text-n-700'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Tax in selling price">
                <div className="flex h-[38px] items-center gap-1 rounded-md bg-n-100 p-1">
                  {(['include', 'zero'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setTaxMode(m)}
                      className={`h-full flex-1 rounded text-[12.5px] font-semibold transition ${
                        taxMode === m
                          ? 'border border-teal-300 bg-teal-50 text-teal-800 shadow-sm'
                          : 'border border-transparent text-n-500 hover:text-n-700'
                      }`}
                    >
                      {m === 'include' ? `Includes ${result ? result.auto.vatPct : 0}%` : 'No tax (0%)'}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </div>

          <div className="card p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[14px] font-bold text-n-800">Profit Inputs</h2>
              <span className="text-[12px] text-n-500">Auto-filled from catalogue &amp; channel</span>
            </div>
            <p className="mb-4 mt-0.5 text-[12.5px] text-n-500">
              Type in any field to override it for this calculation. Locked fields are derived from the shipping engine.
            </p>
            <div className="grid grid-cols-3 gap-4 max-[820px]:grid-cols-2 max-[520px]:grid-cols-1">
              <Field
                label="Shipping service"
                hint={!serviceId && result?.auto.shippingServiceName ? 'Default for this destination' : undefined}
              >
                <Select
                  value={serviceId || result?.auto.shippingServiceId || ''}
                  onChange={setServiceId}
                  placeholder="— none"
                  options={services.map((s) => ({ value: s.id, label: s.name }))}
                />
              </Field>
              <LockedField label="Shipping zone" value={result?.auto.shippingZone ?? '—'} />
              <Field
                label={fulfilment === 'FBA' ? 'Inbound to Amazon (€)' : 'Shipping cost (€)'}
                hint={
                  fulfilment === 'FBA'
                    ? result?.auto.fbaInboundSource === 'allocated'
                      ? 'Allocated per unit from FBA shipments'
                      : 'No FBA shipment for this product — weight estimate'
                    : undefined
                }
              >
                <input
                  className="input mono text-right" inputMode="decimal"
                  placeholder={result?.auto.shippingEur != null ? result.auto.shippingEur.toFixed(2) : '0.00'}
                  value={ov.shipping} onChange={(e) => setOv((o) => ({ ...o, shipping: e.target.value }))}
                />
              </Field>
              {fulfilment === 'FBA' && (
                <Field
                  label="FBA fulfilment fee (€)"
                  hint={
                    result?.auto.fbaFeeSource === 'product' ? 'Average per unit from this product’s settled FBA orders'
                    : result?.auto.fbaFeeSource === 'channel' ? 'Channel average — this product has no settled FBA order'
                    : result?.auto.fbaFeeSource === 'override' ? 'Your override'
                    : 'Not known — not included in profit. Enter it.'
                  }
                >
                  <input
                    className="input mono text-right" inputMode="decimal"
                    placeholder={result?.auto.fbaFeeEur != null ? result.auto.fbaFeeEur.toFixed(2) : '0.00'}
                    value={ov.fbaFee} onChange={(e) => setOv((o) => ({ ...o, fbaFee: e.target.value }))}
                  />
                </Field>
              )}
              <LockedField label="Actual weight" value={result?.auto.actualWeightKg != null ? `${result.auto.actualWeightKg} kg` : '—'} />
              <LockedField label="Volumetric weight" value={result?.auto.volumetricWeightKg != null ? `${result.auto.volumetricWeightKg} kg` : '—'} />
              <Field label="Product cost (€)">
                <input
                  className="input mono text-right" inputMode="decimal"
                  placeholder={result ? result.auto.costEur.toFixed(2) : '0.00'}
                  value={ov.cost} onChange={(e) => setOv((o) => ({ ...o, cost: e.target.value }))}
                />
              </Field>
              <Field label={`${result?.auto.taxLabel ?? 'VAT / tax'} applied (%)`}>
                <input
                  className="input mono text-right" inputMode="decimal"
                  placeholder={result ? String(result.auto.vatPct) : '0'}
                  value={ov.vat} onChange={(e) => setOv((o) => ({ ...o, vat: e.target.value }))}
                />
              </Field>
              <Field label="Sales channel fee (%)">
                <input
                  className="input mono text-right" inputMode="decimal"
                  placeholder={result ? String(result.auto.feePct) : '0'}
                  value={ov.fee} onChange={(e) => setOv((o) => ({ ...o, fee: e.target.value }))}
                />
              </Field>
              <Field label="Import tax (%)">
                <input
                  className="input mono text-right" inputMode="decimal" placeholder="0"
                  value={ov.importPct} onChange={(e) => setOv((o) => ({ ...o, importPct: e.target.value }))}
                />
              </Field>
            </div>
          </div>
        </div>

        {/* ---------- profit ---------- */}
        <div className="flex w-[330px] shrink-0 flex-col gap-4 max-[1100px]:w-full">
          <div className="card overflow-hidden">
            <div className="border-b border-n-100 px-5 py-3.5">
              <span className="text-eyebrow text-n-500">
                PROFIT — {result?.channel.name ?? channels.find((c) => c.id === channelId)?.name ?? '—'}
              </span>
            </div>
            <div className="p-5">
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-[12px] font-semibold text-n-500">Profit (EUR)</div>
                  <div className={`mono text-[30px] font-bold leading-none tracking-tight ${profitColor}`}>
                    {b ? eur(b.profitEur) : '—'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[12px] font-semibold text-n-500">Margin</div>
                  {b && tier ? (
                    <span
                      className="mono inline-block rounded-pill px-2 py-0.5 text-[15px] font-bold leading-tight"
                      style={{ background: tier.bgColor, color: tier.fontColor }}
                    >
                      {pct(b.marginPct)}
                    </span>
                  ) : (
                    <div className={`mono text-[19px] font-bold leading-none ${profitColor}`}>{b ? pct(b.marginPct) : '—'}</div>
                  )}
                </div>
              </div>

              {blocker && (
                <div className="mt-4 rounded-md border border-n-200 bg-n-25 px-3 py-2 text-[12px] text-n-500">{blocker}</div>
              )}

              <div className="mt-5 flex flex-col gap-2.5 border-t border-n-100 pt-4">
                <Row label="Selling price" value={result ? native(result.price, result.channel.currency) : '—'} strong />
                <Row label="Selling price (EUR)" value={result ? eur(result.priceEur) : '—'} />
                <Row label={`• ${b?.taxLabel ?? 'VAT / tax'} (${result?.applied.vatPct ?? 0}%)`} value={b ? `−${eur(b.vatEur)}` : '—'} cost />
                {b && b.pointsEur > 0 && (
                  <Row label={`• Amazon Points (${result?.applied.pointsPct ?? 0}%)`} value={`−${eur(b.pointsEur)}`} cost />
                )}
                <Row label={`• Channel fee (${result?.applied.feePct ?? 0}%)`} value={b ? `−${eur(b.feeEur)}` : '—'} cost />
                <Row label="• Product cost" value={b ? `−${eur(b.costEur)}` : '—'} cost />
                <Row
                  label={
                    fulfilment === 'FBA'
                      ? `• Inbound to Amazon${result?.auto.fbaInboundSource === 'estimated' ? ' (estimated)' : ''}`
                      : `• Shipping cost${result?.auto.shippingServiceName ? ` (${result.auto.shippingServiceName})` : ''}`
                  }
                  value={b ? `−${eur(b.shippingEur)}` : '—'}
                  cost
                />
                {fulfilment === 'FBA' && (
                  <Row
                    label={`• FBA fulfilment fee${result?.auto.fbaFeeSource === 'channel' ? ' (channel avg)' : ''}`}
                    value={result?.auto.fbaFeeSource === 'unknown' ? 'not known' : b ? `−${eur(b.fbaFeeEur ?? 0)}` : '—'}
                    cost
                  />
                )}
                <Row label={`• Import tax (${result?.applied.importPct ?? 0}%)`} value={b ? `−${eur(b.importEur)}` : '—'} cost />
                <div className="mt-1.5 flex items-baseline justify-between border-t border-n-100 pt-3">
                  <span className="text-[13.5px] font-bold text-n-900">Net profit</span>
                  <span className={`mono text-[15px] font-bold ${profitColor}`}>{b ? eur(b.profitEur) : '—'}</span>
                </div>
              </div>
            </div>
          </div>

          {!!result?.warnings.length && (
            <div className="rounded-lg border border-warning-bd bg-warning-bg px-4 py-3 text-[12px] leading-relaxed text-warning">
              {result.warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-warning-bd bg-warning-bg px-4 py-3 text-[12px] leading-relaxed text-warning">
            The channel fee is the standard rate from the channel's settings. A booked sale uses the fee the marketplace
            actually charges, so a real transaction can differ slightly.
          </div>
        </div>
      </div>

      {/* ---------- all channels ---------- */}
      <div className="card mt-5 overflow-hidden">
        <div className="flex items-center gap-4 border-b border-n-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-bold text-n-800">Selling Price Across All Channels</h2>
            <p className="mt-0.5 text-[12.5px] text-n-500">
              The listing price on every other channel that earns the same net revenue — each in its own currency and tax rules.
            </p>
          </div>
          <button
            onClick={() => setShowComparison((v) => !v)}
            disabled={!result}
            className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3.5 text-[13px] font-semibold disabled:opacity-50 ${
              showComparison
                ? 'border border-n-200 bg-n-0 text-n-700 hover:bg-n-25'
                : 'bg-teal-500 text-white hover:bg-teal-600'
            }`}
          >
            {showComparison ? 'Hide comparison' : 'Calculate all channels'}
          </button>
        </div>

        {!showComparison || !result ? (
          <div className="px-5 py-10 text-center">
            <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-lg bg-teal-50 text-teal-700">
              <Calculator size={20} />
            </div>
            <div className="text-[14px] font-semibold text-n-800">Cross-channel prices not calculated yet</div>
            <p className="mx-auto mt-1 max-w-[420px] text-[12.5px] text-n-500">
              {result ? 'Run the comparison when you’re ready to price this product everywhere.' : 'Pick a product, channel and price first.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={`${TH} text-left`}>Sales channel</th>
                  <th className={`${TH} text-left`}>Currency</th>
                  <th className={`${TH} text-right`}>Selling price</th>
                  <th className={`${TH} text-right`}>Profit (EUR)</th>
                  <th className={`${TH} text-right`}>Margin</th>
                </tr>
              </thead>
              <tbody>
                {result.comparison.map((r) => (
                  <tr key={r.channelId} className={r.isPrimary ? 'bg-teal-50/50' : 'hover:bg-n-25'}>
                    <td className={TD}>
                      <span className="flex items-center gap-2">
                        <Flag code={r.countryIso} />
                        {r.channelName}
                        {r.isPrimary && (
                          <span className="rounded-pill bg-teal-100 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-teal-700">
                            Defined
                          </span>
                        )}
                      </span>
                    </td>
                    <td className={`${TD} code text-n-500`}>{r.currency}</td>
                    <td className={`${TD} mono text-right font-semibold text-n-800`}>
                      {r.unavailable ? <span className="text-[12px] font-normal text-n-400">{r.unavailable}</span> : native(r.priceNative, r.currency)}
                    </td>
                    <td className={`${TD} mono text-right font-semibold ${(r.profitEur ?? 0) >= 0 ? 'text-teal-700' : 'text-danger'}`}>
                      {r.profitEur == null ? '—' : eur(r.profitEur)}
                    </td>
                    <td className={`${TD} mono text-right font-semibold ${(r.marginPct ?? 0) >= 0 ? 'text-teal-700' : 'text-danger'}`}>
                      {pct(r.marginPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, strong, cost }: { label: string; value: string; strong?: boolean; cost?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-[13px] text-n-600">{label}</span>
      <span
        className={`mono text-[13px] ${
          cost ? 'text-[#D06A5A]' : strong ? 'font-semibold text-n-900' : 'text-n-700'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

const TH = 'border-b border-n-200 bg-n-25 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-n-500';
const TD = 'border-b border-n-100 px-4 py-2.5 text-[13px] text-n-700';
