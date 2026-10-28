import i18n from '@/i18n';
import { shortCityName } from '@/i18n/cityName';
import type { DailyThemeKey } from '@/types';

// Weekly themes (v2, SPEC 8.2). Names are shown in the app's language
// (common.json themes.*, English as fallback); the app adds the weekday each
// one falls on by default (icons: ui/ThemeIcon). "special" = a special day of
// world scope: it shows the day's own name (Halloween).

/** English names (the API's DailyThemes), for screens that pick a theme before any payload. */
export const THEME_NAMES: Record<DailyThemeKey, string> = {
  hidden_gem: 'Hidden gem', taste: 'Taste', get_around: 'Get around', local_find: 'Local find',
  night_out: 'Night out', sip: 'Drinks', only_here: 'Only here',
};

/**
 * A theme's name in the app's language ('' without a key). A special day
 * shows its own name; Only here with a city reads "Only in Saigon" (the
 * city's short name: the challenge card and the Passport stamp; World scope
 * passes no city).
 */
export function themeName(key?: string | null, opts?: { special?: { name: string } | null; city?: string | null }): string {
  if (!key) return '';
  if (key === 'special') return opts?.special?.name ?? i18n.t('themes.special', { ns: 'common', defaultValue: 'Special' });
  if (key === 'only_here' && opts?.city) {
    return i18n.t('themes.onlyIn', { ns: 'common', city: shortCityName(opts.city), defaultValue: `Only in ${shortCityName(opts.city)}` });
  }
  return i18n.t(`themes.${key}`, { ns: 'common', defaultValue: THEME_NAMES[key as DailyThemeKey] ?? key });
}

/** Every weekly theme is about a place (the proof's spot; Get around: where you hop on or off); a special day is not. */
export function isPlaceTheme(key?: string | null): boolean {
  return !!key && key !== 'special';
}

/** ISO weekday (1 = Monday) of each theme's default day, in weekly order. */
export const THEME_WEEKDAY: Record<DailyThemeKey, number> = {
  hidden_gem: 1, taste: 2, get_around: 3, local_find: 4, night_out: 5, sip: 6, only_here: 7,
};

export const THEME_KEYS = Object.keys(THEME_WEEKDAY) as DailyThemeKey[];

/** The theme a date gets by default (its weekday's), for when the API gives none. */
export function defaultThemeFor(date: string): DailyThemeKey {
  const iso = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  return THEME_KEYS.find(k => THEME_WEEKDAY[k] === iso) ?? 'hidden_gem';
}

/** The next date (after `today`, Y-m-d) on the theme's weekday, as a localized weekday name. */
export function nextThemeDay(key: DailyThemeKey, today: string, locale: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  const iso = d.getUTCDay() || 7;
  const ahead = ((THEME_WEEKDAY[key] - iso + 7) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + ahead);
  try {
    return d.toLocaleDateString(locale, { weekday: 'long', timeZone: 'UTC' });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Y-m-d of a Date in UTC (challenge dates are UTC dates). */
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** `date` (Y-m-d) shifted by `days`. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
}
