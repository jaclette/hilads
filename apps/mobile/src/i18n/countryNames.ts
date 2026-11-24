/**
 * English country names for the codes the app has flags for (src/ui/flags.ts). Hermes ships
 * without Intl.DisplayNames, so a country list would otherwise show bare codes (AE, AF…).
 * Used as the fallback when the engine can't name a country in the app's language.
 */
export const COUNTRY_NAMES: Record<string, string> = {
  AE: 'United Arab Emirates', AF: 'Afghanistan', AL: 'Albania', AM: 'Armenia', AO: 'Angola', AR: 'Argentina', AT: 'Austria',
  AU: 'Australia', AZ: 'Azerbaijan', BA: 'Bosnia and Herzegovina', BD: 'Bangladesh', BE: 'Belgium', BF: 'Burkina Faso',
  BG: 'Bulgaria', BO: 'Bolivia', BR: 'Brazil', BY: 'Belarus', CA: 'Canada', CD: 'DR Congo', CG: 'Congo', CH: 'Switzerland',
  CI: "Côte d'Ivoire", CL: 'Chile', CM: 'Cameroon', CN: 'China', CO: 'Colombia', CR: 'Costa Rica', CU: 'Cuba', CY: 'Cyprus',
  CZ: 'Czechia', DE: 'Germany', DJ: 'Djibouti', DK: 'Denmark', DO: 'Dominican Republic', DZ: 'Algeria', EC: 'Ecuador',
  EE: 'Estonia', EG: 'Egypt', ER: 'Eritrea', ES: 'Spain', ET: 'Ethiopia', FI: 'Finland', FR: 'France', GA: 'Gabon',
  GB: 'United Kingdom', GE: 'Georgia', GH: 'Ghana', GN: 'Guinea', GR: 'Greece', GT: 'Guatemala', HK: 'Hong Kong',
  HR: 'Croatia', HU: 'Hungary', ID: 'Indonesia', IE: 'Ireland', IL: 'Israel', IN: 'India', IQ: 'Iraq', IR: 'Iran',
  IS: 'Iceland', IT: 'Italy', JO: 'Jordan', JP: 'Japan', KE: 'Kenya', KG: 'Kyrgyzstan', KH: 'Cambodia', KR: 'South Korea',
  KW: 'Kuwait', KZ: 'Kazakhstan', LA: 'Laos', LB: 'Lebanon', LK: 'Sri Lanka', LT: 'Lithuania', LU: 'Luxembourg',
  LV: 'Latvia', LY: 'Libya', MA: 'Morocco', MD: 'Moldova', ME: 'Montenegro', MG: 'Madagascar', MK: 'North Macedonia',
  ML: 'Mali', MM: 'Myanmar', MN: 'Mongolia', MO: 'Macao', MT: 'Malta', MW: 'Malawi', MX: 'Mexico', MY: 'Malaysia',
  MZ: 'Mozambique', NG: 'Nigeria', NL: 'Netherlands', NO: 'Norway', NP: 'Nepal', NZ: 'New Zealand', OM: 'Oman',
  PA: 'Panama', PE: 'Peru', PH: 'Philippines', PK: 'Pakistan', PL: 'Poland', PR: 'Puerto Rico', PT: 'Portugal',
  PY: 'Paraguay', QA: 'Qatar', RO: 'Romania', RS: 'Serbia', RU: 'Russia', RW: 'Rwanda', SA: 'Saudi Arabia', SD: 'Sudan',
  SE: 'Sweden', SG: 'Singapore', SI: 'Slovenia', SK: 'Slovakia', SN: 'Senegal', SO: 'Somalia', SY: 'Syria', TH: 'Thailand',
  TN: 'Tunisia', TR: 'Türkiye', TW: 'Taiwan', TZ: 'Tanzania', UA: 'Ukraine', UG: 'Uganda', US: 'United States',
  UY: 'Uruguay', UZ: 'Uzbekistan', VE: 'Venezuela', VN: 'Vietnam', ZA: 'South Africa', ZM: 'Zambia', ZW: 'Zimbabwe',
};
