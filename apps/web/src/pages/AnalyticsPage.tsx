import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, TrendingUp } from 'lucide-react';
import { DateRangePicker, Select } from '@masquare/ui';
import { analyticsApi, type AnalyticsChannelRow, type AnalyticsSkuRow, type AnalyticsTotals } from '../lib/api';
import { useAuth } from '../lib/auth';
import { compareRange, presetRange, prettyRange, type ComparePreset, type DateRange, type RangePreset } from '../lib/analyticsRange';

const eur = (v: number | null | undefined) =>
  v == null ? '—' : new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
const eur2 = (v: number | null | undefined) =>
  v == null ? '—' : new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(v);
const num = (v: number) => new Intl.NumberFormat('en-IE').format(v);
const pctStr = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`);

const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
const PROFIT_TEAL = '#14A79D';

export function AnalyticsPage() {
  const { activeCompanyId } = useAuth();
  const [rangePreset, setRangePreset] = useState<RangePreset>('mtd');
  const [year, setYear] = useState(new Date().getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1);
  const [customRange, setCustomRange] = useState<DateRange>({ from: presetRange('mtd', {}).from, to: presetRange('mtd', {}).to });
  const [comparePreset, setComparePreset] = useState<ComparePreset>('prev_month');
  const [customCompare, setCustomCompare] = useState<DateRange>({ from: '', to: '' });
  const [incVat, setIncVat] = useState(false);
  const [skuChannel, setSkuChannel] = useState('');
  const [skuCountry, setSkuCountry] = useState('');

  const range = useMemo(() => presetRange(rangePreset, { year, quarter, custom: customRange }), [rangePreset, year, quarter, customRange]);
  const compare = useMemo(() => compareRange(range, comparePreset, customCompare), [range, comparePreset, customCompare]);

  const params = {
    from: range.from, to: range.to,
    compareFrom: compare?.from, compareTo: compare?.to,
    companyId: activeCompanyId || undefined,
    skuChannelId: skuChannel || undefined,
    skuCountryId: skuCountry || undefined,
  };
  const { data, isLoading } = useQuery({ queryKey: ['analytics-sales', params], queryFn: () => analyticsApi.sales(params) });

  const t = data?.totals;
  const c = data?.compareTotals;
  const revKey = incVat ? 'revenueIncVatEur' : 'revenueExVatEur';

  return (
    <div className="w-full">
      <div className="mb-5">
        <div className="eyebrow mb-1.5">Operations</div>
        <h1 className="text-[24px] font-semibold tracking-tight text-n-900">Sales analytics</h1>
        <p className="mt-1 text-[13.5px] text-n-500">Revenue, profit and fees across channels and SKUs. All monetary figures in EUR unless noted.</p>
      </div>

      {/* Controls */}
      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-lg border border-n-200 bg-n-0 p-3">
        <Field label="Range">
          <Select
            dense className="w-44"
            value={rangePreset}
            onChange={(v) => setRangePreset(v as RangePreset)}
            options={[
              { value: 'mtd', label: 'Month to date' },
              { value: 'prev_month', label: 'Previous month' },
              { value: 'ytd', label: 'Year to date' },
              { value: 'year', label: 'Specific year' },
              { value: 'quarter', label: 'Specific quarter' },
              { value: 'custom', label: 'Custom range' },
            ]}
          />
        </Field>
        {(rangePreset === 'year' || rangePreset === 'quarter') && (
          <Field label="Year">
            <Select
              dense className="w-24"
              value={String(year)}
              onChange={(v) => setYear(Number(v))}
              options={YEARS.map((y) => ({ value: String(y), label: String(y) }))}
            />
          </Field>
        )}
        {rangePreset === 'quarter' && (
          <Field label="Quarter">
            <Select
              dense className="w-20"
              value={String(quarter)}
              onChange={(v) => setQuarter(Number(v))}
              options={[1, 2, 3, 4].map((q) => ({ value: String(q), label: `Q${q}` }))}
            />
          </Field>
        )}
        {rangePreset === 'custom' && (
          <Field label="Custom range">
            <div className="w-[16rem]"><DateRangePicker value={customRange} onChange={setCustomRange} /></div>
          </Field>
        )}

        <div className="mx-1 h-9 w-px self-end bg-n-200" />

        <Field label="Compare to">
          <Select
            dense className="w-[17rem]"
            value={comparePreset}
            onChange={(v) => setComparePreset(v as ComparePreset)}
            options={[
              { value: 'prev_month', label: 'Same period, previous month' },
              { value: 'prev_period', label: 'Previous period' },
              { value: 'prev_year', label: 'Same period, previous year' },
              { value: 'custom', label: 'Custom' },
              { value: 'none', label: 'No comparison' },
            ]}
          />
        </Field>
        {comparePreset === 'custom' && (
          <Field label="Compare range">
            <div className="w-[16rem]"><DateRangePicker value={customCompare} onChange={setCustomCompare} /></div>
          </Field>
        )}

        <div className="ml-auto flex flex-col items-end gap-1 self-end">
          <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] font-medium text-n-700">
            <input type="checkbox" className="h-4 w-4 accent-[var(--teal-500)]" checked={incVat} onChange={(e) => setIncVat(e.target.checked)} /> Revenue incl. VAT
          </label>
          <span className="mono text-[11px] text-n-400">{prettyRange(range)}{compare ? ` vs ${prettyRange(compare)}` : ''}</span>
        </div>
      </div>

      {isLoading && <div className="py-16 text-center text-[13px] text-n-500">Loading analytics…</div>}

      {!isLoading && t && (
        <>
          {/* KPI cards */}
          <div className="mb-5 grid grid-cols-4 gap-3 max-[1100px]:grid-cols-2 max-[560px]:grid-cols-1">
            <Kpi label={`Revenue ${incVat ? '(incl. VAT)' : '(excl. VAT)'}`} value={eur(t[revKey])} cur={t[revKey]} prev={c?.[revKey]} positiveGood />
            <Kpi label="Profit" value={eur(t.profitEur)} cur={t.profitEur} prev={c?.profitEur} positiveGood accent />
            <Kpi label="Profit margin" value={pctStr(t.profitPct)} cur={t.profitPct ?? 0} prev={c?.profitPct ?? undefined} positiveGood suffix="pp" isPointDelta />
            <Kpi label="Fees paid" value={eur(t.feesEur)} cur={t.feesEur} prev={c?.feesEur} positiveGood={false} />
            <Kpi label="Orders" value={num(t.orders)} cur={t.orders} prev={c?.orders} positiveGood />
            <Kpi label="Units" value={num(t.units)} cur={t.units} prev={c?.units} positiveGood />
            <Kpi label="Avg order value" value={eur2(t.avgOrderValueEur)} cur={t.avgOrderValueEur} prev={c?.avgOrderValueEur} positiveGood />
            <Kpi label="Shipping + duty" value={eur(t.shippingEur + t.dutyEur)} cur={t.shippingEur + t.dutyEur} prev={c ? c.shippingEur + c.dutyEur : undefined} positiveGood={false} />
          </div>

          {/* Charts */}
          <div className="mb-5 grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
            <ChannelBars title={`Revenue by channel ${incVat ? '(incl. VAT)' : '(excl. VAT)'}`} rows={data!.byChannel} pick={(r) => (incVat ? r.revenueIncVatEur : r.revenueExVatEur)} color="#0EA5A0" />
            <ChannelBars title="Profit by channel" rows={data!.byChannel} pick={(r) => r.profitEur} color={PROFIT_TEAL} signed />
          </div>
          <div className="mb-5">
            <TrendChart points={data!.trend} />
          </div>

          {/* Per-channel table */}
          <SectionTitle>Per sales channel</SectionTitle>
          <div className="card mb-6 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-[13px]">
                <thead>
                  <tr>
                    {['Sales channel', `Revenue ${incVat ? 'inc' : 'exc'} VAT (native)`, `Revenue ${incVat ? 'inc' : 'exc'} VAT (€)`, 'Profit (€)', 'Profit %', 'Fees (€)', 'Orders', 'Units', 'vs prev'].map((h, i) => (
                      <th key={h} className={`border-b border-n-200 bg-n-25 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data!.byChannel.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-n-500">No sales in this range.</td></tr>}
                  {data!.byChannel.map((r) => {
                    const revNative = incVat ? r.revenueIncVatNative : r.revenueExVatNative;
                    const revEurV = incVat ? r.revenueIncVatEur : r.revenueExVatEur;
                    const delta = r.prevRevenueExVatEur != null && r.prevRevenueExVatEur !== 0 ? ((r.revenueExVatEur - r.prevRevenueExVatEur) / Math.abs(r.prevRevenueExVatEur)) * 100 : null;
                    return (
                      <tr key={r.channelId ?? 'none'} className="hover:bg-teal-50/40">
                        <td className="border-b border-n-100 px-3 py-2 font-medium text-n-800">{r.channelName}</td>
                        <td className="mono border-b border-n-100 px-3 py-2 text-right text-n-700">{r.currency ? `${num(Math.round(revNative))} ${r.currency}` : '—'}</td>
                        <td className="mono border-b border-n-100 px-3 py-2 text-right text-n-700">{eur2(revEurV)}</td>
                        <td className="mono border-b border-n-100 px-3 py-2 text-right font-medium" style={{ color: r.profitEur >= 0 ? PROFIT_TEAL : 'var(--danger)' }}>{eur2(r.profitEur)}</td>
                        <td className="mono border-b border-n-100 px-3 py-2 text-right text-n-700">{pctStr(r.profitPct)}</td>
                        <td className="mono border-b border-n-100 px-3 py-2 text-right text-n-700">{eur2(r.feesEur)}</td>
                        <td className="mono border-b border-n-100 px-3 py-2 text-right text-n-700">{num(r.orders)}</td>
                        <td className="mono border-b border-n-100 px-3 py-2 text-right text-n-700">{num(r.units)}</td>
                        <td className="mono border-b border-n-100 px-3 py-2 text-right">{delta == null ? <span className="text-n-300">—</span> : <DeltaText v={delta} good={delta >= 0} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Per-destination-country table */}
          <SectionTitle>Per destination country</SectionTitle>
          <div className="card mb-6 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-[13px]">
                <thead>
                  <tr>
                    {['Destination country', `Revenue ${incVat ? 'inc' : 'exc'} VAT (€)`, 'Profit (€)', 'Profit %', 'Fees (€)', 'Orders', 'Units', 'vs prev'].map((h, i) => (
                      <th key={h} className={`border-b border-n-200 bg-n-25 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data!.byCountry.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-n-500">No sales in this range.</td></tr>}
                  {data!.byCountry.map((r) => {
                    const delta = r.prevRevenueExVatEur != null && r.prevRevenueExVatEur !== 0 ? ((r.revenueExVatEur - r.prevRevenueExVatEur) / Math.abs(r.prevRevenueExVatEur)) * 100 : null;
                    return (
                      <tr key={r.countryId ?? 'none'} className="hover:bg-teal-50/40">
                        <td className="border-b border-n-100 px-3 py-2 font-medium text-n-800">{r.countryName}</td>
                        <td className="mono border-b border-n-100 px-3 py-2 text-right text-n-700">{eur2(incVat ? r.revenueIncVatEur : r.revenueExVatEur)}</td>
                        <td className="mono border-b border-n-100 px-3 py-2 text-right font-medium" style={{ color: r.profitEur >= 0 ? PROFIT_TEAL : 'var(--danger)' }}>{eur2(r.profitEur)}</td>
                        <td className="mono border-b border-n-100 px-3 py-2 text-right text-n-700">{pctStr(r.profitPct)}</td>
                        <td className="mono border-b border-n-100 px-3 py-2 text-right text-n-700">{eur2(r.feesEur)}</td>
                        <td className="mono border-b border-n-100 px-3 py-2 text-right text-n-700">{num(r.orders)}</td>
                        <td className="mono border-b border-n-100 px-3 py-2 text-right text-n-700">{num(r.units)}</td>
                        <td className="mono border-b border-n-100 px-3 py-2 text-right">{delta == null ? <span className="text-n-300">—</span> : <DeltaText v={delta} good={delta >= 0} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Per-SKU (global or by channel) */}
          <div className="mb-2 flex items-center gap-3">
            <SectionTitle>Per SKU</SectionTitle>
            <Select
              dense className="w-56"
              value={skuChannel}
              onChange={setSkuChannel}
              options={[{ value: '', label: 'All channels (global)' }, ...data!.channels.map((ch) => ({ value: ch.id, label: ch.name }))]}
            />
          </div>
          <div className="mb-6"><SkuTable rows={data!.bySku} incVat={incVat} /></div>

          {/* Per-SKU per destination country */}
          <div className="mb-2 flex items-center gap-3">
            <SectionTitle>Per SKU · per destination country</SectionTitle>
            <Select
              dense className="w-56"
              value={skuCountry}
              onChange={setSkuCountry}
              options={[{ value: '', label: 'All countries (global)' }, ...data!.countries.map((co) => ({ value: co.id, label: co.name }))]}
            />
          </div>
          <SkuTable rows={data!.bySkuByCountry} incVat={incVat} />
        </>
      )}
    </div>
  );
}

function SkuTable({ rows, incVat }: { rows: AnalyticsSkuRow[]; incVat: boolean }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead>
            <tr>
              {['SKU', `Revenue ${incVat ? 'inc' : 'exc'} VAT (€)`, 'Profit (€)', 'Profit %', 'Fees (€)', 'Avg fee/unit (€)', 'Units'].map((h, i) => (
                <th key={h} className={`border-b border-n-200 bg-n-25 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-n-500 whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-n-500">No SKU sales in this range.</td></tr>}
            {rows.map((r) => (
              <tr key={r.sku} className="hover:bg-teal-50/40">
                <td className="border-b border-n-100 px-3 py-2">
                  <span className="code font-medium text-n-800">{r.sku}</span>
                  {r.productTitle && <span className="ml-2 text-[11.5px] text-n-400">{r.productTitle.length > 40 ? r.productTitle.slice(0, 40) + '…' : r.productTitle}</span>}
                </td>
                <td className="mono border-b border-n-100 px-3 py-2 text-right text-n-700">{eur2(incVat ? r.revenueIncVatEur : r.revenueExVatEur)}</td>
                <td className="mono border-b border-n-100 px-3 py-2 text-right font-medium" style={{ color: r.profitEur >= 0 ? PROFIT_TEAL : 'var(--danger)' }}>{eur2(r.profitEur)}</td>
                <td className="mono border-b border-n-100 px-3 py-2 text-right text-n-700">{pctStr(r.profitPct)}</td>
                <td className="mono border-b border-n-100 px-3 py-2 text-right text-n-700">{eur2(r.feesEur)}</td>
                <td className="mono border-b border-n-100 px-3 py-2 text-right text-n-700">{eur2(r.avgFeeEur)}</td>
                <td className="mono border-b border-n-100 px-3 py-2 text-right text-n-700">{num(r.units)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-n-400">{label}</span>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 text-[15px] font-semibold text-n-800">{children}</h2>;
}

function DeltaText({ v, good }: { v: number; good: boolean }) {
  const Icon = v >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${good ? 'text-success' : 'text-danger'}`}>
      <Icon size={12} />{Math.abs(v).toFixed(1)}%
    </span>
  );
}

function Kpi({ label, value, cur, prev, positiveGood, accent, suffix, isPointDelta }: {
  label: string; value: string; cur: number; prev?: number | null; positiveGood: boolean; accent?: boolean; suffix?: string; isPointDelta?: boolean;
}) {
  let delta: number | null = null;
  if (prev != null && (isPointDelta || prev !== 0)) delta = isPointDelta ? cur - prev : ((cur - prev) / Math.abs(prev)) * 100;
  const up = (delta ?? 0) >= 0;
  const good = up === positiveGood;
  return (
    <div className={`rounded-lg border p-3.5 ${accent ? 'border-teal-200 bg-teal-50/40' : 'border-n-200 bg-n-0'}`}>
      <div className="text-[11.5px] font-medium text-n-500">{label}</div>
      <div className="mono mt-1 text-[22px] font-semibold text-n-900">{value}</div>
      {delta != null ? (
        <div className={`mt-1 inline-flex items-center gap-0.5 text-[12px] font-medium ${good ? 'text-success' : 'text-danger'}`}>
          {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
          {isPointDelta ? `${Math.abs(delta).toFixed(1)}${suffix ?? ''}` : `${Math.abs(delta).toFixed(1)}%`}
          <span className="ml-1 font-normal text-n-400">vs prev</span>
        </div>
      ) : <div className="mt-1 text-[12px] text-n-300">no comparison</div>}
    </div>
  );
}

function ChannelBars({ title, rows, pick, color, signed }: {
  title: string; rows: AnalyticsChannelRow[]; pick: (r: AnalyticsChannelRow) => number; color: string; signed?: boolean;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(pick(r))));
  return (
    <div className="card p-4">
      <div className="mb-3 text-[13px] font-semibold text-n-800">{title}</div>
      <div className="flex flex-col gap-2.5">
        {rows.length === 0 && <div className="py-4 text-center text-[12.5px] text-n-400">No data</div>}
        {rows.map((r) => {
          const v = pick(r);
          const w = (Math.abs(v) / max) * 100;
          const neg = signed && v < 0;
          return (
            <div key={r.channelId ?? 'none'} className="flex items-center gap-2.5">
              <div className="w-28 shrink-0 truncate text-[12px] text-n-600" title={r.channelName}>{r.channelName}</div>
              <div className="relative h-5 flex-1 rounded bg-n-100">
                <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${w}%`, background: neg ? 'var(--danger)' : color }} />
              </div>
              <div className="mono w-24 shrink-0 text-right text-[12px] font-medium text-n-700">{eur(v)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrendChart({ points }: { points: { bucket: string; revenueExVatEur: number; profitEur: number }[] }) {
  if (points.length === 0) return null;
  const W = 900, H = 200, padL = 8, padR = 8, padT = 12, padB = 22;
  const maxV = Math.max(1, ...points.map((p) => Math.max(p.revenueExVatEur, p.profitEur)));
  const minV = Math.min(0, ...points.map((p) => p.profitEur));
  const span = maxV - minV || 1;
  const n = points.length;
  const x = (i: number) => padL + (n === 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => padT + (1 - (v - minV) / span) * (H - padT - padB);
  const line = (key: 'revenueExVatEur' | 'profitEur') => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center gap-4">
        <div className="text-[13px] font-semibold text-n-800"><TrendingUp size={14} className="mr-1 inline opacity-60" />Revenue &amp; profit trend</div>
        <span className="inline-flex items-center gap-1 text-[11.5px] text-n-500"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: '#0EA5A0' }} /> Revenue</span>
        <span className="inline-flex items-center gap-1 text-[11.5px] text-n-500"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: PROFIT_TEAL }} /> Profit</span>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[200px] w-full min-w-[560px]">
          <line x1={padL} y1={y(0)} x2={W - padR} y2={y(0)} stroke="var(--n-200)" strokeWidth="1" />
          <path d={line('revenueExVatEur')} fill="none" stroke="#0EA5A0" strokeWidth="2" />
          <path d={line('profitEur')} fill="none" stroke={PROFIT_TEAL} strokeWidth="2" strokeDasharray="4 3" />
          {points.map((p, i) => (
            <g key={p.bucket}>
              <circle cx={x(i)} cy={y(p.revenueExVatEur)} r="2.5" fill="#0EA5A0" />
              <circle cx={x(i)} cy={y(p.profitEur)} r="2.5" fill={PROFIT_TEAL} />
              {(n <= 16 || i % Math.ceil(n / 16) === 0) && (
                <text x={x(i)} y={H - 6} textAnchor="middle" className="fill-n-400" style={{ fontSize: 9 }}>{p.bucket.length > 7 ? p.bucket.slice(5) : p.bucket}</text>
              )}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
