import { useState, type ReactNode } from 'react';
import { C, eurK } from '../../lib/analyticsFormat';

/** Tiny KPI sparkline. Values are auto-scaled to the 80×26 box. */
export function Sparkline({ values, color, width = 80, height = 26 }: { values: number[]; color: string; width?: number; height?: number }) {
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const span = mx - mn || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * (width - 2) + 1},${height - 2 - ((v - mn) / span) * (height - 4)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="shrink-0 overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface TrendSeries<T> { key: keyof T; label: string; color: string; dashed?: boolean; area?: boolean }

/** Multi-series area/line trend with a zero baseline, y-axis labels, x-axis ticks,
 *  an optional faint previous-period overlay, and a hover guide + tooltip. */
export function TrendChart<T extends Record<string, any>>({ points, series, prev, prevKey, format, xLabels, height = 220 }: {
  points: T[];
  series: TrendSeries<T>[];
  prev?: T[] | null;
  prevKey?: keyof T;
  format: (v: number) => string;
  xLabels: string[];
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return <div className="py-10 text-center text-[12.5px] text-n-400">No data in this range.</div>;

  const W = 1000, H = 220, padT = 6, padB = 4;
  const vals: number[] = [];
  for (const p of points) for (const s of series) vals.push(Number(p[s.key]) || 0);
  const pk = prevKey ?? series[0].key;
  if (prev) for (const p of prev) vals.push(Number(p[pk]) || 0);
  const maxV = Math.max(1, ...vals);
  const minV = Math.min(0, ...vals);
  const span = maxV - minV || 1;
  const n = points.length;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => padT + (1 - (v - minV) / span) * (H - padT - padB);
  const path = (arr: T[], key: keyof T) => arr.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(Number(p[key]) || 0).toFixed(1)}`).join(' ');
  const areaPath = (key: keyof T) => `${path(points, key)} L${x(n - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  };
  const yTop = format(maxV);
  const yMid = format(minV + span / 2);

  return (
    <div>
      <div className="flex gap-3">
        <div className="flex shrink-0 flex-col justify-between pb-1 text-right text-[11px] tabular-nums text-n-400" style={{ height }}>
          <span>{yTop}</span><span>{yMid}</span><span>{format(minV)}</span>
        </div>
        <div className="relative flex-1" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height }} className="block">
            <line x1="0" y1={padT} x2={W} y2={padT} stroke="var(--n-100)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <line x1="0" y1={y(minV + span / 2)} x2={W} y2={y(minV + span / 2)} stroke="var(--n-100)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <line x1="0" y1={y(0)} x2={W} y2={y(0)} stroke="var(--n-200)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {prev && <polyline points={prev.map((p, i) => `${x(i)},${y(Number(p[pk]) || 0)}`).join(' ')} fill="none" stroke="#C9D4D0" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />}
            {series.filter((s) => s.area).map((s) => <path key={`ar-${String(s.key)}`} d={areaPath(s.key)} fill={s.color} opacity="0.08" />)}
            {series.map((s) => (
              <path key={String(s.key)} d={path(points, s.key)} fill="none" stroke={s.color} strokeWidth="2.2"
                strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            ))}
            {hover != null && <line x1={x(hover)} y1={padT} x2={x(hover)} y2={H} stroke="var(--n-400)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
          </svg>
          {hover != null && (
            <div
              className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-n-900 px-3 py-2 text-[12px] text-n-0 shadow-lg"
              style={{ left: `${n === 1 ? 50 : (hover / (n - 1)) * 100}%` }}
            >
              <div className="mb-1 font-semibold">{String((points[hover] as any).bucket ?? xLabels[hover] ?? '')}</div>
              {series.map((s) => (
                <div key={String(s.key)} className="flex justify-between gap-4">
                  <span style={{ color: '#8DD5CF' }}>{s.label}</span>
                  <span className="tabular-nums">{format(Number(points[hover][s.key]) || 0)}</span>
                </div>
              ))}
              {prev && (
                <div className="flex justify-between gap-4">
                  <span className="text-n-400">Prev</span>
                  <span className="tabular-nums text-n-300">{format(Number(prev[hover]?.[pk]) || 0)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 flex justify-between pl-11 text-[11px] text-n-400">
        {xLabels.map((l, i) => <span key={i}>{l}</span>)}
      </div>
    </div>
  );
}

/** Legend swatch used above trend charts. */
export function LegendDot({ color, dashed, children }: { color: string; dashed?: boolean; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-n-500">
      {dashed
        ? <span className="inline-block w-3.5 border-t-2 border-dashed" style={{ borderColor: color }} />
        : <span className="inline-block h-[2.5px] w-3.5 rounded" style={{ background: color }} />}
      {children}
    </span>
  );
}

export interface RankedRow { key: string; name: ReactNode; value: number; display: string; badge?: ReactNode; onClick?: () => void }

/** Horizontal ranked bars (revenue/orders/margin by channel). */
export function RankedBars({ rows, color = C.teal, nameWidth = 100 }: { rows: RankedRow[]; color?: string; nameWidth?: number }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="flex flex-col gap-0.5">
      {rows.length === 0 && <div className="py-4 text-center text-[12.5px] text-n-400">No data</div>}
      {rows.map((r) => (
        <div key={r.key} onClick={r.onClick}
          className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 ${r.onClick ? 'cursor-pointer hover:bg-n-50' : ''}`}>
          <span className="shrink-0 truncate text-[13px] font-medium text-n-800" style={{ width: nameWidth }} title={typeof r.name === 'string' ? r.name : undefined}>{r.name}</span>
          {r.badge}
          <div className="h-[9px] flex-1 overflow-hidden rounded-full bg-n-100">
            <div className="h-full rounded-full" style={{ width: `${(Math.abs(r.value) / max) * 100}%`, background: r.value < 0 ? 'var(--danger)' : color }} />
          </div>
          <span className="mono w-[74px] shrink-0 text-right text-[13px] font-medium text-n-700">{r.display}</span>
        </div>
      ))}
    </div>
  );
}

export interface WaterfallStep { label: string; sub?: string; value: number; from: number; to: number; total?: boolean }

/** Profit waterfall — totals (from 0) as solid teal/dark bars, deductions as
 *  floating bars spanning [from,to]. `value` is the signed figure shown above each. */
export function Waterfall({ steps, format, height = 250 }: { steps: WaterfallStep[]; format: (v: number) => string; height?: number }) {
  const top = Math.max(...steps.flatMap((s) => [s.from, s.to]), 1);
  return (
    <div className="flex items-stretch gap-4">
      {steps.map((st) => {
        const hi = Math.max(st.from, st.to);
        const lo = Math.min(st.from, st.to);
        const topPct = (1 - hi / top) * 100;
        const hPct = ((hi - lo) / top) * 100;
        const isNet = st.total && st.label.toLowerCase().includes('profit');
        const color = !st.total ? C.deduction : isNet ? C.tealDark : C.teal;
        const valColor = !st.total ? 'var(--danger)' : isNet ? C.tealDark : 'var(--n-900)';
        return (
          <div key={st.label} className="flex min-w-0 flex-1 flex-col">
            <div className="relative" style={{ height }}>
              <div className="absolute inset-x-0 rounded-md" style={{ top: `${topPct}%`, height: `${Math.max(hPct, 0.6)}%`, background: color }} />
              <div className="absolute inset-x-0 text-center text-[13.5px] font-semibold tabular-nums" style={{ top: `calc(${topPct}% - 22px)`, color: valColor }}>
                {(st.value < 0 ? '−' : '') + format(Math.abs(st.value))}
              </div>
            </div>
            <div className="mt-2.5 text-center text-[12.5px] font-medium text-n-700">{st.label}</div>
            {st.sub && <div className="mt-0.5 text-center text-[11px] text-n-400">{st.sub}</div>}
          </div>
        );
      })}
    </div>
  );
}

/** Vertical histogram (margin distribution). */
export function Histogram({ bars, height = 210 }: { bars: { band: string; count: number; color: string }[]; height?: number }) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  return (
    <div>
      <div className="flex items-end gap-3.5 px-1.5" style={{ height }}>
        {bars.map((b) => (
          <div key={b.band} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
            <span className="mono text-[12.5px] font-semibold text-n-700">{b.count.toLocaleString('en-IE')}</span>
            <div className="w-full rounded-t-md" style={{ height: `${(b.count / max) * 100}%`, background: b.color }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-3.5 border-t border-n-100 px-1.5 pt-1.5">
        {bars.map((b) => <div key={b.band} className="flex-1 text-center text-[11.5px] font-medium text-n-500">{b.band}</div>)}
      </div>
    </div>
  );
}

/** Slim proportion bar for share-of-total cells. */
export function ShareBar({ pct, color = C.teal }: { pct: number; color?: string }) {
  return (
    <span className="relative block h-[7px] w-full overflow-hidden rounded bg-n-100">
      <span className="absolute inset-y-0 left-0 rounded" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </span>
  );
}

export { eurK };
