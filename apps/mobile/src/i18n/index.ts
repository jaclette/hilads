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
import it_common  from './locales/it/common.json';
import it_auth    from './locales/it/auth.json';
import it_landing from './locales/it/landing.json';
import it_here    from './locales/it/here.json';
import it_now     from './locales/it/now.json';
import it_chat    from './locales/it/chat.json';
import it_event   from './locales/it/event.json';
import it_hangout from './locales/it/hangout.json';
import it_dm      from './locales/it/dm.json';
import it_notifications from './locales/it/notifications.json';
import it_publicProfile from './locales/it/publicProfile.json';
import it_me      from './locales/it/me.json';
import it_misc    from './locales/it/misc.json';
import it_cities  from './locales/it/cities.json';
import it_upcoming from './locales/it/upcoming.json';
import it_archive from './locales/it/archive.json';
import ptbr_common  from './locales/pt-br/common.json';
import ptbr_auth    from './locales/pt-br/auth.json';
import ptbr_landing from './locales/pt-br/landing.json';
import ptbr_here    from './locales/pt-br/here.json';
import ptbr_now     from './locales/pt-br/now.json';
import ptbr_chat    from './locales/pt-br/chat.json';
import ptbr_event   from './locales/pt-br/event.json';
import ptbr_hangout from './locales/pt-br/hangout.json';
import ptbr_dm      from './locales/pt-br/dm.json';
import ptbr_notifications from './locales/pt-br/notifications.json';
import ptbr_publicProfile from './locales/pt-br/publicProfile.json';
import ptbr_me      from './locales/pt-br/me.json';
import ptbr_misc    from './locales/pt-br/misc.json';
import ptbr_cities  from './locales/pt-br/cities.json';
import ptbr_upcoming from './locales/pt-br/upcoming.json';
import ptbr_archive from './locales/pt-br/archive.json';
import ptpt_common  from './locales/pt-pt/common.json';
import ptpt_auth    from './locales/pt-pt/auth.json';
import ptpt_landing from './locales/pt-pt/landing.json';
import ptpt_here    from './locales/pt-pt/here.json';
import ptpt_now     from './locales/pt-pt/now.json';
import ptpt_chat    from './locales/pt-pt/chat.json';
import ptpt_event   from './locales/pt-pt/event.json';
import ptpt_hangout from './locales/pt-pt/hangout.json';
import ptpt_dm      from './locales/pt-pt/dm.json';
import ptpt_notifications from './locales/pt-pt/notifications.json';
import ptpt_publicProfile from './locales/pt-pt/publicProfile.json';
import ptpt_me      from './locales/pt-pt/me.json';
import ptpt_misc    from './locales/pt-pt/misc.json';
import ptpt_cities  from './locales/pt-pt/cities.json';
import ptpt_upcoming from './locales/pt-pt/upcoming.json';
import ptpt_archive from './locales/pt-pt/archive.json';
import de_common  from './locales/de/common.json';
import de_auth    from './locales/de/auth.json';
import de_landing from './locales/de/landing.json';
import de_here    from './locales/de/here.json';
import de_now     from './locales/de/now.json';
import de_chat    from './locales/de/chat.json';
import de_event   from './locales/de/event.json';
import de_hangout from './locales/de/hangout.json';
import de_dm      from './locales/de/dm.json';
import de_notifications from './locales/de/notifications.json';
import de_publicProfile from './locales/de/publicProfile.json';
import de_me      from './locales/de/me.json';
import de_misc    from './locales/de/misc.json';
import de_cities  from './locales/de/cities.json';
import de_upcoming from './locales/de/upcoming.json';
import de_archive from './locales/de/archive.json';
import nl_common  from './locales/nl/common.json';
import nl_auth    from './locales/nl/auth.json';
import nl_landing from './locales/nl/landing.json';
import nl_here    from './locales/nl/here.json';
import nl_now     from './locales/nl/now.json';
import nl_chat    from './locales/nl/chat.json';
import nl_event   from './locales/nl/event.json';
import nl_hangout from './locales/nl/hangout.json';
import nl_dm      from './locales/nl/dm.json';
import nl_notifications from './locales/nl/notifications.json';
import nl_publicProfile from './locales/nl/publicProfile.json';
import nl_me      from './locales/nl/me.json';
import nl_misc    from './locales/nl/misc.json';
import nl_cities  from './locales/nl/cities.json';
import nl_upcoming from './locales/nl/upcoming.json';
import nl_archive from './locales/nl/archive.json';
import zhhans_common  from './locales/zh-hans/common.json';
import zhhans_auth    from './locales/zh-hans/auth.json';
import zhhans_landing from './locales/zh-hans/landing.json';
import zhhans_here    from './locales/zh-hans/here.json';
import zhhans_now     from './locales/zh-hans/now.json';
import zhhans_chat    from './locales/zh-hans/chat.json';
import zhhans_event   from './locales/zh-hans/event.json';
import zhhans_hangout from './locales/zh-hans/hangout.json';
import zhhans_dm      from './locales/zh-hans/dm.json';
import zhhans_notifications from './locales/zh-hans/notifications.json';
import zhhans_publicProfile from './locales/zh-hans/publicProfile.json';
import zhhans_me      from './locales/zh-hans/me.json';
import zhhans_misc    from './locales/zh-hans/misc.json';
import zhhans_cities  from './locales/zh-hans/cities.json';
import zhhans_upcoming from './locales/zh-hans/upcoming.json';
import zhhans_archive from './locales/zh-hans/archive.json';
import zhhant_common  from './locales/zh-hant/common.json';
import zhhant_auth    from './locales/zh-hant/auth.json';
import zhhant_landing from './locales/zh-hant/landing.json';
import zhhant_here    from './locales/zh-hant/here.json';
import zhhant_now     from './locales/zh-hant/now.json';
import zhhant_chat    from './locales/zh-hant/chat.json';
import zhhant_event   from './locales/zh-hant/event.json';
import zhhant_hangout from './locales/zh-hant/hangout.json';
import zhhant_dm      from './locales/zh-hant/dm.json';
import zhhant_notifications from './locales/zh-hant/notifications.json';
import zhhant_publicProfile from './locales/zh-hant/publicProfile.json';
import zhhant_me      from './locales/zh-hant/me.json';
import zhhant_misc    from './locales/zh-hant/misc.json';
import zhhant_cities  from './locales/zh-hant/cities.json';
import zhhant_upcoming from './locales/zh-hant/upcoming.json';
import zhhant_archive from './locales/zh-hant/archive.json';
import ja_common  from './locales/ja/common.json';
import ja_auth    from './locales/ja/auth.json';
import ja_landing from './locales/ja/landing.json';
import ja_here    from './locales/ja/here.json';
import ja_now     from './locales/ja/now.json';
import ja_chat    from './locales/ja/chat.json';
import ja_event   from './locales/ja/event.json';
import ja_hangout from './locales/ja/hangout.json';
import ja_dm      from './locales/ja/dm.json';
import ja_notifications from './locales/ja/notifications.json';
import ja_publicProfile from './locales/ja/publicProfile.json';
import ja_me      from './locales/ja/me.json';
import ja_misc    from './locales/ja/misc.json';
import ja_cities  from './locales/ja/cities.json';
import ja_upcoming from './locales/ja/upcoming.json';
import ja_archive from './locales/ja/archive.json';
import ko_common  from './locales/ko/common.json';
import ko_auth    from './locales/ko/auth.json';
import ko_landing from './locales/ko/landing.json';
import ko_here    from './locales/ko/here.json';
import ko_now     from './locales/ko/now.json';
import ko_chat    from './locales/ko/chat.json';
import ko_event   from './locales/ko/event.json';
import ko_hangout from './locales/ko/hangout.json';
import ko_dm      from './locales/ko/dm.json';
import ko_notifications from './locales/ko/notifications.json';
import ko_publicProfile from './locales/ko/publicProfile.json';
import ko_me      from './locales/ko/me.json';
import ko_misc    from './locales/ko/misc.json';
import ko_cities  from './locales/ko/cities.json';
import ko_upcoming from './locales/ko/upcoming.json';
import ko_archive from './locales/ko/archive.json';
import fil_common  from './locales/fil/common.json';
import fil_auth    from './locales/fil/auth.json';
import fil_landing from './locales/fil/landing.json';
import fil_here    from './locales/fil/here.json';
import fil_now     from './locales/fil/now.json';
import fil_chat    from './locales/fil/chat.json';
import fil_event   from './locales/fil/event.json';
import fil_hangout from './locales/fil/hangout.json';
import fil_dm      from './locales/fil/dm.json';
import fil_notifications from './locales/fil/notifications.json';
import fil_publicProfile from './locales/fil/publicProfile.json';
import fil_me      from './locales/fil/me.json';
import fil_misc    from './locales/fil/misc.json';
import fil_cities  from './locales/fil/cities.json';
import fil_upcoming from './locales/fil/upcoming.json';
import fil_archive from './locales/fil/archive.json';

