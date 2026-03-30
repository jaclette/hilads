/**
 * Shared time / date formatting for all chat surfaces (city, event, DM).
 *
 * createdAt can be:
 *   - unix seconds (number < 1e10)  — city / event message API
 *   - unix milliseconds (number ≥ 1e10) — rare but handled
 *   - ISO string                    — DM message API
 */

function toMs(ts: number | string | undefined): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts < 1e10 ? ts * 1000 : ts;
  return new Date(ts).getTime();
}

/** "18:42" — short local time for the timestamp under a bubble. */
export function formatTime(ts: number | string | undefined): string {
  const ms = toMs(ts);
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
