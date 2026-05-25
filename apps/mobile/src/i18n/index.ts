import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

// EN/FR/VI are all bundled statically. On React Native there is no per-visit
// network download (Metro bundles everything into the JS bundle regardless),
// and the locale JSON is tiny — so the web app's lazy-chunk perf contract does
// not apply here. Bundling all three is simpler and idiomatic for RN.
import en_common  from './locales/en/common.json';
import en_auth    from './locales/en/auth.json';
import en_landing from './locales/en/landing.json';
import en_here    from './locales/en/here.json';
import en_now     from './locales/en/now.json';
import fr_common  from './locales/fr/common.json';
import fr_auth    from './locales/fr/auth.json';
import fr_landing from './locales/fr/landing.json';
import fr_here    from './locales/fr/here.json';
import fr_now     from './locales/fr/now.json';
import vi_common  from './locales/vi/common.json';
import vi_auth    from './locales/vi/auth.json';
import vi_landing from './locales/vi/landing.json';
import vi_here    from './locales/vi/here.json';
import vi_now     from './locales/vi/now.json';

export const SUPPORTED = ['en', 'fr', 'vi'] as const;
export type Locale = (typeof SUPPORTED)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const STORAGE_KEY = 'hilads_lang'; // mirrors the web cookie name

const NS = ['common', 'auth', 'landing', 'here', 'now'] as const;

const resources = {
  en: { common: en_common, auth: en_auth, landing: en_landing, here: en_here, now: en_now },
  fr: { common: fr_common, auth: fr_auth, landing: fr_landing, here: fr_here, now: fr_now },
  vi: { common: vi_common, auth: vi_auth, landing: vi_landing, here: vi_here, now: vi_now },
};

function isSupported(code: string | null | undefined): code is Locale {
  return !!code && (SUPPORTED as readonly string[]).includes(code);
}

// Device language (synchronous) — used as the initial default before any saved
// override is read from AsyncStorage. Falls back to English.
function deviceLocale(): Locale {
  try {
    const code = Localization.getLocales()[0]?.languageCode?.toLowerCase();
    return isSupported(code) ? code : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

i18n.use(initReactI18next).init({
  resources,
  lng:           deviceLocale(),
  fallbackLng:   DEFAULT_LOCALE, // missing key in fr/vi → English
  ns:            NS as unknown as string[],
  defaultNS:     'common',
  supportedLngs: SUPPORTED as unknown as string[],
  interpolation: { escapeValue: false },
  returnEmptyString: false,
  react: { useSuspense: false }, // resources are bundled — no async load to suspend on
});

/**
 * Apply a manually-saved locale (overrides the device default). Call once during
 * boot, before the navigation Stack mounts, so the first translated screen
 * renders in the right language. The BootScreen covers this read — no flash.
 */
export async function applyStoredLocale(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (isSupported(saved) && saved !== i18n.language) {
      await i18n.changeLanguage(saved);
    }
  } catch {
    // AsyncStorage unavailable — keep the device-locale default.
  }
}

/** Manual switch from the language picker: persist + apply. */
export async function setLocale(locale: Locale): Promise<void> {
  const next = isSupported(locale) ? locale : DEFAULT_LOCALE;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Non-fatal — the change still applies for this session.
  }
  await i18n.changeLanguage(next);
}

export default i18n;
