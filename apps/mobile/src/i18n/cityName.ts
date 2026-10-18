import i18n from './index';

// Canonical city slug rule - mirrors the backend slug + web cityToSlug(). City
// display names live in the `cityNames` namespace keyed by this slug; cities
// without a localized form fall back to their canonical (English/default) name.
function citySlug(name: string): string {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Localize a city's DISPLAY name for the active locale. The slug/identity never
// changes - purely presentational.
export function localizeCityName(name: string | null | undefined): string {
  if (!name) return name ?? '';
  return i18n.t(citySlug(name), { ns: 'cityNames', defaultValue: name });
}

// Short names for cities known by one (Saigon, Rio, CDMX), used where space is
// tight so a flag doesn't push the name into truncation. Latin-script locales
// use the common short form; a non-Latin locale only gets one listed for it,
// else its localized full name.
const SHORT_NAMES: Record<string, Record<string, string>> = {
  'ho-chi-minh-city':   { '*': 'Saigon', vi: 'Sài Gòn' },
  'saint-petersburg':   { '*': 'St. Petersburg', ru: 'Петербург' },
  'rio-de-janeiro':     { '*': 'Rio' },
  'mexico-city':        { '*': 'CDMX' },
  'los-angeles':        { '*': 'LA' },
  'san-francisco':      { '*': 'SF' },
  'kuala-lumpur':       { '*': 'KL' },
  'new-orleans':        { '*': 'NOLA' },
  'philadelphia':       { '*': 'Philly' },
  'indianapolis':       { '*': 'Indy' },
  'oklahoma-city':      { '*': 'OKC' },
  'salt-lake-city':     { '*': 'Salt Lake' },
  'johannesburg':       { '*': 'Joburg' },
  'thiruvananthapuram': { '*': 'Trivandrum' },
  'guatemala-city':     { '*': 'Guatemala' },
  'quebec-city':        { '*': 'Québec' },
  'panama-city':        { '*': 'Panamá' },
  'kuwait-city':        { '*': 'Kuwait' },
  'dar-es-salaam':      { '*': 'Dar' },
  'addis-ababa':        { '*': 'Addis' },
  'ouagadougou':        { '*': 'Ouaga' },
};
const NON_LATIN = new Set(['ar', 'hi', 'ja', 'ko', 'ru', 'th', 'zh-hans', 'zh-hant']);

/** A city's short display name in the active locale (see SHORT_NAMES), else its localized name. */
export function shortCityName(name: string | null | undefined): string {
  if (!name) return name ?? '';
  const short = SHORT_NAMES[citySlug(name)];
  const lang = String(i18n.language || '').toLowerCase();
  if (short?.[lang]) return short[lang];
  if (short && !NON_LATIN.has(lang)) return short['*'];
  return localizeCityName(name);
}
