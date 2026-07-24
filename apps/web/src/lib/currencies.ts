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
