import { useMemo, useState, type ReactNode } from 'react';
import { C } from '../../lib/analyticsFormat';
import { DAY_MS, chartModel, stepPath, valueAt, xTicks } from '../../lib/priceChartModel';
import type { RepricingDailyStat, RepricingPricePoint, RepricingSamplePoint } from '../../lib/api';

/**
 * One SKU's price over time, with the market it was pricing against and what it sold.
 *
 * Drawn on a real time axis rather than a row per event: a day with forty reprices and a fortnight
 * with none are both true, and an evenly spaced axis would tell neither story. The rules behind the
 * lines — the step, the band, the fallback to samples — live in priceChartModel.ts, tested; this is
 * the drawing.
 */

const PANEL = { w: 1000, price: 250, units: 62, gap: 10 };

interface Props {
  prices: RepricingPricePoint[];
  samples: RepricingSamplePoint[];
  daily: RepricingDailyStat[];
  from: string;
  to: string;
  currency: string | null;
  /** Drawn flat where no floor was sampled: the floor the engine prices against today. */
  floorCents?: number | null;
}

export function PriceHistoryChart({ prices, samples, daily, from, to, currency, floorCents }: Props) {
  const [hoverT, setHoverT] = useState<number | null>(null);

  const t0 = new Date(from).getTime();
  // The span ends at the END of its last day, so today's points are not drawn off the right edge.
  const t1 = new Date(to).getTime() + DAY_MS;

  const m = useMemo(() => chartModel({ prices, samples, daily, floorCents }), [prices, samples, daily, floorCents]);

  const x = (t: number) => ((Math.min(Math.max(t, t0), t1) - t0) / Math.max(1, t1 - t0)) * PANEL.w;
  const y = (v: number) => PANEL.price - ((v - m.lo) / Math.max(1, m.hi - m.lo)) * PANEL.price;

  const money = (cents: number | null | undefined) => {
    if (cents == null) return '—';
    const ccy = (currency ?? 'EUR').toUpperCase();
    const symbol = { EUR: '€', GBP: '£', USD: '$', SEK: 'kr ', PLN: 'zł ' }[ccy] ?? `${ccy} `;
    return `${symbol}${(cents / 100).toFixed(ccy === 'JPY' ? 0 : 2)}`;
  };

  const ticks = xTicks(t0, t1);
  const hoverDay = hoverT == null ? null : m.days.find((d) => hoverT >= d.t && hoverT < d.t + DAY_MS) ?? null;
  const H = PANEL.price + PANEL.gap + PANEL.units;

  if (m.empty) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed border-n-200 text-[12.5px] text-n-500">
        Nothing recorded for this SKU in this period.
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-3">
        <div className="flex w-12 shrink-0 flex-col justify-between pb-1 text-right text-[11px] tabular-nums text-n-400" style={{ height: PANEL.price }}>
          <span>{money(m.hi)}</span>
          <span>{money((m.hi + m.lo) / 2)}</span>
          <span>{money(m.lo)}</span>
        </div>
        <div
          className="relative min-w-0 flex-1"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setHoverT(t0 + ((e.clientX - r.left) / r.width) * (t1 - t0));
          }}
          onMouseLeave={() => setHoverT(null)}
        >
          <svg viewBox={`0 0 ${PANEL.w} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H }} className="block">
            {/* Gridlines at the three labelled prices, so a reading can be taken off the chart. */}
            {[0, 0.5, 1].map((f) => (
              <line key={f} x1="0" y1={PANEL.price * f} x2={PANEL.w} y2={PANEL.price * f} stroke="var(--n-100)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            {ticks.map((t) => (
              <line key={t} x1={x(t)} y1="0" x2={x(t)} y2={PANEL.price} stroke="var(--n-50)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}

            {/* The floor: the line the engine will not price below. Stepped where we sampled it. */}
            {m.floors.length > 0 ? (
              <path d={stepPath(m.floors, x, y, PANEL.w)} fill="none" stroke={C.warn} strokeWidth="1.4" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" opacity="0.8" />
            ) : floorCents != null ? (
              <line x1="0" y1={y(floorCents)} x2={PANEL.w} y2={y(floorCents)} stroke={C.warn} strokeWidth="1.4" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" opacity="0.8" />
            ) : null}

            {/* The Buy Box as a plain line: a series of observations, not a price we held. */}
            {m.buyBox.length > 1 && (
              <polyline points={m.buyBox.map((p) => `${x(p.t)},${y(p.v)}`).join(' ')} fill="none" stroke={C.orange} strokeWidth="1.6" vectorEffect="non-scaling-stroke" opacity="0.85" />
            )}

            <path d={stepPath(m.ourLine, x, y, PANEL.w)} fill="none" stroke={C.teal} strokeWidth="2.4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {/* A dot per price we set, while there are few enough to tell apart. */}
            {m.ourLine.length <= 300 && m.ourLine.map((p, i) => (
              <circle key={i} cx={x(p.t)} cy={y(p.v)} r="2.6" fill={C.teal} />
            ))}

            {/* Units sold per day, sharing the x-axis: reading these against the line above them is
                the whole point of the chart. */}
            <line x1="0" y1={H} x2={PANEL.w} y2={H} stroke="var(--n-200)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {m.days.filter((d) => d.units > 0).map((d) => {
              const h = (d.units / m.maxUnits) * PANEL.units;
              const w = Math.max(3, (DAY_MS / Math.max(1, t1 - t0)) * PANEL.w * 0.7);
              return (
                <rect
                  key={d.t}
                  x={x(d.t + DAY_MS / 2) - w / 2}
                  y={H - h}
                  width={w}
                  height={h}
                  // Units that followed one of our changes are the ones being asked about, so they
                  // are the ones coloured; the rest stay neutral.
                  fill={d.afterChange > 0 ? C.tealSoft : C.neutralBar}
                  rx="1"
                />
              );
            })}

            {hoverDay && (
              <line x1={x(hoverDay.t + DAY_MS / 2)} y1="0" x2={x(hoverDay.t + DAY_MS / 2)} y2={H} stroke="var(--n-400)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            )}
          </svg>

          {hoverDay && (
            <div
              className="pointer-events-none absolute top-2 z-10 w-[190px] -translate-x-1/2 rounded-lg bg-n-900 px-3 py-2 text-[12px] text-n-0 shadow-lg"
              style={{ left: `${Math.min(88, Math.max(12, (x(hoverDay.t + DAY_MS / 2) / PANEL.w) * 100))}%` }}
            >
              <div className="mb-1 font-semibold">{new Date(hoverDay.t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</div>
              <Row label="Our price" value={money(valueAt(m.ourLine, hoverDay.t + DAY_MS - 1) ?? hoverDay.close)} />
              <Row label="Buy Box" value={money(valueAt(m.buyBox, hoverDay.t + DAY_MS - 1))} />
              <Row label="Changes" value={String(hoverDay.changes)} />
              <Row label="Units sold" value={String(hoverDay.units)} />
              {hoverDay.units > 0 && <Row label="After a change" value={String(hoverDay.afterChange)} />}
              {hoverDay.samples > 0 && <Row label="Buy Box won" value={`${Math.round((hoverDay.won / hoverDay.samples) * 100)}%`} />}
            </div>
          )}
        </div>
      </div>

      <div className="mt-1.5 flex justify-between pl-[60px] text-[11px] text-n-400">
        {ticks.map((t) => <span key={t}>{new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>)}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-[60px] text-[11.5px] text-n-600">
        <Key color={C.teal}>Our price</Key>
        <Key color={C.orange}>Buy Box</Key>
        <Key color={C.warn} dashed>Floor</Key>
        <Key color={C.tealSoft} block>Units sold after a change</Key>
        <Key color={C.neutralBar} block>Other units sold</Key>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-n-300">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Key({ color, dashed, block, children }: { color: string; dashed?: boolean; block?: boolean; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {block
        ? <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: color }} />
        : <span className="inline-block h-0 w-4 border-t-2" style={{ borderColor: color, borderTopStyle: dashed ? 'dashed' : 'solid' }} />}
      {children}
    </span>
  );
}
