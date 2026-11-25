import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from '@/i18n';
import { fetchContest, type ContestOverview } from './contest';

/**
 * The temporary Launch Season tab (the plane): shown only while a season I can see is Upcoming
 * (the teaser) or Running (season / final week); gone when it ends or when there is none, so the
 * app is back to its 4 tabs. A launcher: it opens the teaser / Prize screen, or my contest home
 * once I joined. A dot when something is new for me: the tab just appeared, the season launched,
 * the final week started (one stamp per season and phase, cleared on tap).
 */
export type ContestTab = { route: string; isTest: boolean; isNew: boolean; markSeen: () => void } | null;

const SEEN_KEY = 'contest_tab_seen';
const LIVE = new Set(['upcoming', 'season', 'final']);

let data: ContestOverview | null = null;
let seen: string | null = null;
let loadedAt = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());

AsyncStorage.getItem(SEEN_KEY).then(v => { seen = v; emit(); }).catch(() => {});

function load(force = false) {
  if (!force && Date.now() - loadedAt < 5 * 60_000) return;
  loadedAt = Date.now();
  fetchContest(i18n.language).then(d => { data = d; emit(); }).catch(() => { loadedAt = 0; });
}

/** After joining or a Notify me elsewhere, the tab's target can change: refresh it. */
export function refreshContestTab() { load(true); }

export function useContestTab(): ContestTab {
  const [, setTick] = useState(0);
  useEffect(() => {
    const f = () => setTick(n => n + 1);
    subs.add(f);
    load();
    const sub = AppState.addEventListener('change', st => { if (st === 'active') load(); });
    return () => { subs.delete(f); sub.remove(); };
  }, []);
  const s = data?.season;
  if (!s || !LIVE.has(s.phase)) return null;
  const stamp = `${s.id}:${s.phase}`;
  const joined = data?.me?.joined === true;
  return {
    route: s.phase !== 'upcoming' && joined ? '/contest' : '/contest-prize',
    isTest: !!s.isTest,
    isNew: seen !== stamp,
    markSeen: () => {
      if (seen === stamp) return;
      seen = stamp;
      AsyncStorage.setItem(SEEN_KEY, stamp).catch(() => {});
      emit();
    },
  };
}
