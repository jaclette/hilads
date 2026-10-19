import type { DailyAnswer, DailyCompareType } from '@/types';

/** The half-hours of a day, in minutes since midnight (the time wheel). */
export const HALF_HOURS = Array.from({ length: 48 }, (_, i) => i * 30);

/** Default of the time wheel: 19:00 (dinner and evening questions are the common case). */
export const DEFAULT_TIME = 19 * 60;

/** 1170 → "19:30" (the API's format). */
export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "19:30" → 1170, else null. */
export function parseHhmm(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null;
}

/** A time of day in the viewer's locale: "19:30" or "7:30 PM". */
export function formatTime(minutes: number, locale?: string): string {
  try {
    const d = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
    return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return hhmm(minutes);
  }
}

/** An answer as shown: "Prost!", "37 years", "7:30 PM". */
export function answerText(a: DailyAnswer, locale?: string): string {
  if (a.type === 'time') {
    const m = parseHhmm(String(a.value));
    return m === null ? String(a.value) : formatTime(m, locale);
  }
  if (a.type === 'number') {
    let n = String(a.value);
    try { n = new Intl.NumberFormat(locale).format(Number(a.value)); } catch { /* keep the raw value */ }
    return a.unit ? `${n} ${a.unit}` : n;
  }
  return String(a.value);
}

/** The value an input holds for a question type: text for word / text / number, minutes for time. */
export type AnswerDraft = { text: string; minutes: number };

export const emptyDraft = (): AnswerDraft => ({ text: '', minutes: DEFAULT_TIME });

/** A draft from a saved answer (edit). */
export function draftFrom(a: DailyAnswer | null | undefined): AnswerDraft {
  if (!a) return emptyDraft();
  if (a.type === 'time') return { text: '', minutes: parseHhmm(String(a.value)) ?? DEFAULT_TIME };
  return { text: String(a.value), minutes: DEFAULT_TIME };
}

/** Max characters of a text answer. */
export const maxLength = (type: DailyCompareType): number => (type === 'word' ? 30 : type === 'text' ? 80 : 12);

/**
 * The API value of a draft ("Prost!", 37, "19:30"), or null when it isn't a
 * valid answer yet (empty, too long, not a whole number).
 */
export function answerValue(type: DailyCompareType, d: AnswerDraft): string | number | null {
  if (type === 'time') return hhmm(d.minutes);
  const v = d.text.replace(/\s+/g, ' ').trim();
  if (type === 'number') return /^\d{1,10}$/.test(v) && Number(v) <= 1_000_000_000 ? Number(v) : null;
  return v !== '' && [...v].length <= maxLength(type) ? v : null;
}
