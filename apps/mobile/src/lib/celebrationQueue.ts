import { useEffect, useSyncExternalStore } from 'react';

/**
 * One celebration at a time (2026-11-07). The app's victory popups (the points
 * reward, a new stamp, a group challenge result, the rating prompt) ask for a
 * turn here instead of opening straight away: the first in line shows, the
 * others wait until it closes. Nothing opens while something else holds the
 * screen: an open sheet or modal (`holdScreen`), the While you were away card
 * being handled, or a screen other than a tab (the photo flow, a story viewer):
 * the gates pass `onTab` from their route.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
let line: string[] = [];          // ids waiting, in order (line[0] has the turn)
const holds = new Set<string>();  // things holding the screen (sheets, the away card)
let version = 0;

function emit() {
  version++;
  listeners.forEach(fn => fn());
}

function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Something (a sheet, a modal, the away card) holds the screen until the returned release. */
export function holdScreen(id: string): () => void {
  holds.add(id);
  emit();
  return () => { if (holds.delete(id)) emit(); };
}

const shown = new Set<string>();   // on screen: keeps its turn through its own sheets (share)

/**
 * Ask for a turn while `wants` is true; true when it's this celebration's turn
 * (first in line, nothing holding the screen, on a tab). Once on screen it keeps
 * the turn until `wants` goes false (closed) or it unmounts, which passes it on.
 */
export function useCelebrationTurn(id: string, wants: boolean, onTab = true): boolean {
  useEffect(() => {
    if (!wants) return;
    if (!line.includes(id)) { line = [...line, id]; emit(); }
    return () => { line = line.filter(x => x !== id); shown.delete(id); emit(); };
  }, [id, wants]);
  useSyncExternalStore(subscribe, () => version);
  const turn = wants && line[0] === id && (shown.has(id) || (holds.size === 0 && onTab));
  if (turn) shown.add(id);
  return turn;
}

// The points reward asks the server again (a photo was just posted: its +10 may be there).
const rewardListeners = new Set<() => void>();
export function requestScoreCelebration(): void {
  rewardListeners.forEach(fn => { try { fn(); } catch { /* never breaks the caller */ } });
}
export function onScoreCelebrationRequest(fn: () => void): () => void {
  rewardListeners.add(fn);
  return () => { rewardListeners.delete(fn); };
}
