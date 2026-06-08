import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// ── English bundled (default + fallback) ──────────────────────────────────────
// Only EN ships in the main bundle, so EN users pay ~nothing and the first paint
// is instant. fr/vi are dynamic-imported on demand (see loaders below) so they
// are NEVER sent to an English client. This is the perf contract.
import en_common  from './locales/en/common.json'
import en_profile from './locales/en/profile.json'
import en_brand   from './locales/en/brand.json'
import en_landing from './locales/en/landing.json'
import en_auth    from './locales/en/auth.json'
import en_event   from './locales/en/event.json'
import en_hangout from './locales/en/hangout.json'
import en_challenge from './locales/en/challenge.json'
import en_dm      from './locales/en/dm.json'
import en_notifications from './locales/en/notifications.json'
import en_upcoming      from './locales/en/upcoming.json'
import en_archive       from './locales/en/archive.json'
import en_publicProfile from './locales/en/publicProfile.json'
import en_city          from './locales/en/city.json'
import en_cityNames          from './locales/en/cityNames.json'
import en_venue         from './locales/en/venue.json'
import en_chat          from './locales/en/chat.json'

export const SUPPORTED      = ['en', 'fr', 'vi', 'es', 'it', 'pt-br', 'pt-pt', 'de', 'nl', 'zh-hans', 'zh-hant', 'ja', 'ko', 'fil', 'th', 'id', 'hi', 'ru', 'ar']
// Right-to-left locales - drive <html dir="rtl">.
export const RTL_LOCALES    = ['ar']
export const DEFAULT_LOCALE = 'en'
export const COOKIE_NAME    = 'hilads_lang'
const NAMESPACES = ['common', 'profile', 'brand', 'landing', 'auth', 'event', 'hangout', 'challenge', 'dm', 'notifications', 'upcoming', 'archive', 'publicProfile', 'city', 'cityNames', 'venue', 'chat']

