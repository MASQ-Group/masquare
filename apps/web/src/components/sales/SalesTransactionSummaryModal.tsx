import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Lock } from 'lucide-react';
import { ModalShell } from '@masquare/ui';
import { profitTiersApi, type ProfitTier, type SalesTransaction } from '../../lib/api';
import { formatDate, formatMoney } from '../../lib/format';

interface Props {
  transaction: SalesTransaction;
  onClose: () => void;
  /** Switch to the edit modal (lock rules are enforced there). */
  onEdit: () => void;
  /** Open the resolution (return / cancellation / refund) modal. */
  onResolve: () => void;
}

const RESOLUTION: Record<string, { label: string; cls: string }> = {
  cancelled: { label: 'Cancelled', cls: 'border border-danger-bd bg-danger-bg text-danger' },
  returned: { label: 'Returned / refunded', cls: 'border border-orange-100 bg-orange-50 text-orange-700' },
  replaced: { label: 'Replaced', cls: 'border border-orange-100 bg-orange-50 text-orange-700' },
};

const PROFIT_GREEN = '#14A79D';

const money = (amount: number | null | undefined, currency: string | null) =>
  amount != null ? formatMoney({ amount, currency: currency ?? 'EUR' }) : '—';

/** Read-only wide summary of a sales transaction, opened from the list view. */
export function SalesTransactionSummaryModal({ transaction: t, onClose, onEdit, onResolve }: Props) {
  const { data: profitTiers = [] } = useQuery({ queryKey: ['profit-tiers'], queryFn: () => profitTiersApi.list() });

  const tier = t.profitPct != null ? profitTiers.find((x: ProfitTier) => t.profitPct! >= x.fromPct && t.profitPct! <= x.toPct) : undefined;
  const ccy = t.currency ?? 'EUR';
  const feeCcy = t.feeCurrency ?? t.currency ?? 'EUR';

  return (
    <ModalShell
      open
      title="Sales transaction summary"
      subtitle={t.transactionRef}
      initialSize={{ w: 1040, h: 660 }}
      primaryLabel="Edit transaction"
      onPrimary={onEdit}
      secondaryLabel={t.resolution === 'none' ? 'Resolve / return' : 'Edit resolution'}
      onSecondary={onResolve}
      onClose={onClose}
    >
      <div className="flex flex-col gap-5">
        {/* Header facts */}
        <div className="grid grid-cols-4 gap-x-4 gap-y-3 max-[760px]:grid-cols-2">
          <Fact label="Date" value={formatDate(t.date)} mono />
          <Fact label="Transaction ID" value={t.transactionRef} mono />
          <div>
            <div className="text-[11px] text-n-500">Status</div>
            <div className="mt-0.5">
              {t.status === 'submitted'
                ? <span className="tag inline-flex items-center gap-1 border border-teal-100 bg-teal-50 text-teal-700"><Lock size={11} /> Submitted</span>
                : <span className="tag border border-orange-100 bg-orange-50 text-orange-700">Draft</span>}
              {t.unlockedForEdit && <span className="ml-1.5 text-[10px] font-medium text-green-600">unlocked</span>}
              {t.hasPendingUnlock && <span className="ml-1.5 text-[10px] font-medium text-orange-600">unlock pending</span>}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-n-500">Fulfilment</div>
            <div className="mt-0.5">
              <span className={`tag ${(FULFILMENT[t.fulfilmentStatus] ?? FULFILMENT.pending).cls}`}>
                {(FULFILMENT[t.fulfilmentStatus] ?? FULFILMENT.pending).label}
              </span>
            </div>
          </div>
          <Fact label="Sales channel" value={t.salesChannel?.name ?? '—'} />
          <Fact label="Destination" value={t.destinationCountry?.name ?? '—'} />
          <Fact label="Shipping service" value={t.shippingService?.name ?? '—'} />
          <Fact label="Currency / fee currency" value={`${ccy} / ${feeCcy}`} mono />
          <Fact label={`FX ${ccy}→EUR`} value={t.exchangeRate != null ? String(t.exchangeRate) : '—'} mono />
        </div>

        {/* Resolution banner */}
        {t.resolution !== 'none' && RESOLUTION[t.resolution] && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-orange-100 bg-orange-50/60 px-3.5 py-2.5 text-[12.5px] text-n-700">
            <span className={`tag ${RESOLUTION[t.resolution].cls}`}>{RESOLUTION[t.resolution].label}</span>
            {t.refundEur > 0 && <span>Refund: <strong className="mono">€{t.refundEur.toFixed(2)}</strong> ({money(t.refundAmount, ccy)})</span>}
            {t.restockItems && <span className="text-n-500">stock returned</span>}
            {t.feeRefunded && <span className="text-n-500">fee refunded</span>}
            {t.resolutionNotes && <span className="text-n-500">· {t.resolutionNotes}</span>}
          </div>
        )}

        {/* Items */}
        <div className="overflow-hidden rounded-lg border border-n-200">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  {['SKU', 'Qty', `Net sales (${ccy})`, `VAT (${ccy})`, `Shipping (${ccy})`, `Shipping VAT (${ccy})`, `Sales fee (${feeCcy})`, 'Product cost (€)'].map((h, i) => (
                    <th key={h} className={`border-b border-n-200 bg-n-25 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.items.map((it, idx) => (
                  <tr key={it.id ?? idx}>
                    <td className="mono border-b border-n-100 px-3 py-2 text-[13px] font-medium text-n-800">
                      {it.sku}
                      {!it.productMatched && <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-orange-50 px-1 py-0.5 text-[10px] font-medium text-orange-700" title="No matching product in Products — cost/weight not linked"><AlertTriangle size={10} /> no product</span>}
                    </td>
                    <td className="mono border-b border-n-100 px-3 py-2 text-right text-[13px] text-n-700">{it.quantity}</td>
                    <td className="mono border-b border-n-100 px-3 py-2 text-right text-[13px] text-n-700">{money(it.netSalesAmount, ccy)}</td>
                    <td className="mono border-b border-n-100 px-3 py-2 text-right text-[13px] text-n-700">{money(it.vatAmount, ccy)}</td>
                    <td className="mono border-b border-n-100 px-3 py-2 text-right text-[13px] text-n-700">{money(it.shippingAmount, ccy)}</td>
                    <td className="mono border-b border-n-100 px-3 py-2 text-right text-[13px] text-n-700">{money(it.shippingAmountVat, ccy)}</td>
                    <td className="mono border-b border-n-100 px-3 py-2 text-right text-[13px] text-n-700">{money(it.salesChannelSalesFeeAmount, feeCcy)}</td>
                    <td className="mono border-b border-n-100 px-3 py-2 text-right text-[13px]">
                      {it.productMatched && it.productCost != null
                        ? <span className="text-n-800">€{it.productCost.toFixed(2)}</span>
                        : <span className="text-orange-600">—</span>}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="bg-n-25 px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-n-500">Totals</td>
                  <td className="mono bg-n-25 px-3 py-2 text-right text-[13px] font-semibold text-n-800">{t.totals.quantity}</td>
                  <td className="mono bg-n-25 px-3 py-2 text-right text-[13px] font-semibold text-n-800">{money(t.totals.netSales, ccy)}</td>
                  <td className="mono bg-n-25 px-3 py-2 text-right text-[13px] font-semibold text-n-800">{money(t.totals.vat, ccy)}</td>
                  <td className="mono bg-n-25 px-3 py-2 text-right text-[13px] font-semibold text-n-800">{money(t.totals.shipping, ccy)}</td>
                  <td className="mono bg-n-25 px-3 py-2 text-right text-[13px] font-semibold text-n-800">{money(t.totals.shippingVat, ccy)}</td>
                  <td className="mono bg-n-25 px-3 py-2 text-right text-[13px] font-semibold text-n-800">{money(t.totals.fee, feeCcy)}</td>
                  <td className="mono bg-n-25 px-3 py-2 text-right text-[13px] font-semibold text-n-800">€{t.items.reduce((s, it) => s + (it.productCost ?? 0) * it.quantity, 0).toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Calculated */}
        <div className="rounded-lg border border-n-200 bg-n-25 p-3">
          <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-n-500">Calculated</div>
          <div className="grid grid-cols-4 gap-3 max-[760px]:grid-cols-2">
            <Fact label="Sales fee %" value={t.salesFeePct != null ? `${t.salesFeePct}%` : '—'} mono />
            <Fact label={`Destination VAT %${t.vatOverridden ? ' (overridden)' : ''}`} value={t.destinationCountryVatPct != null ? `${t.destinationCountryVatPct}%` : '—'} mono />
            <Fact label="Package weight (kg)" value={t.overallPackageWeight != null ? String(t.overallPackageWeight) : '—'} mono />
            <div className="min-w-0">
              <div className="text-[11px] text-n-500">
                Shipping cost {t.shippingCostSource === 'actual'
                  ? <span className="font-semibold text-teal-700">· actual</span>
                  : <span className="text-n-400">· estimated</span>}
              </div>
              <div className="mono truncate text-[13.5px] font-medium text-n-800">
                {t.shippingCostSource === 'actual'
                  ? (t.actualShippingCost != null ? `€${t.actualShippingCost.toFixed(2)}` : '—')
                  : (t.estimatedShippingCost != null ? `€${t.estimatedShippingCost.toFixed(2)}` : '—')}
              </div>
              {t.shippingCostSource === 'actual' && t.estimatedShippingCost != null && (
                <div className="text-[10.5px] text-n-400">est. was €{t.estimatedShippingCost.toFixed(2)}</div>
              )}
            </div>
            <Fact label="Duty / import" value={t.dutyImportCost ? `€${t.dutyImportCost.toFixed(2)}` : '—'} mono />
            <div>
              <div className="text-[11px] text-n-500">Profit (€)</div>
              <div className="mono text-[15px] font-semibold" style={{ color: t.profit != null ? (t.profit >= 0 ? PROFIT_GREEN : 'var(--danger)') : undefined }}>
                {t.profit != null ? `€${t.profit.toFixed(2)}` : '—'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-n-500">Profit (%)</div>
              <div className="mt-0.5">
                {t.profitPct != null ? (
                  <span className={`tag mono ${tier ? '' : 'border border-n-200 bg-n-100 text-n-600'}`} style={tier ? { background: tier.bgColor, color: tier.fontColor } : undefined} title={tier?.name ?? undefined}>
                    {t.profitPct.toFixed(2)}%
                  </span>
                ) : '—'}
              </div>
            </div>
            {tier?.name && <Fact label="Profit tier" value={tier.name} />}
          </div>
        </div>

        {/* Shipments */}
        {t.shipments.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-n-500">Shipments</div>
            <div className="overflow-hidden rounded-lg border border-n-200">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
                  <thead>
                    <tr>
                      {['Date', 'Type', 'Service', 'Tracking', 'Cost (€)', 'Borne by', 'Duty (€)'].map((h, i) => (
                        <th key={h} className={`border-b border-n-200 bg-n-25 px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap ${i >= 4 && i !== 5 ? 'text-right' : 'text-left'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {t.shipments.map((s) => (
                      <tr key={s.id}>
                        <td className="mono border-b border-n-100 px-3 py-1.5 text-n-700">{formatDate(s.shipmentDate)}</td>
                        <td className="border-b border-n-100 px-3 py-1.5">
                          {s.type === 'outbound'
                            ? <span className="tag border border-teal-100 bg-teal-50 text-teal-700">Outbound</span>
                            : <span className="tag border border-orange-100 bg-orange-50 text-orange-700">Inbound</span>}
                        </td>
                        <td className="border-b border-n-100 px-3 py-1.5 text-n-700">{s.shippingService?.name ?? '—'}</td>
                        <td className="mono border-b border-n-100 px-3 py-1.5 text-n-700">{s.trackingNumber ?? '—'}</td>
                        <td className="mono border-b border-n-100 px-3 py-1.5 text-right text-n-700">{s.shippingCostEur != null ? `€${s.shippingCostEur.toFixed(2)}` : '—'}</td>
                        <td className="border-b border-n-100 px-3 py-1.5 text-n-700">{s.costBorneBy === 'company' ? 'Company' : 'Customer'}</td>
                        <td className="mono border-b border-n-100 px-3 py-1.5 text-right text-n-700">{s.dutyImportEur ? `€${s.dutyImportEur.toFixed(2)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

const FULFILMENT: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending shipment', cls: 'border border-orange-100 bg-orange-50 text-orange-700' },
  shipped: { label: 'Shipped', cls: 'border border-teal-100 bg-teal-50 text-teal-700' },
  cancelled: { label: 'Cancelled', cls: 'border border-n-200 bg-n-100 text-n-600' },
};

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-n-500">{label}</div>
      <div className={`truncate text-[13.5px] font-medium text-n-800 ${mono ? 'mono' : ''}`}>{value}</div>
    </div>
  );
}
