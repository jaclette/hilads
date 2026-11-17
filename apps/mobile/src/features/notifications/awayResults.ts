import { useSyncExternalStore } from 'react';

/**
 * Whether the "While you were away" card on Today is showing: one card at a time above the
 * hero, so the results card waits until it's gone (the away card often carries the results).
 */
let showing = false;
const listeners = new Set<() => void>();

export function setAwayCardShowing(v: boolean) {
  if (v === showing) return;
  showing = v;
  listeners.forEach(l => l());
}

export function useAwayCardShowing(): boolean {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => showing, () => showing);
}
