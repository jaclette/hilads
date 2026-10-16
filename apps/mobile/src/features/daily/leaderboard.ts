import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { fetchDailyLeaderboard } from '@/api/daily';
import { onDailyDropped } from '@/lib/dailyEvents';
import type { DailyLeaderboard } from '@/types';

// Provisional leaderboard of the active challenge (GET /daily/leaderboard),
// shared by the sheet's Top 10 tab and the hero card's top 3. Polled every
// 30 s while at least one focused screen shows it and the app is in the
// foreground, never in the background. The ETag makes an unchanged poll a
// body-less 304.

const POLL_MS = 30_000;

let data: DailyLeaderboard | null = null;
let etag: string | null = null;
let fetchedAt = 0;
let inFlight = false;
let viewerKey: string | null | undefined;
let guestId: string | null = null;
let watchers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  listeners.forEach(l => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Forget the data when the viewer changes ("me" and blocks are per viewer). */
function setViewer(key: string | null, guest: string | null) {
  guestId = guest;
  if (key === viewerKey) return;
  const first = viewerKey === undefined;
  viewerKey = key;
  if (first) return;
  data = null;
  etag = null;
  fetchedAt = 0;
  emit();
  if (watchers > 0) refresh(true);
}

async function refresh(force = false) {
  if (inFlight || (!force && Date.now() - fetchedAt < POLL_MS - 1000)) return;
  inFlight = true;
  try {
    const res = await fetchDailyLeaderboard(force ? null : etag, guestId);
    fetchedAt = Date.now();
    if (res) {
      data = res.data;
      etag = res.etag;
      emit();
    }
  } catch (err) {
    console.warn('[daily] leaderboard failed:', String(err));
  } finally {
    inFlight = false;
  }
}

function watch() {
  watchers++;
  refresh();
  timer ??= setInterval(() => {
    if (watchers > 0 && AppState.currentState === 'active') refresh();
  }, POLL_MS);
}

function unwatch() {
  watchers = Math.max(0, watchers - 1);
  if (watchers === 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * The live leaderboard, polled while the calling screen is focused and
 * `enabled`. Pass the viewer (account id or `g:<guestId>`) and the guest id.
 */
export function useDailyLeaderboard(enabled: boolean, viewer: string | null, guest: string | null): DailyLeaderboard | null {
  useSyncExternalStore(subscribe, () => version);
  // Before the focus effect below (effects run in order): the first poll uses this viewer.
  useEffect(() => { setViewer(viewer, guest); }, [viewer, guest]);

  useFocusEffect(useCallback(() => {
    if (!enabled) return;
    watch();
    return unwatch;
  }, [enabled]));

  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', s => { if (s === 'active') refresh(); });
    const off = onDailyDropped(() => { refresh(true); });
    return () => { sub.remove(); off(); };
  }, [enabled]);

  return data;
}
