import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Download, FileText } from 'lucide-react';
import { pctChange } from '../../lib/analyticsFormat';
import { Sparkline } from './charts';

/** Page header: "ANALYTICS" kicker, title, range-echoing subtitle, right-aligned actions. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-1">
        <div className="eyebrow mb-1">Analytics</div>
        <h1 className="text-[24px] font-semibold tracking-tight text-n-900">{title}</h1>
        <p className="mt-1 text-[13.5px] text-n-500">{subtitle}</p>
      </div>
      {actions && <div className="flex shrink-0 gap-2 pt-1">{actions}</div>}
    </div>
  );
}

/** The two standard outline actions shown on every analytics page header. */
export function HeaderActions({ onExport, onPdf }: { onExport?: () => void; onPdf?: () => void }) {
  return (
    <>
      <button className="btn btn-ghost" onClick={onExport}><Download size={15} />Export CSV</button>
      <button className="btn btn-ghost" onClick={onPdf}><FileText size={15} />PDF snapshot</button>
    </>
  );
}

/** Standard white panel with a title + optional subtitle and right-slot. */
export function SectionCard({ title, subtitle, right, children, className }: {
  title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <div className={`card p-5 ${className ?? ''}`}>
      {(title || right) && (
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {title && <div className="text-[15px] font-semibold text-n-900">{title}</div>}
          {subtitle && <div className="text-[12.5px] text-n-500">{subtitle}</div>}
          {right && <div className="ml-auto flex items-center gap-2 self-center">{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

/** Inline coloured delta, e.g. "↗ 12.4%". `good` drives green/red. */
export function DeltaText({ v, good, suffix, className }: { v: number; good: boolean; suffix?: string; className?: string }) {
  const Icon = v >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${good ? 'text-success' : 'text-danger'} ${className ?? ''}`}>
      <Icon size={12} />{Math.abs(v).toFixed(1)}{suffix ?? '%'}
    </span>
  );
}

/** KPI stat tile with header delta, big value, optional sparkline and "vs prev" line. */
export function Kpi({ label, value, cur, prev, positiveGood, accent, suffix, isPointDelta, spark, prevLabel, tip }: {
  label: string; value: string; cur: number; prev?: number | null; positiveGood: boolean;
  accent?: boolean; suffix?: string; isPointDelta?: boolean; spark?: number[]; prevLabel?: string; tip?: string;
}) {
  let delta: number | null = null;
  if (prev != null && (isPointDelta || prev !== 0)) delta = isPointDelta ? cur - prev : pctChange(cur, prev);
  const up = (delta ?? 0) >= 0;
  const good = up === positiveGood;
  return (
    <div title={tip} className={`card cursor-default p-4 transition-shadow hover:shadow-md ${accent ? 'border-teal-200 bg-teal-50/40' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-n-500">{label}</span>
        {delta != null && (
          <span className={`inline-flex items-center gap-0.5 text-[12px] font-semibold ${good ? 'text-success' : 'text-danger'}`}>
            {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {isPointDelta ? `${Math.abs(delta).toFixed(1)}${suffix ?? 'pp'}` : `${Math.abs(delta).toFixed(1)}%`}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="mono text-[23px] font-semibold leading-none text-n-900">{value}</div>
        {spark && spark.length > 1 && <Sparkline values={spark} color={good ? 'var(--teal-500)' : 'var(--danger)'} />}
      </div>
      <div className="mt-1.5 text-[11px] text-n-400">{prev != null ? `vs prev · ${prevLabel ?? ''}` : 'no comparison'}</div>
    </div>
  );
}

/** Small segmented pill toggle (Day/Week, Revenue/Profit, …). */
export function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string; disabled?: boolean }[];
}) {
  return (
    <div className="inline-flex rounded-md bg-n-100 p-[3px]">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            disabled={o.disabled}
            onClick={() => !o.disabled && onChange(o.value)}
            className={`rounded-[6px] px-3 py-[5px] text-[12.5px] font-semibold transition-colors ${
              active ? 'bg-n-0 text-n-900 shadow-sm' : o.disabled ? 'cursor-not-allowed text-n-300' : 'text-n-500 hover:text-n-700'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Margin pill: green ≥23%, amber 15–23%, red <15% (matches the design bands). */
export function marginTone(pct: number | null): { color: string; bg: string } {
  if (pct == null) return { color: 'var(--n-500)', bg: 'var(--n-100)' };
  if (pct < 15) return { color: 'var(--danger)', bg: '#FBEDEA' };
  if (pct < 23) return { color: '#B26A00', bg: '#FDF3E4' };
  return { color: 'var(--success)', bg: '#E8F4F2' };
}
