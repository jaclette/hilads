/**
 * Shared time / date formatting for all chat surfaces (city, event, DM).
 *
 * createdAt can be:
 *   - unix seconds (number < 1e10)  — city / event message API
 *   - unix milliseconds (number ≥ 1e10) — rare but handled
 *   - ISO string                    — DM message API (optimistic messages)
 *   - PostgreSQL TIMESTAMPTZ string — DM messages from the backend API,
 *     e.g. "2024-03-15 18:30:00.123456+00"
 *     (space instead of T, microseconds, +HH timezone suffix without minutes)
 *     Hermes (Android JS engine) returns Invalid Date for this format.
 *     We normalise it to ISO 8601 before parsing.
 */

function normalizePostgresTimestamp(ts: string): string {
  return ts
    .replace(' ', 'T')             // "2024-03-15 18:30:00" → "2024-03-15T18:30:00"
    .replace(/(\.\d{3})\d+/, '$1') // truncate microseconds → milliseconds
    .replace(/([+-]\d{2})$/, '$1:00'); // "+00" suffix → "+00:00"
}

export function toMs(ts: number | string | undefined): number {
  if (ts === undefined || ts === null || ts === '') return 0;
  if (typeof ts === 'number') return ts < 1e10 ? ts * 1000 : ts;
  const ms = new Date(normalizePostgresTimestamp(ts)).getTime();
  return isNaN(ms) ? 0 : ms;
}

/** "18:42" — short local time. Kept for backward compatibility; prefer formatSmartTime. */
export function formatTime(ts: number | string | undefined): string {
  const ms = toMs(ts);
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Smart timestamp for message bubbles and feed items:
 *   Today      → "3:04 PM"
 *   Yesterday  → "Yesterday · 3:04 PM"
 *   This year  → "Apr 16 · 3:04 PM"
 *   Older      → "Apr 16, 2025 · 3:04 PM"
 */
export function formatSmartTime(ts: number | string | undefined): string {
  const ms = toMs(ts);
  if (!ms) return '';
  const d   = new Date(ms);
  const now = new Date();

  const time      = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const today     = startOfDay(now);
  const yesterday = new Date(today.getTime() - 86_400_000);
  const msgDay    = startOfDay(d);

  if (msgDay.getTime() === today.getTime())     return time;
  if (msgDay.getTime() === yesterday.getTime()) return `Yesterday · ${time}`;

  const datePart = d.toLocaleDateString([], {
    month: 'short',
    day:   'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
  return `${datePart} · ${time}`;
}

/**
 * Human-readable date label for a separator pill:
 *   "Today" | "Yesterday" | "Mar 29" | "Mar 29, 2024"
 */
export function formatDateLabel(ts: number | string | undefined): string {
  const ms = toMs(ts);
  if (!ms) return '';
  const d   = new Date(ms);
  const now = new Date();

  const today     = startOfDay(now);
  const yesterday = new Date(today.getTime() - 86_400_000);
  const msgDay    = startOfDay(d);

  if (msgDay.getTime() === today.getTime())     return 'Today';
  if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday';

  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString([], opts);
}

/** True if two timestamps fall on the same calendar day (or either is absent). */
export function isSameDay(
  ts1: number | string | undefined,
  ts2: number | string | undefined,
): boolean {
  if (!ts1 || !ts2) return true; // missing timestamp → don't insert a separator
  return startOfDay(new Date(toMs(ts1))).getTime() ===
         startOfDay(new Date(toMs(ts2))).getTime();
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
