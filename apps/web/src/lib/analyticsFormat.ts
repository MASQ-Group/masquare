// Shared number/money formatting for the Analytics module. EUR figures use the
// en-IE locale (comma thousands, € prefix) to match the design's "€12,480" style.

export const eur = (v: number | null | undefined) =>
  v == null ? '—' : new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);

export const eur2 = (v: number | null | undefined) =>
  v == null ? '—' : new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(v);

/** Signed EUR, e.g. "+€2,140" / "−€410" — for deltas and movers. */
export const eurSigned = (v: number | null | undefined) => {
  if (v == null) return '—';
  const s = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Math.abs(v));
  return (v >= 0 ? '+' : '−') + s;
};

/** Compact EUR for axis labels, e.g. "€12.4k". */
export const eurK = (v: number) => (Math.abs(v) >= 1000 ? `€${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : `€${Math.round(v)}`);

export const num = (v: number | null | undefined) =>
  v == null ? '—' : new Intl.NumberFormat('en-IE').format(Math.round(v));

export const pctStr = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)}%`);

/** Percentage change from prev→cur, or null when there's no usable base. */
export const pctChange = (cur: number, prev?: number | null): number | null =>
  prev == null || prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100;

/** Colour tokens reused across the analytics charts. */
export const C = {
  teal: '#14A79D',
  tealDark: '#0E7A73',
  tealSoft: '#0EA5A0',
  lime: '#8DC73F',
  orange: '#F1592A',
  danger: '#C63B1B',
  warn: '#B26A00',
  neutralBar: '#C7D2CD',
  deduction: '#D98A76',
};
