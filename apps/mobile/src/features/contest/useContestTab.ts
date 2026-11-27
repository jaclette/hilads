import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from '@/i18n';
import { useApp } from '@/context/AppContext';
import { fetchContest, type ContestMeJoined, type ContestOverview } from './contest';
import { ackRankTab, syncRaceRank, useRaceSignals } from './raceSignals';

/**
 * The Launch Season overview (GET /contest), shared by the tab bar's temporary tab and the
 * Today / Passport banner: one request, and the last answer kept on the device for the exact
 * context it belongs to (account + language), so a cold start shows the right banner at once
 * instead of popping it in late. A different account or language never sees another's entry:
 * it waits for its own answer.
 */
const KEY_PREFIX = 'contest_overview:';
const SEEN_KEY = 'contest_tab_seen';
const FRESH_MS = 60_000;

let ctx = '';                                  // `${accountId|guest}:${locale}`
let data: ContestOverview | null = null;       // for ctx only
let loadedAt = 0;
let seen: string | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());

AsyncStorage.getItem(SEEN_KEY).then(v => { seen = v; emit(); }).catch(() => {});

function useCtx(): string {
  const { account } = useApp();
  return `${account?.id ?? 'guest'}:${i18n.language}`;
}

function switchTo(next: string) {
  if (ctx === next) return;
  ctx = next; data = null; loadedAt = 0;
  AsyncStorage.getItem(KEY_PREFIX + next).then(raw => {
    if (ctx !== next || data !== null || !raw) return;
    try { data = JSON.parse(raw) as ContestOverview; emit(); } catch { /* ignore a bad entry */ }
  }).catch(() => {});
}

function load(force = false) {
  if (!force && Date.now() - loadedAt < FRESH_MS) return;
  loadedAt = Date.now();
  const forCtx = ctx;
  fetchContest(i18n.language).then(d => {
    if (ctx !== forCtx) return;
    data = d; emit();
    noteRank(d);
    AsyncStorage.setItem(KEY_PREFIX + forCtx, JSON.stringify(d)).catch(() => {});
  }).catch(() => { loadedAt = 0; });
}

/** After joining, a Notify me, a language change: the overview changed, refetch it. */
export function refreshContestTab() { load(true); }

/** Replace the overview with a fresh answer (e.g. the one POST /contest/notify returns). */
export function setContestOverview(d: ContestOverview) {
  data = d; loadedAt = Date.now(); emit();
  noteRank(d);
  AsyncStorage.setItem(KEY_PREFIX + ctx, JSON.stringify(d)).catch(() => {});
}

/** My race rank as the server says it now (ranked players only): a change lights the Trip tab and "While you were away". */
function noteRank(d: ContestOverview) {
  const s = d.season;
  if (!s) return;
  const me = d.me?.joined ? (d.me as ContestMeJoined) : null;
  const race = me?.race;
  syncRaceRank(s.id, race && race.rank && race.points > 0 ? race.rank : null);
}

/** The overview for my account and language (null until known), refreshed on mount / foreground. */
export function useContestOverview(): ContestOverview | null {
  const next = useCtx();
  switchTo(next);
  const [, setTick] = useState(0);
  useEffect(() => {
    const f = () => setTick(n => n + 1);
    subs.add(f);
    load();
    const sub = AppState.addEventListener('change', st => { if (st === 'active') load(); });
    return () => { subs.delete(f); sub.remove(); };
  }, [next]);
  return data;
}

/** Refetch when a screen comes into focus (still at most once a minute). */
export function reloadContestOverview() { load(); }

/**
 * The campaign's temporary tab ("Trip" + a plane by default; label and icon from the server, Admin ›
 * Launch Season › Prize): shown only while a campaign I can see is Upcoming, Running, being checked
 * (over) or just ended (the winner, a few days); gone after that, so the app is back to its 4 tabs.
 * A dot when something is new for me: the tab just appeared, the campaign launched, the final
 * week started, the winner is out (one stamp per campaign and phase, cleared on tap).
 */
export type ContestTab = { label: string | null; icon: string; isTest: boolean; isNew: boolean; markSeen: () => void } | null;
const LIVE = new Set(['upcoming', 'season', 'final', 'over', 'ended']);

export function useContestTab(): ContestTab {
  const d = useContestOverview();
  const s = d?.season;
  const signals = useRaceSignals(s?.id ?? null);
  if (!s || !LIVE.has(s.phase)) return null;
  const stamp = `${s.id}:${s.phase}${s.winner ? ':w' : ''}`;
  // A new phase (the stamp) or my rank changed since I last opened the tab: the dot.
  const rankNew = !!signals.change && !signals.change.tabAck;
  return {
    label: s.tab?.label || null,
    icon: s.tab?.icon || 'airplane',
    isTest: !!s.isTest,
    isNew: seen !== stamp || rankNew,
    markSeen: () => {
      ackRankTab();
      if (seen === stamp) { emit(); return; }
      seen = stamp;
      AsyncStorage.setItem(SEEN_KEY, stamp).catch(() => {});
      emit();
    },
  };
}