export const SUPPORTED = ['en', 'fr', 'vi', 'es', 'it', 'pt-br', 'pt-pt', 'de', 'nl', 'zh-hans', 'zh-hant', 'ja', 'ko', 'fil'] as const;
export type Locale = (typeof SUPPORTED)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const STORAGE_KEY = 'hilads_lang'; // mirrors the web cookie name

const NS = ['common', 'auth', 'landing', 'here', 'now', 'chat', 'event', 'hangout', 'dm', 'notifications', 'publicProfile', 'me', 'misc', 'cities', 'upcoming', 'archive'] as const;

const resources = {
  en: { common: en_common, auth: en_auth, landing: en_landing, here: en_here, now: en_now, chat: en_chat, event: en_event, hangout: en_hangout, dm: en_dm, notifications: en_notifications, publicProfile: en_publicProfile, me: en_me, misc: en_misc, cities: en_cities, upcoming: en_upcoming, archive: en_archive },
  fr: { common: fr_common, auth: fr_auth, landing: fr_landing, here: fr_here, now: fr_now, chat: fr_chat, event: fr_event, hangout: fr_hangout, dm: fr_dm, notifications: fr_notifications, publicProfile: fr_publicProfile, me: fr_me, misc: fr_misc, cities: fr_cities, upcoming: fr_upcoming, archive: fr_archive },
  vi: { common: vi_common, auth: vi_auth, landing: vi_landing, here: vi_here, now: vi_now, chat: vi_chat, event: vi_event, hangout: vi_hangout, dm: vi_dm, notifications: vi_notifications, publicProfile: vi_publicProfile, me: vi_me, misc: vi_misc, cities: vi_cities, upcoming: vi_upcoming, archive: vi_archive },
  es: { common: es_common, auth: es_auth, landing: es_landing, here: es_here, now: es_now, chat: es_chat, event: es_event, hangout: es_hangout, dm: es_dm, notifications: es_notifications, publicProfile: es_publicProfile, me: es_me, misc: es_misc, cities: es_cities, upcoming: es_upcoming, archive: es_archive },
  it: { common: it_common, auth: it_auth, landing: it_landing, here: it_here, now: it_now, chat: it_chat, event: it_event, hangout: it_hangout, dm: it_dm, notifications: it_notifications, publicProfile: it_publicProfile, me: it_me, misc: it_misc, cities: it_cities, upcoming: it_upcoming, archive: it_archive },
  'pt-br': { common: ptbr_common, auth: ptbr_auth, landing: ptbr_landing, here: ptbr_here, now: ptbr_now, chat: ptbr_chat, event: ptbr_event, hangout: ptbr_hangout, dm: ptbr_dm, notifications: ptbr_notifications, publicProfile: ptbr_publicProfile, me: ptbr_me, misc: ptbr_misc, cities: ptbr_cities, upcoming: ptbr_upcoming, archive: ptbr_archive },
  'pt-pt': { common: ptpt_common, auth: ptpt_auth, landing: ptpt_landing, here: ptpt_here, now: ptpt_now, chat: ptpt_chat, event: ptpt_event, hangout: ptpt_hangout, dm: ptpt_dm, notifications: ptpt_notifications, publicProfile: ptpt_publicProfile, me: ptpt_me, misc: ptpt_misc, cities: ptpt_cities, upcoming: ptpt_upcoming, archive: ptpt_archive },
  de: { common: de_common, auth: de_auth, landing: de_landing, here: de_here, now: de_now, chat: de_chat, event: de_event, hangout: de_hangout, dm: de_dm, notifications: de_notifications, publicProfile: de_publicProfile, me: de_me, misc: de_misc, cities: de_cities, upcoming: de_upcoming, archive: de_archive },
  nl: { common: nl_common, auth: nl_auth, landing: nl_landing, here: nl_here, now: nl_now, chat: nl_chat, event: nl_event, hangout: nl_hangout, dm: nl_dm, notifications: nl_notifications, publicProfile: nl_publicProfile, me: nl_me, misc: nl_misc, cities: nl_cities, upcoming: nl_upcoming, archive: nl_archive },
  'zh-hans': { common: zhhans_common, auth: zhhans_auth, landing: zhhans_landing, here: zhhans_here, now: zhhans_now, chat: zhhans_chat, event: zhhans_event, hangout: zhhans_hangout, dm: zhhans_dm, notifications: zhhans_notifications, publicProfile: zhhans_publicProfile, me: zhhans_me, misc: zhhans_misc, cities: zhhans_cities, upcoming: zhhans_upcoming, archive: zhhans_archive },
  'zh-hant': { common: zhhant_common, auth: zhhant_auth, landing: zhhant_landing, here: zhhant_here, now: zhhant_now, chat: zhhant_chat, event: zhhant_event, hangout: zhhant_hangout, dm: zhhant_dm, notifications: zhhant_notifications, publicProfile: zhhant_publicProfile, me: zhhant_me, misc: zhhant_misc, cities: zhhant_cities, upcoming: zhhant_upcoming, archive: zhhant_archive },
  ja: { common: ja_common, auth: ja_auth, landing: ja_landing, here: ja_here, now: ja_now, chat: ja_chat, event: ja_event, hangout: ja_hangout, dm: ja_dm, notifications: ja_notifications, publicProfile: ja_publicProfile, me: ja_me, misc: ja_misc, cities: ja_cities, upcoming: ja_upcoming, archive: ja_archive },
  ko: { common: ko_common, auth: ko_auth, landing: ko_landing, here: ko_here, now: ko_now, chat: ko_chat, event: ko_event, hangout: ko_hangout, dm: ko_dm, notifications: ko_notifications, publicProfile: ko_publicProfile, me: ko_me, misc: ko_misc, cities: ko_cities, upcoming: ko_upcoming, archive: ko_archive },
  fil: { common: fil_common, auth: fil_auth, landing: fil_landing, here: fil_here, now: fil_now, chat: fil_chat, event: fil_event, hangout: fil_hangout, dm: fil_dm, notifications: fil_notifications, publicProfile: fil_publicProfile, me: fil_me, misc: fil_misc, cities: fil_cities, upcoming: fil_upcoming, archive: fil_archive },
};

