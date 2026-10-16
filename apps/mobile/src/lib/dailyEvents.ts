/**
 * In-app signal: a daily_challenge card just arrived over the socket (the
 * daily drop happened). The hero card and the pinned header refetch today's
 * challenge right away instead of waiting for the countdown or a refocus.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function emitDailyDropped(): void {
  listeners.forEach(fn => { try { fn(); } catch { /* listener errors never break the feed */ } });
}

export function onDailyDropped(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** True for the Daily Challenge system cards (daily_challenge / daily_proof / daily_proof_group). */
export function isDailyCard(m: { type?: string; event?: string }): boolean {
  return m.type === 'system'
    && (m.event === 'daily_challenge' || m.event === 'daily_proof' || m.event === 'daily_proof_group');
}
