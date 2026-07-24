import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { Pagination, Select } from '@masquare/ui';
import { C, eur, eur2, num, pctChange, pctStr } from '../../lib/analyticsFormat';
import type { AnalyticsSkuRow } from '../../lib/api';
import { DeltaText, HeaderActions, PageHeader, SectionCard } from '../../components/analytics/primitives';
import { useAnalyticsFilters, useAnalyticsReport } from '../../components/analytics/useAnalytics';

const PAGE = 10;
type SortKey = 'revenueExVatEur' | 'profitEur' | 'profitPct' | 'feesEur' | 'feeUnit' | 'units';

const ABC_STYLE: Record<string, { color: string; bg: string }> = {
  A: { color: C.tealDark, bg: '#E8F4F2' },
  B: { color: C.warn, bg: '#FDF3E4' },
  C: { color: 'var(--n-600)', bg: 'var(--n-100)' },
};

export function AnalyticsProductsPage() {
  const { filters, rangeLabel, compareLabel, compare } = useAnalyticsFilters();
  const { data, isLoading } = useAnalyticsReport();
  const navigate = useNavigate();
  const incVat = filters.incVat;
  const revKey = incVat ? 'revenueIncVatEur' : 'revenueExVatEur';

  const [query, setQuery] = useState('');
  const [onlyLoss, setOnlyLoss] = useState(false);
  const [minUnits, setMinUnits] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>('revenueExVatEur');
  const [sortDir, setSortDir] = useState<-1 | 1>(-1);
  const [page, setPage] = useState(1);

  // ABC classification + Pareto curve over the full catalogue by revenue.
  const { abc, pareto, concentration } = useMemo(() => computeAbc(data?.bySku ?? []), [data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = (data?.bySku ?? []).filter((s) =>
      (!q || s.sku.toLowerCase().includes(q) || (s.productTitle ?? '').toLowerCase().includes(q)) &&
      (!onlyLoss || s.profitEur < 0) && s.units >= minUnits,
    );
    const getv = (s: AnalyticsSkuRow) => (sortKey === 'feeUnit' ? (s.units ? s.feesEur / s.units : 0) : sortKey === 'profitPct' ? (s.profitPct ?? -Infinity) : (s[sortKey] as number));
    list = [...list].sort((a, b) => (getv(a) - getv(b)) * sortDir);
    return list;
  }, [data, query, onlyLoss, minUnits, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pg = Math.min(page, pageCount);
  const rows = filtered.slice((pg - 1) * PAGE, pg * PAGE);

  const watchlist = useMemo(() => (data?.bySku ?? []).filter((s) => {
    const drop = pctChange(s.profitEur, s.prevProfitEur);
    return (s.profitPct != null && s.profitPct < 12) || (drop != null && drop < -30);
  }).sort((a, b) => (a.profitPct ?? 0) - (b.profitPct ?? 0)).slice(0, 4), [data]);

  const sortHead = (key: SortKey, label: string) => (
    <th className="cursor-pointer border-b border-n-200 bg-n-25 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap hover:text-n-800"
      onClick={() => { setSortKey(key); setSortDir((d) => (sortKey === key ? (d === 1 ? -1 : 1) : -1)); setPage(1); }}>
      <span className="inline-flex items-center gap-0.5">{label}{sortKey === key && (sortDir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}</span>
    </th>
  );

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle={<>The SKU explorer — {rangeLabel}{compare ? <>, compared with {compareLabel}</> : ''}. Click any SKU for its detail view.</>}
        actions={<HeaderActions />}
      />

      {isLoading && <div className="py-16 text-center text-[13px] text-n-500">Loading analytics…</div>}

      {!isLoading && data && (
        <>
          {/* Concentration strip */}
          <SectionCard className="mb-4">
            <div className="flex flex-wrap items-center gap-6">
              <div className="min-w-[240px] flex-1">
                <div className="text-[13px] font-semibold text-n-900">Catalogue concentration</div>
                <div className="mt-1.5 text-[13px] leading-relaxed text-n-700">
                  Top 10 SKUs = <strong className="text-teal-700">{concentration.revShare}</strong> of revenue and <strong className="text-teal-700">{concentration.profShare}</strong> of profit. {num(data.bySku.length)} SKUs sold in this period.
                </div>
                <div className="mt-2.5 flex flex-wrap gap-3.5 text-[11.5px] text-n-500">
                  <span className="inline-flex items-center gap-1.5"><span className="grid h-4 w-4 place-items-center rounded text-[10px] font-bold" style={{ color: ABC_STYLE.A.color, background: ABC_STYLE.A.bg }}>A</span>≤ 70% of revenue</span>
                  <span className="inline-flex items-center gap-1.5"><span className="grid h-4 w-4 place-items-center rounded text-[10px] font-bold" style={{ color: ABC_STYLE.B.color, background: ABC_STYLE.B.bg }}>B</span>70–90%</span>
                  <span className="inline-flex items-center gap-1.5"><span className="grid h-4 w-4 place-items-center rounded text-[10px] font-bold" style={{ color: ABC_STYLE.C.color, background: ABC_STYLE.C.bg }}>C</span>rest</span>
                </div>
              </div>
              <div className="min-w-[260px] flex-[1.2]">
                <div className="mb-1.5 text-[11px] text-n-400">Cumulative share of revenue by SKU rank</div>
                <svg viewBox="0 0 1000 110" preserveAspectRatio="none" className="block h-[82px] w-full">
                  <line x1="0" y1="109" x2="1000" y2="109" stroke="var(--n-200)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <line x1="0" y1="33" x2="1000" y2="33" stroke="var(--n-100)" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
                  <polygon points={`${pareto} 1000,110 0,110`} fill={C.teal} opacity="0.08" />
                  <polyline points={pareto} fill="none" stroke={C.teal} strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
                </svg>
              </div>
            </div>
          </SectionCard>

          {/* SKU table */}
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center gap-2.5 p-4">
              <div className="flex h-9 min-w-[200px] max-w-[340px] flex-1 items-center gap-2 rounded-md border border-n-200 bg-n-50 px-3">
                <Search size={15} className="text-n-400" />
                <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search SKU or product name…" className="flex-1 bg-transparent text-[13px] text-n-900 outline-none placeholder:text-n-400" />
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] font-medium text-n-600">
                <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={onlyLoss} onChange={(e) => { setOnlyLoss(e.target.checked); setPage(1); }} />Only loss-makers
              </label>
              <Select dense className="w-40" value={String(minUnits)} onChange={(v) => { setMinUnits(Number(v)); setPage(1); }}
                options={[{ value: '0', label: 'Min units: any' }, { value: '5', label: 'Min units: 5' }, { value: '20', label: 'Min units: 20' }, { value: '50', label: 'Min units: 50' }]} />
              <span className="ml-auto text-[12px] text-n-500">{num(filtered.length)} SKUs</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    <th className="border-b border-n-200 bg-n-25 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-n-500">SKU</th>
                    <th className="border-b border-n-200 bg-n-25 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-n-500">Product</th>
                    <th className="border-b border-n-200 bg-n-25 px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-n-500">Class</th>
                    {sortHead('revenueExVatEur', 'Revenue €')}
                    {sortHead('profitEur', 'Profit')}
                    {sortHead('profitPct', 'Profit %')}
                    {sortHead('feesEur', 'Fees')}
                    {sortHead('feeUnit', 'Fee/unit')}
                    {sortHead('units', 'Units')}
                    <th className="border-b border-n-200 bg-n-25 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-n-500">vs prev</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={10} className="px-4 py-10 text-center text-n-500">No SKUs match.</td></tr>}
                  {rows.map((r) => {
                    const cls = abc[r.sku] ?? 'C';
                    const st = ABC_STYLE[cls];
                    const delta = pctChange(r.revenueExVatEur, r.prevRevenueExVatEur);
                    return (
                      <tr key={r.sku} className="cursor-pointer hover:bg-teal-50/40" onClick={() => navigate(`/analytics/products/${encodeURIComponent(r.sku)}`)}>
                        <td className="border-b border-n-100 px-4 py-2"><span className="code font-medium text-n-900">{r.sku}</span></td>
                        <td className="max-w-[230px] truncate border-b border-n-100 px-4 py-2 text-n-500">{r.productTitle}</td>
                        <td className="border-b border-n-100 px-4 py-2 text-center"><span className="inline-block w-5 rounded text-[11px] font-bold" style={{ color: st.color, background: st.bg }}>{cls}</span></td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right font-medium text-n-700">{eur2(incVat ? r.revenueIncVatEur : r.revenueExVatEur)}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right font-semibold" style={{ color: r.profitEur >= 0 ? C.tealDark : 'var(--danger)' }}>{eur2(r.profitEur)}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right" style={{ color: r.profitEur >= 0 ? 'var(--n-700)' : 'var(--danger)' }}>{pctStr(r.profitPct)}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{eur2(r.feesEur)}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{r.units ? eur2(r.feesEur / r.units) : '—'}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right text-n-700">{num(r.units)}</td>
                        <td className="mono border-b border-n-100 px-4 py-2 text-right">{delta == null ? <span className="text-n-300">—</span> : <DeltaText v={delta} good={delta >= 0} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <Pagination page={pg} pageCount={pageCount} onPageChange={setPage} />

          {/* Watchlist */}
          <div className="mt-6">
            <SectionCard title="Watchlist candidates" subtitle="Margin below 12% or profit down more than 30% vs prev.">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3">
                {watchlist.length === 0 && <div className="py-3 text-[12.5px] text-n-400">Nothing on the watchlist this period.</div>}
                {watchlist.map((w) => {
                  const drop = pctChange(w.profitEur, w.prevProfitEur);
                  const neg = w.profitEur < 0 || (w.profitPct ?? 0) < 0;
                  const tag = neg ? 'Negative margin' : drop != null && drop < -30 ? `Profit ${drop.toFixed(0)}% vs prev` : 'Low margin';
                  return (
                    <div key={w.sku} onClick={() => navigate(`/analytics/products/${encodeURIComponent(w.sku)}`)} className="cursor-pointer rounded-lg border border-n-200 p-3.5 transition-shadow hover:shadow-md">
                      <div className="flex items-center gap-2">
                        <span className="code text-[12.5px] font-semibold text-n-900">{w.sku}</span>
                        <div className="flex-1" />
                        <span className="rounded-pill px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={neg ? { color: C.danger, background: '#FBEDEA' } : { color: C.warn, background: '#FDF3E4' }}>{tag}</span>
                      </div>
                      <div className="mt-1 truncate text-[12px] text-n-500">{w.productTitle}</div>
                      <div className="mt-2 flex gap-3.5 text-[12px] text-n-700">
                        <span>Margin <strong style={{ color: neg ? C.danger : C.warn }}>{pctStr(w.profitPct)}</strong></span>
                        <span>Profit <strong style={{ color: neg ? C.danger : C.warn }}>{eur(w.profitEur)}</strong></span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}

function computeAbc(bySku: AnalyticsSkuRow[]) {
  const byRev = [...bySku].sort((a, b) => b.revenueExVatEur - a.revenueExVatEur);
  const totalRev = byRev.reduce((s, x) => s + Math.max(0, x.revenueExVatEur), 0) || 1;
  const totalProf = byRev.reduce((s, x) => s + x.profitEur, 0) || 1;
  const abc: Record<string, 'A' | 'B' | 'C'> = {};
  let cum = 0;
  const pts: string[] = [];
  byRev.forEach((s, i) => {
    cum += Math.max(0, s.revenueExVatEur);
    const share = cum / totalRev;
    abc[s.sku] = share <= 0.7 ? 'A' : share <= 0.9 ? 'B' : 'C';
    const x = byRev.length === 1 ? 0 : (i / (byRev.length - 1)) * 1000;
    pts.push(`${x.toFixed(1)},${(110 - 6 - share * (110 - 14)).toFixed(1)}`);
  });
  const top10 = byRev.slice(0, 10);
  const concentration = {
    revShare: `${((top10.reduce((s, x) => s + x.revenueExVatEur, 0) / totalRev) * 100).toFixed(1)}%`,
    profShare: `${((top10.reduce((s, x) => s + x.profitEur, 0) / totalProf) * 100).toFixed(1)}%`,
  };
  return { abc, pareto: pts.join(' '), concentration };
}
