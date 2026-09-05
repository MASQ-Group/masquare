/** Two-letter avatar initials from a name (e.g. "A.M.A. MASQUARE LTD" -> "AM"). */
export function initials(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '–';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: '€', USD: '$', GBP: '£', JPY: '¥', AUD: 'A$', CAD: 'C$', NZD: 'NZ$', SGD: 'S$',
};

/** Currency symbol for a code, e.g. EUR→€, JPY→¥, AUD→A$; unknown codes fall back to "AED ". */
export const currencySymbol = (currency?: string | null) =>
  currency ? CURRENCY_SYMBOL[currency] ?? `${currency} ` : '';

/** An amount with its currency symbol, e.g. ¥7788.00 / A$795.00. */
export const formatAmount = (amount: number, currency?: string | null) =>
  `${currencySymbol(currency)}${amount.toFixed(2)}`;

/**
 * The same figure in euro, for a card that quotes a marketplace's own currency.
 *
 * Returns null when the marketplace already trades in euro — "€12.34 (€12.34)" is noise, and a
 * repeated number invites the reader to look for a difference that isn't there.
 *
 * The euro value itself is always converted by the API at the rate the costs came in on. Nothing
 * here does arithmetic: a second conversion in the browser is a second answer.
 */
export const eurAside = (eurCents: number | null | undefined, currency?: string | null): string | null => {
  if (eurCents == null) return null;
  if ((currency ?? 'EUR').toUpperCase() === 'EUR') return null;
  return formatAmount(eurCents / 100, 'EUR');
};

/** Money as a right-aligned mono string, e.g. €50.00. Null amount renders as "—". */
export function formatMoney(money?: { amount: number | null; currency: string } | null): string {
  if (!money || money.amount == null) return '—';
  return formatAmount(money.amount, money.currency);
}

/** dd/mm/yyyy — the platform default (Global Settings will make this configurable). */
export function formatDate(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}