// Lazy loaders - one code-split chunk per (locale, namespace). Vite turns each
// dynamic import() into its own chunk, fetched only when that locale is needed.
const LOADERS = {
  fr: {
    common:  () => import('./locales/fr/common.json'),
    profile: () => import('./locales/fr/profile.json'),
    brand:   () => import('./locales/fr/brand.json'),
    landing: () => import('./locales/fr/landing.json'),
    auth:    () => import('./locales/fr/auth.json'),
    event:   () => import('./locales/fr/event.json'),
    hangout: () => import('./locales/fr/hangout.json'),

    challenge: () => import('./locales/fr/challenge.json'),
    dm:      () => import('./locales/fr/dm.json'),
    notifications: () => import('./locales/fr/notifications.json'),
    upcoming:      () => import('./locales/fr/upcoming.json'),
    archive:       () => import('./locales/fr/archive.json'),
    publicProfile: () => import('./locales/fr/publicProfile.json'),
    city:          () => import('./locales/fr/city.json'),
    venue:         () => import('./locales/fr/venue.json'),
    chat:          () => import('./locales/fr/chat.json'),
    cityNames:         () => import('./locales/fr/cityNames.json'),
  },
  vi: {
    common:  () => import('./locales/vi/common.json'),
    profile: () => import('./locales/vi/profile.json'),
    brand:   () => import('./locales/vi/brand.json'),
    landing: () => import('./locales/vi/landing.json'),
    auth:    () => import('./locales/vi/auth.json'),
    event:   () => import('./locales/vi/event.json'),
    hangout: () => import('./locales/vi/hangout.json'),

    challenge: () => import('./locales/vi/challenge.json'),
    dm:      () => import('./locales/vi/dm.json'),
    notifications: () => import('./locales/vi/notifications.json'),
    upcoming:      () => import('./locales/vi/upcoming.json'),
    archive:       () => import('./locales/vi/archive.json'),
    publicProfile: () => import('./locales/vi/publicProfile.json'),
    city:          () => import('./locales/vi/city.json'),
    venue:         () => import('./locales/vi/venue.json'),
    chat:          () => import('./locales/vi/chat.json'),
    cityNames:         () => import('./locales/vi/cityNames.json'),
  },
  es: {
    common:  () => import('./locales/es/common.json'),
    profile: () => import('./locales/es/profile.json'),
    brand:   () => import('./locales/es/brand.json'),
    landing: () => import('./locales/es/landing.json'),
    auth:    () => import('./locales/es/auth.json'),
    event:   () => import('./locales/es/event.json'),
    hangout: () => import('./locales/es/hangout.json'),

    challenge: () => import('./locales/es/challenge.json'),
    dm:      () => import('./locales/es/dm.json'),
    notifications: () => import('./locales/es/notifications.json'),
    upcoming:      () => import('./locales/es/upcoming.json'),
    archive:       () => import('./locales/es/archive.json'),
    publicProfile: () => import('./locales/es/publicProfile.json'),
    city:          () => import('./locales/es/city.json'),
    venue:         () => import('./locales/es/venue.json'),
    chat:          () => import('./locales/es/chat.json'),
    cityNames:         () => import('./locales/es/cityNames.json'),
  },
  it: {
    common:  () => import('./locales/it/common.json'),
    profile: () => import('./locales/it/profile.json'),
    brand:   () => import('./locales/it/brand.json'),
    landing: () => import('./locales/it/landing.json'),
    auth:    () => import('./locales/it/auth.json'),
    event:   () => import('./locales/it/event.json'),
    hangout: () => import('./locales/it/hangout.json'),

    challenge: () => import('./locales/it/challenge.json'),
    dm:      () => import('./locales/it/dm.json'),
    notifications: () => import('./locales/it/notifications.json'),
    upcoming:      () => import('./locales/it/upcoming.json'),
    archive:       () => import('./locales/it/archive.json'),
    publicProfile: () => import('./locales/it/publicProfile.json'),
    city:          () => import('./locales/it/city.json'),
    venue:         () => import('./locales/it/venue.json'),
    chat:          () => import('./locales/it/chat.json'),
    cityNames:         () => import('./locales/it/cityNames.json'),
  },
  'pt-br': {
    common:  () => import('./locales/pt-br/common.json'),
    profile: () => import('./locales/pt-br/profile.json'),
    brand:   () => import('./locales/pt-br/brand.json'),
    landing: () => import('./locales/pt-br/landing.json'),
    auth:    () => import('./locales/pt-br/auth.json'),
    event:   () => import('./locales/pt-br/event.json'),
    hangout: () => import('./locales/pt-br/hangout.json'),

    challenge: () => import('./locales/pt-br/challenge.json'),
    dm:      () => import('./locales/pt-br/dm.json'),
    notifications: () => import('./locales/pt-br/notifications.json'),
    upcoming:      () => import('./locales/pt-br/upcoming.json'),
    archive:       () => import('./locales/pt-br/archive.json'),
    publicProfile: () => import('./locales/pt-br/publicProfile.json'),
    city:          () => import('./locales/pt-br/city.json'),
    venue:         () => import('./locales/pt-br/venue.json'),
    chat:          () => import('./locales/pt-br/chat.json'),
    cityNames:         () => import('./locales/pt-br/cityNames.json'),
  },
  'pt-pt': {
    common:  () => import('./locales/pt-pt/common.json'),
    profile: () => import('./locales/pt-pt/profile.json'),
    brand:   () => import('./locales/pt-pt/brand.json'),
    landing: () => import('./locales/pt-pt/landing.json'),
    auth:    () => import('./locales/pt-pt/auth.json'),
    event:   () => import('./locales/pt-pt/event.json'),
    hangout: () => import('./locales/pt-pt/hangout.json'),

    challenge: () => import('./locales/pt-pt/challenge.json'),
    dm:      () => import('./locales/pt-pt/dm.json'),
    notifications: () => import('./locales/pt-pt/notifications.json'),
    upcoming:      () => import('./locales/pt-pt/upcoming.json'),
    archive:       () => import('./locales/pt-pt/archive.json'),
    publicProfile: () => import('./locales/pt-pt/publicProfile.json'),
    city:          () => import('./locales/pt-pt/city.json'),
    venue:         () => import('./locales/pt-pt/venue.json'),
    chat:          () => import('./locales/pt-pt/chat.json'),
    cityNames:         () => import('./locales/pt-pt/cityNames.json'),
  },
  de: {
    common:  () => import('./locales/de/common.json'),
    profile: () => import('./locales/de/profile.json'),
    brand:   () => import('./locales/de/brand.json'),
    landing: () => import('./locales/de/landing.json'),
    auth:    () => import('./locales/de/auth.json'),
    event:   () => import('./locales/de/event.json'),
    hangout: () => import('./locales/de/hangout.json'),

    challenge: () => import('./locales/de/challenge.json'),
    dm:      () => import('./locales/de/dm.json'),
    notifications: () => import('./locales/de/notifications.json'),
    upcoming:      () => import('./locales/de/upcoming.json'),
    archive:       () => import('./locales/de/archive.json'),
    publicProfile: () => import('./locales/de/publicProfile.json'),
    city:          () => import('./locales/de/city.json'),
    venue:         () => import('./locales/de/venue.json'),
    chat:          () => import('./locales/de/chat.json'),
    cityNames:         () => import('./locales/de/cityNames.json'),
  },
  nl: {
    common:  () => import('./locales/nl/common.json'),
    profile: () => import('./locales/nl/profile.json'),
    brand:   () => import('./locales/nl/brand.json'),
    landing: () => import('./locales/nl/landing.json'),
    auth:    () => import('./locales/nl/auth.json'),
    event:   () => import('./locales/nl/event.json'),
    hangout: () => import('./locales/nl/hangout.json'),

    challenge: () => import('./locales/nl/challenge.json'),
    dm:      () => import('./locales/nl/dm.json'),
    notifications: () => import('./locales/nl/notifications.json'),
    upcoming:      () => import('./locales/nl/upcoming.json'),
    archive:       () => import('./locales/nl/archive.json'),
    publicProfile: () => import('./locales/nl/publicProfile.json'),
    city:          () => import('./locales/nl/city.json'),
    venue:         () => import('./locales/nl/venue.json'),
    chat:          () => import('./locales/nl/chat.json'),
    cityNames:         () => import('./locales/nl/cityNames.json'),
  },
  'zh-hans': {
    common:  () => import('./locales/zh-hans/common.json'),
    profile: () => import('./locales/zh-hans/profile.json'),
    brand:   () => import('./locales/zh-hans/brand.json'),
    landing: () => import('./locales/zh-hans/landing.json'),
    auth:    () => import('./locales/zh-hans/auth.json'),
    event:   () => import('./locales/zh-hans/event.json'),
    hangout: () => import('./locales/zh-hans/hangout.json'),

    challenge: () => import('./locales/zh-hans/challenge.json'),
    dm:      () => import('./locales/zh-hans/dm.json'),
    notifications: () => import('./locales/zh-hans/notifications.json'),
    upcoming:      () => import('./locales/zh-hans/upcoming.json'),
    archive:       () => import('./locales/zh-hans/archive.json'),
    publicProfile: () => import('./locales/zh-hans/publicProfile.json'),
    city:          () => import('./locales/zh-hans/city.json'),
    venue:         () => import('./locales/zh-hans/venue.json'),
    chat:          () => import('./locales/zh-hans/chat.json'),
    cityNames:         () => import('./locales/zh-hans/cityNames.json'),
  },
  'zh-hant': {
    common:  () => import('./locales/zh-hant/common.json'),
    profile: () => import('./locales/zh-hant/profile.json'),
    brand:   () => import('./locales/zh-hant/brand.json'),
    landing: () => import('./locales/zh-hant/landing.json'),
    auth:    () => import('./locales/zh-hant/auth.json'),
    event:   () => import('./locales/zh-hant/event.json'),
    hangout: () => import('./locales/zh-hant/hangout.json'),

    challenge: () => import('./locales/zh-hant/challenge.json'),
    dm:      () => import('./locales/zh-hant/dm.json'),
    notifications: () => import('./locales/zh-hant/notifications.json'),
    upcoming:      () => import('./locales/zh-hant/upcoming.json'),
    archive:       () => import('./locales/zh-hant/archive.json'),
    publicProfile: () => import('./locales/zh-hant/publicProfile.json'),
    city:          () => import('./locales/zh-hant/city.json'),
    venue:         () => import('./locales/zh-hant/venue.json'),
    chat:          () => import('./locales/zh-hant/chat.json'),
    cityNames:         () => import('./locales/zh-hant/cityNames.json'),
  },
  ja: {
    common:  () => import('./locales/ja/common.json'),
    profile: () => import('./locales/ja/profile.json'),
    brand:   () => import('./locales/ja/brand.json'),
    landing: () => import('./locales/ja/landing.json'),
    auth:    () => import('./locales/ja/auth.json'),
    event:   () => import('./locales/ja/event.json'),
    hangout: () => import('./locales/ja/hangout.json'),

    challenge: () => import('./locales/ja/challenge.json'),
    dm:      () => import('./locales/ja/dm.json'),
    notifications: () => import('./locales/ja/notifications.json'),
    upcoming:      () => import('./locales/ja/upcoming.json'),
    archive:       () => import('./locales/ja/archive.json'),
    publicProfile: () => import('./locales/ja/publicProfile.json'),
    city:          () => import('./locales/ja/city.json'),
    venue:         () => import('./locales/ja/venue.json'),
    chat:          () => import('./locales/ja/chat.json'),
    cityNames:         () => import('./locales/ja/cityNames.json'),
  },
  ko: {
    common:  () => import('./locales/ko/common.json'),
    profile: () => import('./locales/ko/profile.json'),
    brand:   () => import('./locales/ko/brand.json'),
    landing: () => import('./locales/ko/landing.json'),
    auth:    () => import('./locales/ko/auth.json'),
    event:   () => import('./locales/ko/event.json'),
    hangout: () => import('./locales/ko/hangout.json'),

    challenge: () => import('./locales/ko/challenge.json'),
    dm:      () => import('./locales/ko/dm.json'),
    notifications: () => import('./locales/ko/notifications.json'),
    upcoming:      () => import('./locales/ko/upcoming.json'),
    archive:       () => import('./locales/ko/archive.json'),
    publicProfile: () => import('./locales/ko/publicProfile.json'),
    city:          () => import('./locales/ko/city.json'),
    venue:         () => import('./locales/ko/venue.json'),
    chat:          () => import('./locales/ko/chat.json'),
    cityNames:         () => import('./locales/ko/cityNames.json'),
  },
  fil: {
    common:  () => import('./locales/fil/common.json'),
    profile: () => import('./locales/fil/profile.json'),
    brand:   () => import('./locales/fil/brand.json'),
    landing: () => import('./locales/fil/landing.json'),
    auth:    () => import('./locales/fil/auth.json'),
    event:   () => import('./locales/fil/event.json'),
    hangout: () => import('./locales/fil/hangout.json'),

    challenge: () => import('./locales/fil/challenge.json'),
    dm:      () => import('./locales/fil/dm.json'),
    notifications: () => import('./locales/fil/notifications.json'),
    upcoming:      () => import('./locales/fil/upcoming.json'),
    archive:       () => import('./locales/fil/archive.json'),
    publicProfile: () => import('./locales/fil/publicProfile.json'),
    city:          () => import('./locales/fil/city.json'),
    venue:         () => import('./locales/fil/venue.json'),
    chat:          () => import('./locales/fil/chat.json'),
    cityNames:         () => import('./locales/fil/cityNames.json'),
  },
  th: {
    common:  () => import('./locales/th/common.json'),
    profile: () => import('./locales/th/profile.json'),
    brand:   () => import('./locales/th/brand.json'),
    landing: () => import('./locales/th/landing.json'),
    auth:    () => import('./locales/th/auth.json'),
    event:   () => import('./locales/th/event.json'),
    hangout: () => import('./locales/th/hangout.json'),

    challenge: () => import('./locales/th/challenge.json'),
    dm:      () => import('./locales/th/dm.json'),
    notifications: () => import('./locales/th/notifications.json'),
    upcoming:      () => import('./locales/th/upcoming.json'),
    archive:       () => import('./locales/th/archive.json'),
    publicProfile: () => import('./locales/th/publicProfile.json'),
    city:          () => import('./locales/th/city.json'),
    venue:         () => import('./locales/th/venue.json'),
    chat:          () => import('./locales/th/chat.json'),
    cityNames:         () => import('./locales/th/cityNames.json'),
  },
  id: {
    common:  () => import('./locales/id/common.json'),
    profile: () => import('./locales/id/profile.json'),
    brand:   () => import('./locales/id/brand.json'),
    landing: () => import('./locales/id/landing.json'),
    auth:    () => import('./locales/id/auth.json'),
    event:   () => import('./locales/id/event.json'),
    hangout: () => import('./locales/id/hangout.json'),

    challenge: () => import('./locales/id/challenge.json'),
    dm:      () => import('./locales/id/dm.json'),
    notifications: () => import('./locales/id/notifications.json'),
    upcoming:      () => import('./locales/id/upcoming.json'),
    archive:       () => import('./locales/id/archive.json'),
    publicProfile: () => import('./locales/id/publicProfile.json'),
    city:          () => import('./locales/id/city.json'),
    venue:         () => import('./locales/id/venue.json'),
    chat:          () => import('./locales/id/chat.json'),
    cityNames:         () => import('./locales/id/cityNames.json'),
  },
  hi: {
    common:  () => import('./locales/hi/common.json'),
    profile: () => import('./locales/hi/profile.json'),
    brand:   () => import('./locales/hi/brand.json'),
    landing: () => import('./locales/hi/landing.json'),
    auth:    () => import('./locales/hi/auth.json'),
    event:   () => import('./locales/hi/event.json'),
    hangout: () => import('./locales/hi/hangout.json'),

    challenge: () => import('./locales/hi/challenge.json'),
    dm:      () => import('./locales/hi/dm.json'),
    notifications: () => import('./locales/hi/notifications.json'),
    upcoming:      () => import('./locales/hi/upcoming.json'),
    archive:       () => import('./locales/hi/archive.json'),
    publicProfile: () => import('./locales/hi/publicProfile.json'),
    city:          () => import('./locales/hi/city.json'),
    venue:         () => import('./locales/hi/venue.json'),
    chat:          () => import('./locales/hi/chat.json'),
    cityNames:         () => import('./locales/hi/cityNames.json'),
  },
  ru: {
    common:  () => import('./locales/ru/common.json'),
    profile: () => import('./locales/ru/profile.json'),
    brand:   () => import('./locales/ru/brand.json'),
    landing: () => import('./locales/ru/landing.json'),
    auth:    () => import('./locales/ru/auth.json'),
    event:   () => import('./locales/ru/event.json'),
    hangout: () => import('./locales/ru/hangout.json'),

    challenge: () => import('./locales/ru/challenge.json'),
    dm:      () => import('./locales/ru/dm.json'),
    notifications: () => import('./locales/ru/notifications.json'),
    upcoming:      () => import('./locales/ru/upcoming.json'),
    archive:       () => import('./locales/ru/archive.json'),
    publicProfile: () => import('./locales/ru/publicProfile.json'),
    city:          () => import('./locales/ru/city.json'),
    venue:         () => import('./locales/ru/venue.json'),
    chat:          () => import('./locales/ru/chat.json'),
    cityNames:         () => import('./locales/ru/cityNames.json'),
  },
  ar: {
    common:  () => import('./locales/ar/common.json'),
    profile: () => import('./locales/ar/profile.json'),
    brand:   () => import('./locales/ar/brand.json'),
    landing: () => import('./locales/ar/landing.json'),
    auth:    () => import('./locales/ar/auth.json'),
    event:   () => import('./locales/ar/event.json'),
    hangout: () => import('./locales/ar/hangout.json'),

    challenge: () => import('./locales/ar/challenge.json'),
    dm:      () => import('./locales/ar/dm.json'),
    notifications: () => import('./locales/ar/notifications.json'),
    upcoming:      () => import('./locales/ar/upcoming.json'),
    archive:       () => import('./locales/ar/archive.json'),
    publicProfile: () => import('./locales/ar/publicProfile.json'),
    city:          () => import('./locales/ar/city.json'),
    venue:         () => import('./locales/ar/venue.json'),
    chat:          () => import('./locales/ar/chat.json'),
    cityNames:         () => import('./locales/ar/cityNames.json'),
  },
}

