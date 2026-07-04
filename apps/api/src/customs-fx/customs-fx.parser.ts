/** Parser for the Cyprus Customs monthly exchange-rate CSV (data.gov.cy).
 *
 * Shape: `Month,Year,USD (United States Dollar),JPY (Japanese Yen),…` then one
 * row per month. Values are units of the foreign currency per 1 EUR; missing
 * values are `-`. The file is cumulative (every month since 2016).
 */

export interface ParsedRate {
  year: number;
  month: number; // 1-12
  currencyCode: string;
  currencyName: string | null;
  rate: number;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// The source header occasionally mangles non-ASCII text. Fix the few known codes
// whose leading token isn't a clean 3-letter code.
const CODE_FIXUPS: Record<string, string> = { RU: 'RUB' };

// Clean English names, keyed by code — used in place of the (sometimes garbled)
// parenthetical text in the source header. Falls back to the parsed name.
const CURRENCY_NAMES: Record<string, string> = {
  USD: 'United States Dollar', JPY: 'Japanese Yen', DKK: 'Danish Krone', GBP: 'Pound Sterling',
  SEK: 'Swedish Krona', CHF: 'Swiss Franc', ISK: 'Icelandic Krona', NOK: 'Norwegian Krone',
  BGN: 'Bulgarian Lev', CZK: 'Czech Koruna', HUF: 'Hungarian Forint', PLN: 'Polish Zloty',
  RON: 'Romanian Leu', TRY: 'Turkish Lira', AUD: 'Australian Dollar', CAD: 'Canadian Dollar',
  HKD: 'Hong Kong Dollar', NZD: 'New Zealand Dollar', SGD: 'Singapore Dollar', KRW: 'Korean Republic Won',
  ZAR: 'South African Rand', CNY: 'Chinese Yuan', HRK: 'Croatian Kuna', IDR: 'Indonesian Rupiah',
  MYR: 'Malaysian Ringgit', PHP: 'Philippine Peso', RUB: 'Russian Ruble', THB: 'Thai Baht',
  BRL: 'Brazilian Real', MXN: 'Mexican Peso', INR: 'Indian Rupee', JOD: 'Jordanian Dinar',
  KWD: 'Kuwaiti Dinar', BHD: 'Bahraini Dinar', TWD: 'New Taiwan Dollar', EGP: 'Egyptian Pound',
  LBP: 'Lebanese Pound', AED: 'United Arab Emirates Dirham', QAR: 'Qatari Riyal', OMR: 'Omani Rial',
  SAR: 'Saudi Riyal', ILS: 'Israeli Shekel', RSD: 'Serbian Dinar', UAH: 'Ukrainian Hryvnia',
  BYR: 'Belarusian Ruble (old)', SYP: 'Syrian Pound', BYN: 'Belarusian Ruble',
};

interface Column {
  code: string;
  name: string | null;
}

function parseColumn(header: string): Column | null {
  const m = header.match(/^\s*([A-Za-z]{2,4})/);
  if (!m) return null;
  let code = m[1].toUpperCase();
  code = CODE_FIXUPS[code] ?? code;
  const parenName = header.match(/\(([^)]*)\)/)?.[1]?.trim() || null;
  return { code, name: CURRENCY_NAMES[code] ?? parenName };
}

/** Minimal CSV row split — the source uses no quoting, so a plain split is safe. */
function splitRow(line: string): string[] {
  return line.split(',').map((c) => c.trim());
}

export function parseCustomsFxCsv(csv: string): ParsedRate[] {
  const text = csv.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = splitRow(lines[0]);
  // Columns 0 and 1 are Month, Year; the rest are currencies.
  const columns = header.slice(2).map(parseColumn);

  const out: ParsedRate[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitRow(lines[i]);
    const monthName = (cells[0] ?? '').toLowerCase();
    const month = MONTHS[monthName];
    const year = Number(cells[1]);
    if (!month || !Number.isFinite(year)) continue;

    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      if (!col) continue;
      const raw = cells[c + 2];
      if (raw == null || raw === '' || raw === '-') continue;
      const rate = Number(raw.replace(/\s/g, ''));
      if (!Number.isFinite(rate) || rate <= 0) continue;
      out.push({ year, month, currencyCode: col.code, currencyName: col.name, rate });
    }
  }
  return out;
}
