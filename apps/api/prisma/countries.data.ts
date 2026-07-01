// World countries for the Global Settings → Countries table.
// euVatZone / vatRate are derived from the EU_VAT map (EU member standard VAT rates).
// Non-EU countries default to 0% (per spec). ISO 3166-1 alpha-2 codes.

const EU_VAT: Record<string, number> = {
  AT: 20, BE: 21, BG: 20, HR: 25, CY: 19, CZ: 21, DK: 25, EE: 22, FI: 25.5, FR: 20,
  DE: 19, GR: 24, HU: 27, IE: 23, IT: 22, LV: 21, LT: 21, LU: 17, MT: 18, NL: 21,
  PL: 23, PT: 23, RO: 19, SK: 23, SI: 22, ES: 21, SE: 25,
};

// [name, alpha-2, continent]
const RAW: [string, string, string][] = [
  // Africa
  ['Algeria', 'DZ', 'Africa'], ['Angola', 'AO', 'Africa'], ['Benin', 'BJ', 'Africa'],
  ['Botswana', 'BW', 'Africa'], ['Burkina Faso', 'BF', 'Africa'], ['Burundi', 'BI', 'Africa'],
  ['Cabo Verde', 'CV', 'Africa'], ['Cameroon', 'CM', 'Africa'], ['Central African Republic', 'CF', 'Africa'],
  ['Chad', 'TD', 'Africa'], ['Comoros', 'KM', 'Africa'], ['Congo (Republic)', 'CG', 'Africa'],
  ['Congo (Democratic Republic)', 'CD', 'Africa'], ["Côte d'Ivoire", 'CI', 'Africa'], ['Djibouti', 'DJ', 'Africa'],
  ['Egypt', 'EG', 'Africa'], ['Equatorial Guinea', 'GQ', 'Africa'], ['Eritrea', 'ER', 'Africa'],
  ['Eswatini', 'SZ', 'Africa'], ['Ethiopia', 'ET', 'Africa'], ['Gabon', 'GA', 'Africa'],
  ['Gambia', 'GM', 'Africa'], ['Ghana', 'GH', 'Africa'], ['Guinea', 'GN', 'Africa'],
  ['Guinea-Bissau', 'GW', 'Africa'], ['Kenya', 'KE', 'Africa'], ['Lesotho', 'LS', 'Africa'],
  ['Liberia', 'LR', 'Africa'], ['Libya', 'LY', 'Africa'], ['Madagascar', 'MG', 'Africa'],
  ['Malawi', 'MW', 'Africa'], ['Mali', 'ML', 'Africa'], ['Mauritania', 'MR', 'Africa'],
  ['Mauritius', 'MU', 'Africa'], ['Morocco', 'MA', 'Africa'], ['Mozambique', 'MZ', 'Africa'],
  ['Namibia', 'NA', 'Africa'], ['Niger', 'NE', 'Africa'], ['Nigeria', 'NG', 'Africa'],
  ['Rwanda', 'RW', 'Africa'], ['Sao Tome and Principe', 'ST', 'Africa'], ['Senegal', 'SN', 'Africa'],
  ['Seychelles', 'SC', 'Africa'], ['Sierra Leone', 'SL', 'Africa'], ['Somalia', 'SO', 'Africa'],
  ['South Africa', 'ZA', 'Africa'], ['South Sudan', 'SS', 'Africa'], ['Sudan', 'SD', 'Africa'],
  ['Tanzania', 'TZ', 'Africa'], ['Togo', 'TG', 'Africa'], ['Tunisia', 'TN', 'Africa'],
  ['Uganda', 'UG', 'Africa'], ['Zambia', 'ZM', 'Africa'], ['Zimbabwe', 'ZW', 'Africa'],
  // Asia
  ['Afghanistan', 'AF', 'Asia'], ['Armenia', 'AM', 'Asia'], ['Azerbaijan', 'AZ', 'Asia'],
  ['Bahrain', 'BH', 'Asia'], ['Bangladesh', 'BD', 'Asia'], ['Bhutan', 'BT', 'Asia'],
  ['Brunei', 'BN', 'Asia'], ['Cambodia', 'KH', 'Asia'], ['China', 'CN', 'Asia'],
  ['Georgia', 'GE', 'Asia'], ['India', 'IN', 'Asia'], ['Indonesia', 'ID', 'Asia'],
  ['Iran', 'IR', 'Asia'], ['Iraq', 'IQ', 'Asia'], ['Israel', 'IL', 'Asia'],
  ['Japan', 'JP', 'Asia'], ['Jordan', 'JO', 'Asia'], ['Kazakhstan', 'KZ', 'Asia'],
  ['Kuwait', 'KW', 'Asia'], ['Kyrgyzstan', 'KG', 'Asia'], ['Laos', 'LA', 'Asia'],
  ['Lebanon', 'LB', 'Asia'], ['Malaysia', 'MY', 'Asia'], ['Maldives', 'MV', 'Asia'],
  ['Mongolia', 'MN', 'Asia'], ['Myanmar', 'MM', 'Asia'], ['Nepal', 'NP', 'Asia'],
  ['North Korea', 'KP', 'Asia'], ['Oman', 'OM', 'Asia'], ['Pakistan', 'PK', 'Asia'],
  ['Palestine', 'PS', 'Asia'], ['Philippines', 'PH', 'Asia'], ['Qatar', 'QA', 'Asia'],
  ['Saudi Arabia', 'SA', 'Asia'], ['Singapore', 'SG', 'Asia'], ['South Korea', 'KR', 'Asia'],
  ['Sri Lanka', 'LK', 'Asia'], ['Syria', 'SY', 'Asia'], ['Taiwan', 'TW', 'Asia'],
  ['Tajikistan', 'TJ', 'Asia'], ['Thailand', 'TH', 'Asia'], ['Timor-Leste', 'TL', 'Asia'],
  ['Turkey', 'TR', 'Asia'], ['Turkmenistan', 'TM', 'Asia'], ['United Arab Emirates', 'AE', 'Asia'],
  ['Uzbekistan', 'UZ', 'Asia'], ['Vietnam', 'VN', 'Asia'], ['Yemen', 'YE', 'Asia'],
  // Europe
  ['Albania', 'AL', 'Europe'], ['Andorra', 'AD', 'Europe'], ['Austria', 'AT', 'Europe'],
  ['Belarus', 'BY', 'Europe'], ['Belgium', 'BE', 'Europe'], ['Bosnia and Herzegovina', 'BA', 'Europe'],
  ['Bulgaria', 'BG', 'Europe'], ['Croatia', 'HR', 'Europe'], ['Cyprus', 'CY', 'Europe'],
  ['Czechia', 'CZ', 'Europe'], ['Denmark', 'DK', 'Europe'], ['Estonia', 'EE', 'Europe'],
  ['Finland', 'FI', 'Europe'], ['France', 'FR', 'Europe'], ['Germany', 'DE', 'Europe'],
  ['Greece', 'GR', 'Europe'], ['Hungary', 'HU', 'Europe'], ['Iceland', 'IS', 'Europe'],
  ['Ireland', 'IE', 'Europe'], ['Italy', 'IT', 'Europe'], ['Kosovo', 'XK', 'Europe'],
  ['Latvia', 'LV', 'Europe'], ['Liechtenstein', 'LI', 'Europe'], ['Lithuania', 'LT', 'Europe'],
  ['Luxembourg', 'LU', 'Europe'], ['Malta', 'MT', 'Europe'], ['Moldova', 'MD', 'Europe'],
  ['Monaco', 'MC', 'Europe'], ['Montenegro', 'ME', 'Europe'], ['Netherlands', 'NL', 'Europe'],
  ['North Macedonia', 'MK', 'Europe'], ['Norway', 'NO', 'Europe'], ['Poland', 'PL', 'Europe'],
  ['Portugal', 'PT', 'Europe'], ['Romania', 'RO', 'Europe'], ['Russia', 'RU', 'Europe'],
  ['San Marino', 'SM', 'Europe'], ['Serbia', 'RS', 'Europe'], ['Slovakia', 'SK', 'Europe'],
  ['Slovenia', 'SI', 'Europe'], ['Spain', 'ES', 'Europe'], ['Sweden', 'SE', 'Europe'],
  ['Switzerland', 'CH', 'Europe'], ['Ukraine', 'UA', 'Europe'], ['United Kingdom', 'GB', 'Europe'],
  ['Vatican City', 'VA', 'Europe'],
  // North America
  ['Antigua and Barbuda', 'AG', 'North America'], ['Bahamas', 'BS', 'North America'], ['Barbados', 'BB', 'North America'],
  ['Belize', 'BZ', 'North America'], ['Canada', 'CA', 'North America'], ['Costa Rica', 'CR', 'North America'],
  ['Cuba', 'CU', 'North America'], ['Dominica', 'DM', 'North America'], ['Dominican Republic', 'DO', 'North America'],
  ['El Salvador', 'SV', 'North America'], ['Grenada', 'GD', 'North America'], ['Guatemala', 'GT', 'North America'],
  ['Haiti', 'HT', 'North America'], ['Honduras', 'HN', 'North America'], ['Jamaica', 'JM', 'North America'],
  ['Mexico', 'MX', 'North America'], ['Nicaragua', 'NI', 'North America'], ['Panama', 'PA', 'North America'],
  ['Saint Kitts and Nevis', 'KN', 'North America'], ['Saint Lucia', 'LC', 'North America'],
  ['Saint Vincent and the Grenadines', 'VC', 'North America'], ['Trinidad and Tobago', 'TT', 'North America'],
  ['United States', 'US', 'North America'],
  // South America
  ['Argentina', 'AR', 'South America'], ['Bolivia', 'BO', 'South America'], ['Brazil', 'BR', 'South America'],
  ['Chile', 'CL', 'South America'], ['Colombia', 'CO', 'South America'], ['Ecuador', 'EC', 'South America'],
  ['Guyana', 'GY', 'South America'], ['Paraguay', 'PY', 'South America'], ['Peru', 'PE', 'South America'],
  ['Suriname', 'SR', 'South America'], ['Uruguay', 'UY', 'South America'], ['Venezuela', 'VE', 'South America'],
  // Oceania
  ['Australia', 'AU', 'Oceania'], ['Fiji', 'FJ', 'Oceania'], ['Kiribati', 'KI', 'Oceania'],
  ['Marshall Islands', 'MH', 'Oceania'], ['Micronesia', 'FM', 'Oceania'], ['Nauru', 'NR', 'Oceania'],
  ['New Zealand', 'NZ', 'Oceania'], ['Palau', 'PW', 'Oceania'], ['Papua New Guinea', 'PG', 'Oceania'],
  ['Samoa', 'WS', 'Oceania'], ['Solomon Islands', 'SB', 'Oceania'], ['Tonga', 'TO', 'Oceania'],
  ['Tuvalu', 'TV', 'Oceania'], ['Vanuatu', 'VU', 'Oceania'],
];

export const COUNTRIES = RAW.map(([name, isoCode, continent]) => ({
  name,
  isoCode,
  continent,
  euVatZone: isoCode in EU_VAT,
  vatRate: EU_VAT[isoCode] ?? 0,
}));