i18n.use(initReactI18next).init({
  resources: {
    en: { common: en_common, profile: en_profile, brand: en_brand, landing: en_landing, auth: en_auth, event: en_event, hangout: en_hangout, challenge: en_challenge, dm: en_dm, notifications: en_notifications, upcoming: en_upcoming, archive: en_archive, publicProfile: en_publicProfile, city: en_city, venue: en_venue, cityNames: en_cityNames, chat: en_chat },
  },
  lng:          DEFAULT_LOCALE,
  fallbackLng:  DEFAULT_LOCALE,   // missing key in fr/vi → English
  ns:           NAMESPACES,
  defaultNS:    'profile',
  supportedLngs: SUPPORTED,
  // Our bundle keys + URL prefixes are all lowercase (pt-br, zh-hans). i18next
  // otherwise normalizes hyphenated codes to pt-BR / zh-Hans for lookups, which
  // misses the lowercase bundles and falls back to English. Force lowercase so
  // the active language always matches our keys.
  lowerCaseLng: true,
  interpolation: { escapeValue: false }, // React already escapes
  returnEmptyString: false,
  react: { useSuspense: false },          // we preload before render ourselves
})

const loaded = { en: true, fr: false, vi: false, es: false, it: false, 'pt-br': false, 'pt-pt': false, de: false, nl: false, 'zh-hans': false, 'zh-hant': false, ja: false, ko: false, fil: false, th: false, id: false, hi: false, ru: false, ar: false }

