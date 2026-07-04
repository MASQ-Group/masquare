import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { ModalShell } from '@masquare/ui';
import { profitTiersApi, type ProfitTier, type SalesTransaction } from '../../lib/api';
import { formatDate, formatMoney } from '../../lib/format';

interface Props {
  transaction: SalesTransaction;
  onClose: () => void;
  /** Switch to the edit modal (lock rules are enforced there). */
  onEdit: () => void;
}

const PROFIT_GREEN = '#14A79D';

const money = (amount: number | null | undefined, currency: string | null) =>
  amount != null ? formatMoney({ amount, currency: currency ?? 'EUR' }) : '—';

/** Read-only wide summary of a sales transaction, opened from the list view. */
export function SalesTransactionSummaryModal({ transaction: t, onClose, onEdit }: Props) {
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
                ? <span className="tag inline-flex items-center gap-1 border border-n-200 bg-n-100 text-n-600"><Lock size={11} /> Submitted</span>
                : <span className="tag border border-teal-100 bg-teal-50 text-teal-700">Draft</span>}
              {t.unlockedForEdit && <span className="ml-1.5 text-[10px] font-medium text-green-600">unlocked</span>}
              {t.hasPendingUnlock && <span className="ml-1.5 text-[10px] font-medium text-orange-600">unlock pending</span>}
            </div>
          </div>
          <Fact label="Sales channel" value={t.salesChannel?.name ?? '—'} />
          <Fact label="Destination" value={t.destinationCountry?.name ?? '—'} />
          <Fact label="Shipping service" value={t.shippingService?.name ?? '—'} />
          <Fact label="Currency / fee currency" value={`${ccy} / ${feeCcy}`} mono />
          <Fact label={`FX ${ccy}→EUR`} value={t.exchangeRate != null ? String(t.exchangeRate) : '—'} mono />
        </div>

        {/* Items */}
        <div className="overflow-hidden rounded-lg border border-n-200">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  {['SKU', 'Qty', `Net sales (${ccy})`, `VAT (${ccy})`, `Shipping (${ccy})`, `Shipping VAT (${ccy})`, `Sales fee (${feeCcy})`].map((h, i) => (
                    <th key={h} className={`border-b border-n-200 bg-n-25 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.items.map((it, idx) => (
                  <tr key={it.id ?? idx}>
                    <td className="mono border-b border-n-100 px-3 py-2 text-[13px] font-medium text-n-800">{it.sku}</td>
                    <td className="mono border-b border-n-100 px-3 py-2 text-right text-[13px] text-n-700">{it.quantity}</td>
                    <td className="mono border-b border-n-100 px-3 py-2 text-right text-[13px] text-n-700">{money(it.netSalesAmount, ccy)}</td>
                    <td className="mono border-b border-n-100 px-3 py-2 text-right text-[13px] text-n-700">{money(it.vatAmount, ccy)}</td>
                    <td className="mono border-b border-n-100 px-3 py-2 text-right text-[13px] text-n-700">{money(it.shippingAmount, ccy)}</td>
                    <td className="mono border-b border-n-100 px-3 py-2 text-right text-[13px] text-n-700">{money(it.shippingAmountVat, ccy)}</td>
                    <td className="mono border-b border-n-100 px-3 py-2 text-right text-[13px] text-n-700">{money(it.salesChannelSalesFeeAmount, feeCcy)}</td>
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
            <Fact label="Est. shipping cost" value={t.estimatedShippingCost != null ? `€${t.estimatedShippingCost.toFixed(2)}` : '—'} mono />
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
      </div>
    </ModalShell>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-n-500">{label}</div>
      <div className={`truncate text-[13.5px] font-medium text-n-800 ${mono ? 'mono' : ''}`}>{value}</div>
    </div>
  );
}
