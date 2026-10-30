import i18n from './index'

// Canonical city slug rule - mirrors the backend + cityToSlug(). Display names
// live in the `cityNames` namespace keyed by this slug; cities without a
// localized form fall back to their canonical (English/default) name.
function citySlug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// Localize a city's DISPLAY name for the active locale. The slug/identity never
// changes - this is purely presentational.
export function localizeCityName(name) {
  if (!name) return name
  const slug = citySlug(name)
  const always = SHORT_EVERYWHERE.has(slug) ? SHORT_NAMES[slug] : null
  if (always) return always[String(i18n.language || '').toLowerCase()] ?? always['*']
  return i18n.t(slug, { ns: 'cityNames', defaultValue: name })
}

// Short names for cities known worldwide by one (Saigon, Rio), used where space
// is tight so a flag doesn't push the name into truncation. Never a local
// abbreviation (CDMX, LA, KL...): a short name must read the same everywhere.
// Latin-script locales use the common short form; a non-Latin locale only gets
// one listed for it, else its localized full name.
const SHORT_NAMES = {
  'ho-chi-minh-city':   { '*': 'Saigon', vi: 'Sài Gòn', ja: 'サイゴン', ko: '사이공', 'zh-hans': '西贡', 'zh-hant': '西貢',
                         th: 'ไซง่อน', ru: 'Сайгон', ar: 'سايغون', hi: 'साइगॉन' },
  'saint-petersburg':   { '*': 'St. Petersburg', ru: 'Петербург' },
  'rio-de-janeiro':     { '*': 'Rio' },
  'thiruvananthapuram': { '*': 'Trivandrum' },
  'guatemala-city':     { '*': 'Guatemala' },
  'quebec-city':        { '*': 'Québec' },
  'panama-city':        { '*': 'Panamá' },
  'kuwait-city':        { '*': 'Kuwait' },
}
const NON_LATIN = new Set(['ar', 'hi', 'ja', 'ko', 'ru', 'th', 'zh-hans', 'zh-hant'])
// Cities Hilads always calls by their short name, not only where space is tight: Saigon is
// the city's name in the app, in every locale (docs/i18n-style-guide.md §3), stories and
// passport included. The official name still matches in city search (the server's name).
const SHORT_EVERYWHERE = new Set(['ho-chi-minh-city'])

// Short names the server sent (V5-01: the back office edits them), per locale:
// slug → { [lang]: short name or null }. They win over SHORT_NAMES.
const SERVER_SHORT = {}

/**
 * Keep the names an API answer carries for a city ({city: English name, name:
 * in the app's language, shortName}) so localizeCityName / shortCityName show
 * them - cities created on demand have no entry in the bundled cityNames.
 * Returns the city as given.
 */
export function registerCityNames(city) {
  const slug = citySlug(city?.city)
  if (!slug) return city
  const lang = String(i18n.language || '').toLowerCase()
  if (city.name && city.name !== city.city) i18n.addResource(lang, 'cityNames', slug, city.name)
  if ('shortName' in city) (SERVER_SHORT[slug] ??= {})[lang] = city.shortName || null
  return city
}

/** A city's short display name in the active locale (see SHORT_NAMES), else its localized name. */
export function shortCityName(name) {
  if (!name) return name ?? ''
  const slug = citySlug(name)
  const lang = String(i18n.language || '').toLowerCase()
  const served = SERVER_SHORT[slug]
  if (served && lang in served) return served[lang] || localizeCityName(name)
  const short = SHORT_NAMES[slug]
  if (short?.[lang]) return short[lang]
  if (short && !NON_LATIN.has(lang)) return short['*']
  return localizeCityName(name)
}
