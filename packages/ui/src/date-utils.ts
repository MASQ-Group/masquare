// Pure-JS date helpers for the date pickers (no external deps). All dates are handled
// as local calendar days; values cross the component boundary as ISO "YYYY-MM-DD".

export type DisplayFormat = 'dd/mm/yyyy' | 'mm/dd/yyyy' | 'yyyy-mm-dd';
export type WeekStart = 0 | 1; // 0 = Sunday, 1 = Monday

export const pad = (n: number) => String(n).padStart(2, '0');
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function parseISO(s?: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : startOfDay(d);
}

export const sameDay = (a?: Date | null, b?: Date | null) =>
  !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

export function isBetween(d: Date, a: Date, b: Date): boolean {
  const t = startOfDay(d).getTime();
  const lo = Math.min(startOfDay(a).getTime(), startOfDay(b).getTime());
  const hi = Math.max(startOfDay(a).getTime(), startOfDay(b).getTime());
  return t > lo && t < hi;
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function weekdayLabels(weekStart: WeekStart): string[] {
  const base = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  return weekStart === 1 ? [...base.slice(1), base[0]] : base;
}

/** 6×7 grid of days covering the given month (with leading/trailing days flagged). */
export function monthGrid(year: number, month: number, weekStart: WeekStart): { date: Date; inMonth: boolean }[][] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const cur = new Date(year, month, 1 - lead);
  const weeks: { date: Date; inMonth: boolean }[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: { date: Date; inMonth: boolean }[] = [];
    for (let i = 0; i < 7; i++) {
      row.push({ date: new Date(cur), inMonth: cur.getMonth() === month });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(row);
  }
  return weeks;
}

export function formatDisplay(d: Date | null, format: DisplayFormat): string {
  if (!d) return '';
  const dd = pad(d.getDate());
  const mm = pad(d.getMonth() + 1);
  const yyyy = d.getFullYear();
  if (format === 'yyyy-mm-dd') return `${yyyy}-${mm}-${dd}`;
  if (format === 'mm/dd/yyyy') return `${mm}/${dd}/${yyyy}`;
  return `${dd}/${mm}/${yyyy}`;
}

function startOfWeek(d: Date, weekStart: WeekStart = 1): Date {
  const day = (d.getDay() - weekStart + 7) % 7;
  const s = new Date(d);
  s.setDate(d.getDate() - day);
  return startOfDay(s);
}

export interface RangePreset { key: string; label: string }
export const RANGE_PRESETS: RangePreset[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'this-week', label: 'This week' },
  { key: 'last-week', label: 'Last week' },
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'this-year', label: 'This year' },
  { key: 'last-year', label: 'Last year' },
  { key: 'all-time', label: 'All time' },
];

/** Resolve a preset key to a {from,to}. 'all-time' returns null (clears the range). */
export function presetRange(key: string): { from: Date; to: Date } | null {
  const today = startOfDay(new Date());
  const y = today.getFullYear();
  const mo = today.getMonth();
  const clone = (x: Date) => new Date(x);
  switch (key) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const d = clone(today); d.setDate(d.getDate() - 1); return { from: d, to: d }; }
    case 'this-week': { const s = startOfWeek(today); const e = clone(s); e.setDate(e.getDate() + 6); return { from: s, to: e }; }
    case 'last-week': { const s = startOfWeek(today); s.setDate(s.getDate() - 7); const e = clone(s); e.setDate(e.getDate() + 6); return { from: s, to: e }; }
    case 'this-month': return { from: new Date(y, mo, 1), to: new Date(y, mo + 1, 0) };
    case 'last-month': return { from: new Date(y, mo - 1, 1), to: new Date(y, mo, 0) };
    case 'this-year': return { from: new Date(y, 0, 1), to: new Date(y, 11, 31) };
    case 'last-year': return { from: new Date(y - 1, 0, 1), to: new Date(y - 1, 11, 31) };
    case 'all-time': return null;
    default: return null;
  }
}
