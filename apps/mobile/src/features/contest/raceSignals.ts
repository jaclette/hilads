import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * What the campaign surfaces react to, kept on the phone per campaign:
 * - Today visits (the banner is the full postcard for the first N, Admin › Launch Season › Prize);
 * - my race rank as last known, and a rank change (from → to, when) noticed when the overview
 *   answers with a different rank. A change keeps the banner full for H hours, lights the Trip tab's
 *   dot until the tab is opened, and adds a line to "While you were away" until it's seen.
 * The first rank ever known is not a change (nothing to compare to).
 */
const KEY = 'trip_race_signals_v1';
type Change = { from: number; to: number; at: number; awayAck: boolean; tabAck: boolean };
type State = { id: number | null; rank: number | null; visits: number; change: Change | null };
let state: State = { id: null, rank: null, visits: 0, change: null };
let loaded = false;
const pendingSync: (() => void)[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
const save = () => { AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {}); emit(); };

AsyncStorage.getItem(KEY).then(raw => {
  if (raw) { try { state = { ...state, ...JSON.parse(raw) }; } catch { /* a bad entry: start over */ } }
  loaded = true;
  pendingSync.splice(0).forEach(f => f());
  emit();
}).catch(() => { loaded = true; pendingSync.splice(0).forEach(f => f()); });

function forSeason(id: number) {
  if (state.id !== id) state = { id, rank: null, visits: 0, change: null };
}

/** The overview answered: my rank in the race now (null = not ranked). */
export function syncRaceRank(seasonId: number, rank: number | null) {
  if (!loaded) { pendingSync.push(() => syncRaceRank(seasonId, rank)); return; }
  const before = state.id;
  forSeason(seasonId);
  if (rank === null || rank === state.rank) { if (before !== seasonId) save(); return; }
  if (state.rank !== null) state.change = { from: state.rank, to: rank, at: Date.now(), awayAck: false, tabAck: false };
  state.rank = rank;
  save();
}

/** One Today visit (the banner's full postcard for the first N). Returns the visit's number. */
export function countTodayVisit(seasonId: number): number {
  forSeason(seasonId);
  state.visits += 1;
  save();
  return state.visits;
}

export function ackRankAway() { if (state.change && !state.change.awayAck) { state.change.awayAck = true; save(); } }
export function ackRankTab() { if (state.change && !state.change.tabAck) { state.change.tabAck = true; save(); } }

/** The current signals for a campaign (null id: nothing). */
export function useRaceSignals(seasonId: number | null): { visits: number; change: Change | null } {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick(n => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  if (seasonId === null || state.id !== seasonId) return { visits: 0, change: null };
  return { visits: state.visits, change: state.change };
}

export function raceSignalsLoaded(): boolean { return loaded; }
