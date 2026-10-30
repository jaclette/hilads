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
  const slug = citySlug(name);
  const always = SHORT_EVERYWHERE.has(slug) ? SHORT_NAMES[slug] : null;
  if (always) return always[String(i18n.language || '').toLowerCase()] ?? always['*'];
  return i18n.t(slug, { ns: 'cityNames', defaultValue: name });
}

// Short names for cities known worldwide by one (Saigon, Rio), used where space
// is tight so a flag doesn't push the name into truncation. Never a local
// abbreviation (CDMX, LA, KL...): a short name must read the same everywhere.
// Latin-script locales use the common short form; a non-Latin locale only gets
// one listed for it, else its localized full name.
const SHORT_NAMES: Record<string, Record<string, string>> = {
  'ho-chi-minh-city':   { '*': 'Saigon', vi: 'Sài Gòn', ja: 'サイゴン', ko: '사이공', 'zh-hans': '西贡', 'zh-hant': '西貢',
                         th: 'ไซง่อน', ru: 'Сайгон', ar: 'سايغون', hi: 'साइगॉन' },
  'saint-petersburg':   { '*': 'St. Petersburg', ru: 'Петербург' },
  'rio-de-janeiro':     { '*': 'Rio' },
  'thiruvananthapuram': { '*': 'Trivandrum' },
  'guatemala-city':     { '*': 'Guatemala' },
  'quebec-city':        { '*': 'Québec' },
  'panama-city':        { '*': 'Panamá' },
  'kuwait-city':        { '*': 'Kuwait' },
};
const NON_LATIN = new Set(['ar', 'hi', 'ja', 'ko', 'ru', 'th', 'zh-hans', 'zh-hant']);
// Cities Hilads always calls by their short name, not only where space is tight: Saigon is
// the city's name in the app, in every locale (docs/i18n-style-guide.md §3), stories and
// passport included. The official name still matches in city search (the server's name).
const SHORT_EVERYWHERE = new Set(['ho-chi-minh-city']);

// Short names the server sent (cities.short_name, back office), per locale.
const SERVER_SHORT: Record<string, Record<string, string>> = {};

/**
 * Remember the names the server gave a city in a locale (V5-01: every city on
 * the GeoNames base comes with its name in the app's language and its short
 * name), so localizeCityName / shortCityName show them wherever the city's
 * English name is used - cities created on demand have no cityNames entry.
 */
export function rememberCityNames(english: string | null | undefined, locale: string,
                                  localized?: string | null, short?: string | null): void {
  if (!english) return;
  const slug = citySlug(english);
  const lang = String(locale || '').toLowerCase();
  if (localized && localized !== english && !i18n.exists(slug, { ns: 'cityNames', lng: lang })) {
    i18n.addResource(lang, 'cityNames', slug, localized);
  }
  if (short) (SERVER_SHORT[slug] ??= {})[lang] = short;
}

/** A city's short display name in the active locale (see SHORT_NAMES), else its localized name. */
export function shortCityName(name: string | null | undefined): string {
  if (!name) return name ?? '';
  const short = SHORT_NAMES[citySlug(name)];
  const lang = String(i18n.language || '').toLowerCase();
  if (short?.[lang]) return short[lang];
  if (short && !NON_LATIN.has(lang)) return short['*'];
  const fromServer = SERVER_SHORT[citySlug(name)]?.[lang];
  if (fromServer) return fromServer;
  return localizeCityName(name);
}
