/** ISO 4217 currency codes used platform-wide (Global Data Considerations §Currencies). */
export const CURRENCIES: { code: string; name: string }[] = [
  { code: 'EUR', name: 'Euro' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'GBP', name: 'Pound Sterling' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'SEK', name: 'Swedish Krona' },
  { code: 'NOK', name: 'Norwegian Krone' },
  { code: 'DKK', name: 'Danish Krone' },
  { code: 'PLN', name: 'Polish Złoty' },
  { code: 'CZK', name: 'Czech Koruna' },
  { code: 'HUF', name: 'Hungarian Forint' },
  { code: 'RON', name: 'Romanian Leu' },
  { code: 'BGN', name: 'Bulgarian Lev' },
  { code: 'TRY', name: 'Turkish Lira' },
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'SAR', name: 'Saudi Riyal' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'HKD', name: 'Hong Kong Dollar' },
  { code: 'KRW', name: 'South Korean Won' },
  { code: 'ZAR', name: 'South African Rand' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'MXN', name: 'Mexican Peso' },
  { code: 'ILS', name: 'Israeli New Shekel' },
];

/**
 * Flag to show against a currency, as an ISO 3166-1 alpha-2 code.
 *
 * ISO 4217 builds a currency code from its country's ISO 3166 code plus a letter for
 * the currency name, so the first two characters are the flag for almost everything.
 * Only the supranational and shared currencies need spelling out.
 */
const CURRENCY_FLAG_OVERRIDES: Record<string, string> = {
  EUR: 'eu', // the Union, not a country
  XAF: 'cf',
  XOF: 'sn',
  XCD: 'ag',
  XPF: 'pf',
};

export function currencyFlagCode(code: string): string {
  const c = (code ?? '').trim().toUpperCase();
  return CURRENCY_FLAG_OVERRIDES[c] ?? c.slice(0, 2).toLowerCase();
}

/**
 * How many decimal places a currency actually has.
 *
 * Yen has none, and Amazon JP rejects any price carrying them — "has 2 decimal places but the
 * maximum allowed is '0'". The API refuses such a price too; this is so nobody can type one and
 * find out after pressing send. Mirrors apps/api/src/common/currency-precision.ts, which is the
 * authority: this side only decides what the box will accept.
 */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF', 'TWD']);

export const isZeroDecimalCurrency = (currency?: string | null): boolean =>
  ZERO_DECIMAL.has((currency ?? '').toUpperCase());

export const decimalsForCurrency = (currency?: string | null): 0 | 2 =>
  (isZeroDecimalCurrency(currency) ? 0 : 2);

/**
 * Keep a typed price to what its currency can express.
 *
 * Applied as the person types rather than on submit: a box that silently drops what you typed at
 * the end is worse than one that never accepted it.
 */
export function limitPriceInput(raw: string, currency?: string | null): string {
  const cleaned = raw.replace(',', '.').replace(/[^\d.]/g, '');
  if (isZeroDecimalCurrency(currency)) return cleaned.split('.')[0];
  const [whole, ...rest] = cleaned.split('.');
  return rest.length === 0 ? whole : `${whole}.${rest.join('').slice(0, 2)}`;
}

/**
 * The one currency a marketplace trades in.
 *
 * Needed before any figure comes back from the API — a price box has to know what it will accept
 * the moment it is drawn, and whether decimals are allowed is a property of the marketplace, not
 * of a response that has not arrived yet.
 */
const MARKETPLACE_CURRENCY: Record<string, string> = {
  US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL', UK: 'GBP', GB: 'GBP',
  IE: 'EUR', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', BE: 'EUR',
  SE: 'SEK', PL: 'PLN', TR: 'TRY', EG: 'EGP', SA: 'SAR', AE: 'AED',
  IN: 'INR', ZA: 'ZAR', JP: 'JPY', AU: 'AUD', SG: 'SGD',
};

export const currencyForMarketplace = (marketplace?: string | null): string =>
  MARKETPLACE_CURRENCY[(marketplace ?? '').toUpperCase()] ?? 'EUR';
