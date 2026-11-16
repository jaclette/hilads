/**
 * Notification time helpers shared by the inbox rows (InboxRow, inboxText) and photo comments.
 */

import i18n from '@/i18n';

// ── Relative time ─────────────────────────────────────────────────────────────

/**
 * A server time as epoch ms: ISO 8601, Postgres' "2026-11-05 14:00:00.123+00" (Hermes can't
 * parse the space or the short offset), or epoch seconds / ms. NaN when unknown.
 */
export function parseTime(raw?: string | number | null): number {
  if (raw === null || raw === undefined || raw === '') return NaN;
  if (typeof raw === 'number') return raw < 1e10 ? raw * 1000 : raw;
  let ms = Date.parse(raw);
  if (isNaN(ms)) {
    const iso = raw.trim().replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    ms = Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`);
  }
  if (isNaN(ms)) {
    const n = Number(raw);
    if (!isNaN(n)) ms = n < 1e10 ? n * 1000 : n;
  }
  return ms;
}

/** Calendar days between that moment and now, in the phone's time zone (0 = today, 1 = yesterday). */
export function calendarDaysAgo(ms: number, now = new Date()): number {
  const at = new Date(ms);
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((day(now) - day(at)) / 86_400_000);
}

/**
 * "now", "5m", "3h" today; from yesterday on, by calendar day in the phone's time zone
 * ("1d" is always yesterday, as the notifications' sections are), never by 24 h blocks
 * (23:00 seen at 9:00 the day after is 1d, a 40 h old one from two days ago is 2d).
 */
export function relativeTime(raw?: string | null): string {
  const ms = parseTime(raw);
  if (isNaN(ms)) return '';
  const days = calendarDaysAgo(ms);
  if (days >= 1) return i18n.t('time.dAgo', { ns: 'common', count: days });
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60)    return i18n.t('time.nowShort', { ns: 'common' });
  if (diffSec < 3600)  return i18n.t('time.mAgo', { ns: 'common', count: Math.floor(diffSec / 60) });
  return i18n.t('time.hAgo', { ns: 'common', count: Math.floor(diffSec / 3600) });
}
