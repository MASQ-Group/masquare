import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { analyticsApi, type AnalyticsSkuDetail } from '../../lib/api';
import { C, eur, eur2, num, pctChange, pctStr } from '../../lib/analyticsFormat';
import { Kpi, SectionCard } from '../../components/analytics/primitives';
import { LegendDot, TrendChart, Waterfall, type WaterfallStep } from '../../components/analytics/charts';
import { useAnalyticsFilters } from '../../components/analytics/useAnalytics';

export function AnalyticsSkuDetailPage() {
  const { sku = '' } = useParams();
  const { params, filters, rangeLabel } = useAnalyticsFilters();
  const incVat = filters.incVat;
  const revKey = incVat ? 'revenueIncVatEur' : 'revenueExVatEur';

  const { data, isLoading } = useQuery({
    queryKey: ['analytics-sku', sku, params],
    queryFn: () => analyticsApi.sku({ ...params, sku }),
    enabled: !!sku,
  });

  // 6-month fee-per-unit history, independent of the selected range.
  const { data: history } = useQuery({
    queryKey: ['analytics-sku-history', sku, params.companyId],
    queryFn: () => {
      const to = new Date();
      const from = new Date(to.getFullYear(), to.getMonth() - 5, 1);
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return analyticsApi.sku({ sku, from: iso(from), to: iso(to), companyId: params.companyId });
    },
    enabled: !!sku,
  });

  const t = data?.totals;
  const c = data?.prevTotals;

  const unitEcon = useMemo<WaterfallStep[]>(() => {
    if (!t || !t.units) return [];
    const price = t.avgPriceEur;
    const fee = t.feePerUnitEur;
    const profit = t.profitEur / t.units;
    const cogs = Math.max(0, price - fee - profit);
    return [
      { label: 'Avg sale price', value: price, from: 0, to: price, total: true },
      { label: 'COGS', value: -cogs, from: price, to: price - cogs },
      { label: 'Fees', value: -fee, from: price - cogs, to: price - cogs - fee },
      { label: 'Profit / unit', value: profit, from: 0, to: profit, total: true },
    ];
  }, [t]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-1.5 text-[12.5px] text-n-500">
        <Link to="/analytics/products" className="font-semibold text-teal-700">Analytics</Link><span>/</span>
        <Link to="/analytics/products" className="font-semibold text-teal-700">Products</Link><span>/</span>
        <span className="code font-semibold text-n-700">{sku}</span>
      </div>

      <div className="mb-5 flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="code text-[24px] font-semibold tracking-tight text-n-900">{sku}</h1>
          <p className="mt-1 text-[14px] font-medium text-n-700">{data?.productTitle ?? '—'}</p>
          <p className="mt-0.5 text-[13px] text-n-500">{rangeLabel} · sold on {data?.byChannel.length ?? 0} channel{(data?.byChannel.length ?? 0) === 1 ? '' : 's'}</p>
        </div>
        <div className="flex shrink-0 gap-2 pt-1">
          <button className="btn btn-ghost"><Download size={15} />Export CSV</button>
          <Link to="/pricing/individual" className="btn btn-primary">Open in Pricing →</Link>
        </div>
      </div>

      {isLoading && <div className="py-16 text-center text-[13px] text-n-500">Loading SKU…</div>}
      {!isLoading && !t && <div className="card p-12 text-center text-[13px] text-n-500">No sales for {sku} in this range.</div>}

      {!isLoading && t && data && (
        <>
          <div className="mb-4 grid grid-cols-6 gap-3 max-[1100px]:grid-cols-3 max-[560px]:grid-cols-2">
            <Kpi label={`Revenue ${incVat ? 'inc' : ''}`.trim()} value={eur(t[revKey])} cur={t[revKey]} prev={c?.[revKey]} positiveGood prevLabel={eur(c?.[revKey])} />
            <Kpi label="Profit" value={eur(t.profitEur)} cur={t.profitEur} prev={c?.profitEur} positiveGood prevLabel={eur(c?.profitEur)} accent />
            <Kpi label="Margin" value={pctStr(t.profitPct)} cur={t.profitPct ?? 0} prev={c?.profitPct ?? undefined} positiveGood isPointDelta prevLabel={pctStr(c?.profitPct)} />
            <Kpi label="Units" value={num(t.units)} cur={t.units} prev={c?.units} positiveGood prevLabel={num(c?.units)} />
            <Kpi label="Avg price" value={eur2(t.avgPriceEur)} cur={t.avgPriceEur} prev={c?.avgPriceEur} positiveGood prevLabel={eur2(c?.avgPriceEur)} />
            <Kpi label="Fees" value={eur(t.feesEur)} cur={t.feesEur} prev={c?.feesEur} positiveGood={false} prevLabel={eur(c?.feesEur)} />
          </div>

          <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(360px,1fr))] items-start gap-3.5">
            <SectionCard title="Daily revenue & profit">
              <div className="mb-3 flex gap-4"><LegendDot color={C.teal}>Revenue</LegendDot><LegendDot color={C.tealDark} dashed>Profit</LegendDot></div>
              <TrendChart
                points={data.trend}
                series={[{ key: revKey as keyof AnalyticsSkuDetail['trend'][number], label: 'Revenue', color: C.teal, area: true }, { key: 'profitEur', label: 'Profit', color: C.tealDark, dashed: true }]}
                format={eur}
                xLabels={xLabels(data.trend.map((p) => p.bucket))}
                height={190}
              />
            </SectionCard>
            <SectionCard title="Unit economics" subtitle={`Per unit sold, ${rangeLabel}`}>
              <div className="mt-2"><Waterfall steps={unitEcon} format={eur2} height={200} /></div>
              <div className="mt-4 rounded-lg bg-teal-50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-teal-800">
                Every unit sold earns <strong>{eur2(t.units ? t.profitEur / t.units : 0)} ({pctStr(t.profitPct)})</strong>. Fee per unit is {eur2(t.feePerUnitEur)}.
              </div>
            </SectionCard>
          </div>

          <SectionCard className="mb-4" title="Performance by channel" subtitle="Same global filters applied.">
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
                <thead>
                  <tr>{['Channel', 'Fulfilment', 'Revenue €', 'Profit', 'Profit %', 'Avg price', 'Fee/unit', 'Units'].map((h, i) => (
                    <th key={h} className={`border-b border-n-200 bg-n-25 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-n-500 ${i <= 1 ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {data.byChannel.map((r) => (
                    <tr key={r.channelId ?? 'none'} className="hover:bg-teal-50/40">
                      <td className="border-b border-n-100 px-4 py-2 font-medium text-n-800">{r.channelName}</td>
                      <td className="border-b border-n-100 px-4 py-2"><span className="rounded-pill bg-n-100 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-n-600">{r.fulfilment}</span></td>
                      <td className="mono border-b border-n-100 px-4 py-2 text-right font-medium text-n-700">{eur2(incVat ? r.revenueIncVatEur : r.revenueExVatEur)}</td>
                      <td className="mono border-b border-n-100 px-4 py-2 text-right font-semibold" style={{ color: r.profitEur >= 0 ? C.tealDark : 'var(--danger)' }}>{eur2(r.profitEur)}</td>
                      <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{pctStr(r.profitPct)}</td>
                      <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{eur2(r.avgPriceEur)}</td>
                      <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{eur2(r.feePerUnitEur)}</td>
                      <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{num(r.units)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-start gap-3.5">
            <SectionCard title="Returns">
              <div className="flex gap-7">
                <Stat value={num(data.returns.returnedUnits)} label="Returned units" />
                <Stat value={pctStr(t.units ? (data.returns.returnedUnits / t.units) * 100 : 0)} label="Return rate" />
                <Stat value={eur(-data.returns.refundEur)} label="Refund value" danger={data.returns.refundEur > 0} />
              </div>
              {data.returns.orders === 0 && <div className="mt-3 text-[12.5px] text-n-500">No returns recorded for this SKU in the period.</div>}
            </SectionCard>
            <SectionCard title="Fee/unit — last 6 months">
              <FeeHistory detail={history} />
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ value, label, danger }: { value: string; label: string; danger?: boolean }) {
  return (
    <div>
      <div className="mono text-[22px] font-semibold" style={{ color: danger ? C.danger : 'var(--n-900)' }}>{value}</div>
      <div className="mt-0.5 text-[11.5px] font-semibold text-n-500">{label}</div>
    </div>
  );
}

function FeeHistory({ detail }: { detail?: AnalyticsSkuDetail }) {
  const bars = detail?.trend ?? [];
  if (bars.length === 0) return <div className="py-6 text-center text-[12.5px] text-n-400">No fee history.</div>;
  const max = Math.max(0.01, ...bars.map((b) => b.feePerUnitEur));
  return (
    <div className="mt-2 flex items-end gap-2.5" style={{ height: 120 }}>
      {bars.map((b, i) => (
        <div key={b.bucket} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
          <span className="mono text-[10.5px] font-semibold text-n-700">{eur2(b.feePerUnitEur)}</span>
          <div className="w-full max-w-[44px] rounded-t-md" style={{ height: `${(b.feePerUnitEur / max) * 100}%`, background: i === bars.length - 1 ? C.teal : C.neutralBar }} />
          <span className="text-[10.5px] text-n-400">{b.bucket.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

const xLabels = (buckets: string[]): string[] => {
  if (buckets.length === 0) return [];
  const idx = [...new Set([0, Math.floor(buckets.length / 4), Math.floor(buckets.length / 2), Math.floor((buckets.length * 3) / 4), buckets.length - 1])];
  return idx.map((i) => (buckets[i].length > 7 ? buckets[i].slice(5) : buckets[i]));
};
