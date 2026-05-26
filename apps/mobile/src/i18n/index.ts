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
import en_chat    from './locales/en/chat.json';
import en_event   from './locales/en/event.json';
import en_hangout from './locales/en/hangout.json';
import en_dm      from './locales/en/dm.json';
import en_notifications from './locales/en/notifications.json';
import en_publicProfile from './locales/en/publicProfile.json';
import en_me      from './locales/en/me.json';
import en_misc    from './locales/en/misc.json';
import en_cities  from './locales/en/cities.json';
import en_upcoming from './locales/en/upcoming.json';
import en_archive from './locales/en/archive.json';
import fr_common  from './locales/fr/common.json';
import fr_auth    from './locales/fr/auth.json';
import fr_landing from './locales/fr/landing.json';
import fr_here    from './locales/fr/here.json';
import fr_now     from './locales/fr/now.json';
import fr_chat    from './locales/fr/chat.json';
import fr_event   from './locales/fr/event.json';
import fr_hangout from './locales/fr/hangout.json';
import fr_dm      from './locales/fr/dm.json';
import fr_notifications from './locales/fr/notifications.json';
import fr_publicProfile from './locales/fr/publicProfile.json';
import fr_me      from './locales/fr/me.json';
import fr_misc    from './locales/fr/misc.json';
import fr_cities  from './locales/fr/cities.json';
import fr_upcoming from './locales/fr/upcoming.json';
import fr_archive from './locales/fr/archive.json';
import vi_common  from './locales/vi/common.json';
import vi_auth    from './locales/vi/auth.json';
import vi_landing from './locales/vi/landing.json';
import vi_here    from './locales/vi/here.json';
import vi_now     from './locales/vi/now.json';
import vi_chat    from './locales/vi/chat.json';
import vi_event   from './locales/vi/event.json';
import vi_hangout from './locales/vi/hangout.json';
import vi_dm      from './locales/vi/dm.json';
import vi_notifications from './locales/vi/notifications.json';
import vi_publicProfile from './locales/vi/publicProfile.json';
import vi_me      from './locales/vi/me.json';
import vi_misc    from './locales/vi/misc.json';
import vi_cities  from './locales/vi/cities.json';
import vi_upcoming from './locales/vi/upcoming.json';
import vi_archive from './locales/vi/archive.json';
import es_common  from './locales/es/common.json';
import es_auth    from './locales/es/auth.json';
import es_landing from './locales/es/landing.json';
import es_here    from './locales/es/here.json';
import es_now     from './locales/es/now.json';
import es_chat    from './locales/es/chat.json';
import es_event   from './locales/es/event.json';
import es_hangout from './locales/es/hangout.json';
import es_dm      from './locales/es/dm.json';
import es_notifications from './locales/es/notifications.json';
import es_publicProfile from './locales/es/publicProfile.json';
import es_me      from './locales/es/me.json';
import es_misc    from './locales/es/misc.json';
import es_cities  from './locales/es/cities.json';
import es_upcoming from './locales/es/upcoming.json';
import es_archive from './locales/es/archive.json';

export const SUPPORTED = ['en', 'fr', 'vi', 'es'] as const;
export type Locale = (typeof SUPPORTED)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const STORAGE_KEY = 'hilads_lang'; // mirrors the web cookie name

const NS = ['common', 'auth', 'landing', 'here', 'now', 'chat', 'event', 'hangout', 'dm', 'notifications', 'publicProfile', 'me', 'misc', 'cities', 'upcoming', 'archive'] as const;

const resources = {
  en: { common: en_common, auth: en_auth, landing: en_landing, here: en_here, now: en_now, chat: en_chat, event: en_event, hangout: en_hangout, dm: en_dm, notifications: en_notifications, publicProfile: en_publicProfile, me: en_me, misc: en_misc, cities: en_cities, upcoming: en_upcoming, archive: en_archive },
  fr: { common: fr_common, auth: fr_auth, landing: fr_landing, here: fr_here, now: fr_now, chat: fr_chat, event: fr_event, hangout: fr_hangout, dm: fr_dm, notifications: fr_notifications, publicProfile: fr_publicProfile, me: fr_me, misc: fr_misc, cities: fr_cities, upcoming: fr_upcoming, archive: fr_archive },
  vi: { common: vi_common, auth: vi_auth, landing: vi_landing, here: vi_here, now: vi_now, chat: vi_chat, event: vi_event, hangout: vi_hangout, dm: vi_dm, notifications: vi_notifications, publicProfile: vi_publicProfile, me: vi_me, misc: vi_misc, cities: vi_cities, upcoming: vi_upcoming, archive: vi_archive },
  es: { common: es_common, auth: es_auth, landing: es_landing, here: es_here, now: es_now, chat: es_chat, event: es_event, hangout: es_hangout, dm: es_dm, notifications: es_notifications, publicProfile: es_publicProfile, me: es_me, misc: es_misc, cities: es_cities, upcoming: es_upcoming, archive: es_archive },
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