/** Lazy-load + register every namespace for a locale. Idempotent. */
export async function loadLocale(locale) {
  if (!SUPPORTED.includes(locale) || loaded[locale]) return
  const l = LOADERS[locale]
  const mods = await Promise.all(NAMESPACES.map((ns) => l[ns]()))
  NAMESPACES.forEach((ns, i) => {
    i18n.addResourceBundle(locale, ns, mods[i].default ?? mods[i], true, true)
  })
  loaded[locale] = true
}

// ── Persistence (cookie - readable server-side by the future edge middleware) ──
export function getStoredLocale() {
  const m = typeof document !== 'undefined'
    ? document.cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([^;]+)'))
    : null
  const v = m ? decodeURIComponent(m[1]) : null
  return v && SUPPORTED.includes(v) ? v : null
}

function storeLocale(locale) {
  if (typeof document === 'undefined') return
  // 1-year cookie, path=/ so it applies to every route; lax so normal nav sends it.
  document.cookie = `${COOKIE_NAME}=${locale};path=/;max-age=31536000;samesite=lax`
}

/**
 * Resolve the locale for the initial render. Priority:
 *   1. URL prefix  (/fr/…, /vi/…)  - Option A localized routes are authoritative
 *   2. cookie override (manual choice)
 *   3. browser language
 *   4. English
 */