function isSupported(code: string | null | undefined): code is Locale {
  return !!code && (SUPPORTED as readonly string[]).includes(code);
}

// Device language (synchronous) — used as the initial default before any saved
// override is read from AsyncStorage. Falls back to English.
function deviceLocale(): Locale {
  try {
    const loc  = Localization.getLocales()[0];
    const tag  = (loc?.languageTag ?? '').toLowerCase();   // e.g. "pt-br"
    const code = (loc?.languageCode ?? '').toLowerCase();  // e.g. "pt"
    // Portuguese is regional: only pt-BR → pt-br; bare "pt" and any other
    // pt-XX (incl. pt-PT) default to European (pt-pt), per product decision.
    if (code === 'pt' || tag.startsWith('pt')) return tag.includes('br') ? 'pt-br' : 'pt-pt';
    // Chinese is script-based: TW/HK/MO/Hant → Traditional; everything else
    // zh-* (CN/SG/Hans/bare zh) → Simplified default, per product decision.
    if (code === 'zh' || tag.startsWith('zh')) return /hant|tw|hk|mo/.test(tag) ? 'zh-hant' : 'zh-hans';
    // Filipino (3-letter code) + Tagalog (tl) both → fil.
    if (code === 'fil' || code === 'tl' || tag.startsWith('fil') || tag.startsWith('tl')) return 'fil';
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
  // Bundle keys are lowercase (pt-br, zh-hans). Without this, i18next normalizes
  // hyphenated codes to pt-BR / zh-Hans for lookups → misses the bundles and
  // falls back to English. Force lowercase so the active language matches keys.
  lowerCaseLng: true,
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
