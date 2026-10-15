import * as Localization from 'expo-localization';

// Default currency for the "price paid" field: the city's country first (that
// is what people pay in), then the device's currency, then USD. Any 3-letter
// code can be typed instead.
const COUNTRY_CURRENCY: Record<string, string> = {
  VN: 'VND', TH: 'THB', KH: 'KHR', LA: 'LAK', MY: 'MYR', SG: 'SGD', ID: 'IDR', PH: 'PHP',
  JP: 'JPY', KR: 'KRW', CN: 'CNY', TW: 'TWD', HK: 'HKD', IN: 'INR', AU: 'AUD', NZ: 'NZD',
  US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL', AR: 'ARS', CO: 'COP', PE: 'PEN', CL: 'CLP',
  GB: 'GBP', CH: 'CHF', NO: 'NOK', SE: 'SEK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF',
  TR: 'TRY', RU: 'RUB', AE: 'AED', MA: 'MAD', ZA: 'ZAR', EG: 'EGP', IL: 'ILS',
  FR: 'EUR', DE: 'EUR', ES: 'EUR', IT: 'EUR', PT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR',
  IE: 'EUR', GR: 'EUR', FI: 'EUR', HR: 'EUR', SK: 'EUR', SI: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR',
};

export function defaultCurrency(countryCode?: string | null): string {
  const byCity = countryCode ? COUNTRY_CURRENCY[countryCode.toUpperCase()] : undefined;
  if (byCity) return byCity;
  try {
    const device = Localization.getLocales()[0]?.currencyCode;
    if (device && /^[A-Z]{3}$/.test(device)) return device;
  } catch { /* fall through */ }
  return 'USD';
}

/** 45000 → "45,000" in the user's locale; keeps decimals only when present. */
export function formatAmount(amount: number, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount);
  } catch {
    return String(amount);
  }
}