export function resolveInitialLocale() {
  if (typeof window !== 'undefined') {
    const seg = window.location.pathname.split('/')[1]
    if (SUPPORTED.includes(seg)) return seg
  }
  const cookie = getStoredLocale()
  if (cookie) return cookie
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en') || 'en'
  const lower = nav.toLowerCase()
  // Portuguese is regional: only "pt-BR" → pt-br; bare "pt", "pt-PT" and any
  // other pt-XX fall back to European (pt-pt), per product decision.
  if (lower === 'pt-br') return 'pt-br'
  if (lower.slice(0, 2) === 'pt') return 'pt-pt'
  // Chinese is script-based: Traditional regions/scripts (TW/HK/MO/Hant) →
  // zh-hant; everything else zh-* (CN/SG/Hans/bare zh) → Simplified default.
  if (lower.slice(0, 2) === 'zh') {
    return /hant|tw|hk|mo/.test(lower) ? 'zh-hant' : 'zh-hans'
  }
  // Filipino is a 3-letter code; also accept Tagalog (tl). slice(0,2) would give
  // "fi" (Finnish), so match the full prefix instead.
  if (lower.slice(0, 3) === 'fil' || lower.slice(0, 2) === 'tl') return 'fil'
  const short = lower.slice(0, 2)
  return SUPPORTED.includes(short) ? short : DEFAULT_LOCALE
}

/** Manual switch: lazy-load, persist, then apply. react-i18next re-renders. */
export async function setLocale(locale) {
  if (!SUPPORTED.includes(locale)) locale = DEFAULT_LOCALE
  await loadLocale(locale)
  storeLocale(locale)
  await i18n.changeLanguage(locale)
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
    document.documentElement.dir = RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr'
  }
}

export default i18n
