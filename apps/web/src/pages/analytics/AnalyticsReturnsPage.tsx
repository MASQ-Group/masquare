import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { C, eur, num, pctChange, pctStr } from '../../lib/analyticsFormat';
import { DeltaText, HeaderActions, Kpi, PageHeader, SectionCard } from '../../components/analytics/primitives';
import { LegendDot, TrendChart } from '../../components/analytics/charts';
import { xLabelsFor } from '../../components/analytics/trend';
import { useAnalyticsFilters, useAnalyticsReport } from '../../components/analytics/useAnalytics';

interface RatePoint { bucket: string; rate: number }

export function AnalyticsReturnsPage() {
  const { rangeLabel, compareLabel, compare } = useAnalyticsFilters();
  const { data, isLoading } = useAnalyticsReport();
  const navigate = useNavigate();
  const t = data?.totals;
  const r = data?.returns;
  const cr = data?.compareReturns;
  const c = data?.compareTotals;

  const rate = t && t.units ? (r!.returnedUnits / t.units) * 100 : 0;
  const prevRate = c && cr && c.units ? (cr.returnedUnits / c.units) * 100 : undefined;

  const ratePoints = useMemo<RatePoint[]>(() => (data ? data.trend.map((p) => ({ bucket: p.bucket, rate: p.units ? (p.returnedUnits / p.units) * 100 : 0 })) : []), [data]);
  const prevRatePoints = useMemo<RatePoint[] | null>(() => (data?.compareTrend ? data.compareTrend.map((p) => ({ bucket: p.bucket, rate: p.units ? (p.returnedUnits / p.units) * 100 : 0 })) : null), [data]);

  const byChannel = useMemo(() => (data ? data.byChannel.filter((ch) => ch.returnedUnits > 0 || ch.refundEur > 0) : []), [data]);
  const topReturned = useMemo(() => (data ? data.bySku.filter((s) => s.returnedUnits > 0).map((s) => ({ ...s, rate: s.units ? (s.returnedUnits / s.units) * 100 : 0 })).sort((a, b) => b.rate - a.rate).slice(0, 6) : []), [data]);

  return (
    <div>
      <PageHeader
        title="Returns & Refunds"
        subtitle={<>What comes back and what it costs — {rangeLabel}{compare ? <>, compared with {compareLabel}</> : ''}. An increase here is unfavourable.</>}
        actions={<HeaderActions />}
      />

      {isLoading && <div className="py-16 text-center text-[13px] text-n-500">Loading analytics…</div>}

      {!isLoading && t && r && data && (
        <>
          <div className="mb-4 grid grid-cols-4 gap-3.5 max-[900px]:grid-cols-2 max-[520px]:grid-cols-1">
            {/* positiveGood=false → a rise shows red, matching returns semantics */}
            <Kpi label="Return rate" value={pctStr(rate)} cur={rate} prev={prevRate} positiveGood={false} isPointDelta prevLabel={pctStr(prevRate)} />
            <Kpi label="Returned units" value={num(r.returnedUnits)} cur={r.returnedUnits} prev={cr?.returnedUnits} positiveGood={false} prevLabel={num(cr?.returnedUnits)} />
            <Kpi label="Refund value" value={eur(-r.refundEur)} cur={r.refundEur} prev={cr?.refundEur} positiveGood={false} prevLabel={cr ? eur(-cr.refundEur) : undefined} accent />
            <Kpi label="Returned orders" value={num(r.returnedOrders)} cur={r.returnedOrders} prev={cr?.returnedOrders} positiveGood={false} prevLabel={num(cr?.returnedOrders)} />
          </div>

          {/* Return-rate trend */}
          <SectionCard className="mb-4" title="Return-rate trend" subtitle="Returned units as a share of units sold, per bucket.">
            <div className="mb-3 flex gap-4">
              <LegendDot color={C.orange}>This period</LegendDot>
              {prevRatePoints && <LegendDot color="#C9D4D0">Prev period</LegendDot>}
            </div>
            <TrendChart
              points={ratePoints}
              prev={prevRatePoints}
              prevKey="rate"
              series={[{ key: 'rate', label: 'Return rate', color: C.orange, area: true }]}
              format={(v) => `${v.toFixed(1)}%`}
              xLabels={xLabelsFor(data.trend)}
              height={190}
            />
          </SectionCard>

          {/* Returns by channel */}
          <SectionCard className="mb-4" title="Returns by channel" subtitle="Refund value is what left the business; vs prev compares returned units.">
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
                <thead>
                  <tr>{['Channel', 'Units sold', 'Returned', 'Return rate', 'Refund value', 'vs prev'].map((h, i) => (
                    <th key={h} className={`border-b border-n-200 bg-n-25 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-n-500 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {byChannel.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-n-500">No returns in this range.</td></tr>}
                  {byChannel.map((ch) => {
                    const rt = ch.units ? (ch.returnedUnits / ch.units) * 100 : 0;
                    const delta = pctChange(ch.returnedUnits, ch.prevReturnedUnits);
                    const rtColor = rt > 4 ? 'var(--danger)' : rt > 3 ? C.warn : 'var(--n-700)';
                    return (
                      <tr key={ch.channelId ?? 'none'} className="hover:bg-teal-50/40">
                        <td className="border-b border-n-100 px-4 py-2 font-medium text-n-800">{ch.channelName}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{num(ch.units)}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right font-medium text-n-700">{num(ch.returnedUnits)}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right font-semibold" style={{ color: rtColor }}>{pctStr(rt)}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right text-danger">{eur(-ch.refundEur)}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right">{delta == null ? <span className="text-n-300">—</span> : <DeltaText v={delta} good={delta <= 0} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] items-start gap-3.5">
            {/* Most-returned SKUs */}
            <SectionCard title="Most-returned SKUs" subtitle="By return rate. Click a SKU for its detail view.">
              <div className="grid grid-cols-1 gap-2.5">
                {topReturned.length === 0 && <div className="py-3 text-center text-[12.5px] text-n-400">No returned SKUs this period.</div>}
                {topReturned.map((s) => (
                  <div key={s.sku} onClick={() => navigate(`/analytics/products/${encodeURIComponent(s.sku)}`)} className="cursor-pointer rounded-lg border border-n-200 p-3 transition-shadow hover:shadow-md">
                    <div className="flex items-center gap-2">
                      <span className="code text-[12.5px] font-semibold text-n-900">{s.sku}</span>
                      <div className="flex-1" />
                      <span className="mono text-[12.5px] font-bold text-danger">{pctStr(s.rate)}</span>
                    </div>
                    <div className="mt-1 truncate text-[12px] text-n-500">{s.productTitle}</div>
                    <div className="mt-1.5 text-[12px] text-n-600">{num(s.returnedUnits)} of {num(s.units)} units returned</div>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* Reasons & disposition — placeholder (no reason/disposition capture yet) */}
            <SectionCard
              title="Return reasons & disposition"
              right={<span className="rounded-pill bg-n-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-n-500">Pending data</span>}
            >
              <p className="text-[13px] leading-relaxed text-n-600">
                Reason codes (damaged, not as described, changed mind…) and disposition of returned stock (resold, refurbished, written off) aren't captured yet. Once the return-handling flow records them, this panel will break returns down by reason and show recovery vs write-off.
              </p>
              <div className="mt-3 flex flex-col gap-2 opacity-50">
                {['Damaged in transit', 'Not as described', 'Changed mind', 'Wrong item'].map((label, i) => (
                  <div key={label} className="grid grid-cols-[140px_1fr] items-center gap-2.5">
                    <span className="text-[12px] font-medium text-n-500">{label}</span>
                    <span className="h-3.5 overflow-hidden rounded bg-n-50"><span className="block h-full rounded bg-n-200" style={{ width: `${[70, 46, 40, 28][i]}%` }} /></span>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}
