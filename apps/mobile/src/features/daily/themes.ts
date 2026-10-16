import type { DailyTheme, DailyThemeKey } from '@/types';

// Weekly themes (V2-03). Names come from the API (English content); the app
// only adds an emoji per theme and the weekday each one falls on by default.

export const THEME_EMOJI: Record<DailyThemeKey, string> = {
  language:     '🗣️',
  street_food:  '🍜',
  coffee:       '☕',
  market:       '🧺',
  night_out:    '🌙',
  neighborhood: '🏘️',
  traditions:   '🏮',
};

/** ISO weekday (1 = Monday) of each theme's default day, in weekly order. */
export const THEME_WEEKDAY: Record<DailyThemeKey, number> = {
  language: 1, street_food: 2, coffee: 3, market: 4, night_out: 5, neighborhood: 6, traditions: 7,
};

export const THEME_KEYS = Object.keys(THEME_WEEKDAY) as DailyThemeKey[];

/** "🍜 Street food" (empty for no theme). */
export function themeLabel(theme: DailyTheme | null | undefined): string {
  return theme ? `${THEME_EMOJI[theme.key] ?? '•'} ${theme.name}` : '';
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
