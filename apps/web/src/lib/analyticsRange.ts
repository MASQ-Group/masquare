// Date-range helpers for the analytics presets. All values are YYYY-MM-DD strings.

export type RangePreset = 'mtd' | 'prev_month' | 'ytd' | 'year' | 'quarter' | 'custom';
export type ComparePreset = 'prev_month' | 'prev_period' | 'prev_year' | 'custom' | 'none';

export interface DateRange { from: string; to: string }

const pad = (n: number) => String(n).padStart(2, '0');
export const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);

export function presetRange(preset: RangePreset, opts: { year?: number; quarter?: number; custom?: DateRange }): DateRange {
  const now = new Date();
  const y = now.getFullYear();
  switch (preset) {
    case 'mtd':
      return { from: fmt(new Date(y, now.getMonth(), 1)), to: fmt(now) };
    case 'prev_month': {
      const first = new Date(y, now.getMonth() - 1, 1);
      const last = new Date(y, now.getMonth(), 0);
      return { from: fmt(first), to: fmt(last) };
    }
    case 'ytd':
      return { from: fmt(new Date(y, 0, 1)), to: fmt(now) };
    case 'year': {
      const yr = opts.year ?? y;
      return { from: fmt(new Date(yr, 0, 1)), to: fmt(new Date(yr, 11, 31)) };
    }
    case 'quarter': {
      const yr = opts.year ?? y;
      const q = opts.quarter ?? Math.floor(now.getMonth() / 3) + 1;
      const startMonth = (q - 1) * 3;
      return { from: fmt(new Date(yr, startMonth, 1)), to: fmt(new Date(yr, startMonth + 3, 0)) };
    }
    case 'custom':
      return opts.custom ?? { from: fmt(new Date(y, now.getMonth(), 1)), to: fmt(now) };
  }
}

export function compareRange(main: DateRange, preset: ComparePreset, custom?: DateRange): DateRange | null {
  if (preset === 'none') return null;
  if (preset === 'custom') return custom ?? null;
  const from = parse(main.from);
  const to = parse(main.to);
  if (preset === 'prev_month') {
    const f = new Date(from); f.setMonth(f.getMonth() - 1);
    const t = new Date(to); t.setMonth(t.getMonth() - 1);
    return { from: fmt(f), to: fmt(t) };
  }
  if (preset === 'prev_year') {
    const f = new Date(from); f.setFullYear(f.getFullYear() - 1);
    const t = new Date(to); t.setFullYear(t.getFullYear() - 1);
    return { from: fmt(f), to: fmt(t) };
  }
  // prev_period — the equal-length window immediately before the main range.
  const len = daysBetween(from, to);
  const t = new Date(from); t.setDate(t.getDate() - 1);
  const f = new Date(t); f.setDate(f.getDate() - len);
  return { from: fmt(f), to: fmt(t) };
}

export const prettyRange = (r: DateRange) => `${r.from} → ${r.to}`;
