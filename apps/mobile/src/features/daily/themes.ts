import i18n from '@/i18n';
import type { DailyThemeKey } from '@/types';

// Weekly themes (V2-03). Names are shown in the app's language (common.json
// themes.*, English as fallback); the app adds the weekday each one falls on
// by default (icons: features/today/format).

/** English names (the API's DailyThemes), for screens that pick a theme before any payload. */
export const THEME_NAMES: Record<DailyThemeKey, string> = {
  language: 'Language', street_food: 'Street food', coffee: 'Coffee', market: 'Market',
  night_out: 'Night out', neighborhood: 'Neighborhood', traditions: 'Traditions',
};

/** A theme's name in the app's language ('' without a key). */
export function themeName(key?: string | null): string {
  if (!key) return '';
  return i18n.t(`themes.${key}`, { ns: 'common', defaultValue: THEME_NAMES[key as DailyThemeKey] ?? key });
}

/** ISO weekday (1 = Monday) of each theme's default day, in weekly order. */
export const THEME_WEEKDAY: Record<DailyThemeKey, number> = {
  language: 1, street_food: 2, coffee: 3, market: 4, night_out: 5, neighborhood: 6, traditions: 7,
};

export const THEME_KEYS = Object.keys(THEME_WEEKDAY) as DailyThemeKey[];

/** The theme a date gets by default (its weekday's), for when the API gives none. */
export function defaultThemeFor(date: string): DailyThemeKey {
  const iso = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  return THEME_KEYS.find(k => THEME_WEEKDAY[k] === iso) ?? 'language';
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
