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

export const SUPPORTED      = ['en', 'fr', 'vi']
export const DEFAULT_LOCALE = 'en'
export const COOKIE_NAME    = 'hilads_lang'
const NAMESPACES = ['common', 'profile', 'brand', 'landing', 'auth']

// Lazy loaders — one code-split chunk per (locale, namespace). Vite turns each
// dynamic import() into its own chunk, fetched only when that locale is needed.
const LOADERS = {
  fr: {
    common:  () => import('./locales/fr/common.json'),
    profile: () => import('./locales/fr/profile.json'),
    brand:   () => import('./locales/fr/brand.json'),
    landing: () => import('./locales/fr/landing.json'),
    auth:    () => import('./locales/fr/auth.json'),
  },
  vi: {
    common:  () => import('./locales/vi/common.json'),
    profile: () => import('./locales/vi/profile.json'),
    brand:   () => import('./locales/vi/brand.json'),
    landing: () => import('./locales/vi/landing.json'),
    auth:    () => import('./locales/vi/auth.json'),
  },
}

i18n.use(initReactI18next).init({
  resources: {
    en: { common: en_common, profile: en_profile, brand: en_brand, landing: en_landing, auth: en_auth },
  },
  lng:          DEFAULT_LOCALE,
  fallbackLng:  DEFAULT_LOCALE,   // missing key in fr/vi → English
  ns:           NAMESPACES,
  defaultNS:    'profile',
  supportedLngs: SUPPORTED,
  interpolation: { escapeValue: false }, // React already escapes
  returnEmptyString: false,
  react: { useSuspense: false },          // we preload before render ourselves
})

const loaded = { en: true, fr: false, vi: false }

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

// ── Persistence (cookie — readable server-side by the future edge middleware) ──
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
 *   1. URL prefix  (/fr/…, /vi/…)  — Option A localized routes are authoritative
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
  const short = nav.slice(0, 2).toLowerCase()
  return SUPPORTED.includes(short) ? short : DEFAULT_LOCALE
}

/** Manual switch: lazy-load, persist, then apply. react-i18next re-renders. */
export async function setLocale(locale) {
  if (!SUPPORTED.includes(locale)) locale = DEFAULT_LOCALE
  await loadLocale(locale)
  storeLocale(locale)
  await i18n.changeLanguage(locale)
  if (typeof document !== 'undefined') document.documentElement.lang = locale
}

export default i18n
