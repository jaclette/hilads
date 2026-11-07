import { useSyncExternalStore } from 'react';

/**
 * Whether the "While you were away" card on Today is showing yesterday's results: then it
 * carries them, and the separate results card stays hidden (one results block, never two).
 */
let showing = false;
const listeners = new Set<() => void>();

export function setAwayShowsResults(v: boolean) {
  if (v === showing) return;
  showing = v;
  listeners.forEach(l => l());
}

export function useAwayShowsResults(): boolean {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => showing, () => showing);
}
