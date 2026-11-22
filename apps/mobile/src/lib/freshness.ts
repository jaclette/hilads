import { AppState } from 'react-native';

/**
 * "Fetch again" (stale-while-revalidate): screens keep showing what they have,
 * then fetch in the background when the app comes back to the foreground, or
 * when a push about new content arrives (in the foreground) or is tapped.
 * Frozen tabs (freezeOnBlur) still hear it: their state updates and shows on
 * return. `reason` lets a listener skip what doesn't concern it.
 */
export type FreshReason = 'foreground' | 'push' | 'post';
type Listener = (reason: FreshReason) => void;

const listeners = new Set<Listener>();
let appState = AppState.currentState;
AppState.addEventListener('change', s => {
  const back = appState !== 'active' && s === 'active';
  appState = s;
  if (back) requestFresh('foreground');
});

export function requestFresh(reason: FreshReason): void {
  listeners.forEach(fn => { try { fn(reason); } catch { /* one listener never breaks the others */ } });
}

export function onFresh(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Push types about new Daily content (a photo, a vote, a comment, results): the lists they belong to fetch again. */
export function isContentPush(type: string | undefined): boolean {
  return !!type && (type.startsWith('daily_') || type === 'photo_comment' || type === 'photo_mention');
}
