import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import i18n from '@/i18n';
import { useFocusEffect } from 'expo-router';
import { fetchDailyArchive, fetchDailyBoard, fetchDailyCalendar, fetchDailyGuide, fetchDailySheet, fetchDailyToday } from '@/api/daily';
import { useApp } from '@/context/AppContext';
import { onDailyDropped } from '@/lib/dailyEvents';
import { isGpsCity } from '@/lib/gpsCityCorrection';
import { seedProofs, seedVotesLeft } from '@/features/daily/votes';
import type { DailyArchiveItem, DailyCalendar, DailyGuide, DailyProof, DailySheet, DailyToday } from '@/types';

// Daily Challenge data hooks. Same plain useState/useEffect pattern as the rest
// of the app (no query library). Today's data refreshes on screen focus, when
// the app comes back to the foreground, and when the countdown reaches the
// next drop.

/**
 * Seconds until `nextDropAt`, ticking every second. Uses the server clock
 * (serverTime at fetch) so a wrong phone clock never shows a wrong countdown.
 */
export function useCountdown(nextDropAt: number | null | undefined, serverTime: number | null | undefined): number | null {
  const offset = useRef(0);
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!nextDropAt) { setLeft(null); return; }
    offset.current = serverTime ? serverTime - Math.floor(Date.now() / 1000) : 0;
    const tick = () => setLeft(Math.max(0, nextDropAt - (Math.floor(Date.now() / 1000) + offset.current)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [nextDropAt, serverTime]);

  return left;
}

/** The countdown turns to the warning color in the last 3 hours before the drop (SPEC 8.4). */
export const COUNTDOWN_WARNING_SECONDS = 3 * 3600;

export function isFinalHours(seconds: number | null): boolean {
  return seconds !== null && seconds <= COUNTDOWN_WARNING_SECONDS;
}

/** "6h 12m" / "12m" / "45s" - compact, locale-neutral. */
/**
 * A countdown in the app's language: hours and minutes ("20h 43m", FR
 * "20 h 43"), minutes and seconds in the last hour ("42m 07s").
 */
export function formatCountdown(seconds: number | null): string {
  if (seconds === null) return '';
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0
    ? i18n.t('countdown.hm', { ns: 'daily', h, m: pad(m) })
    : i18n.t('countdown.ms', { ns: 'daily', m, s: pad(s % 60) });
}

// Where I am, as Today last said: the sheet and the world tour's "Answer for [city]" use it.
let lastHere: DailyToday['here'] = null;
const hereListeners = new Set<() => void>();
function setLastHere(here: DailyToday['here']) {
  lastHere = here ?? null;
  hereListeners.forEach(l => l());
}
/** My own city (not the browsed one), from Today's last fetch: null when unknown. */
export function useHere(): DailyToday['here'] {
  const [here, setHere] = useState(lastHere);
  useEffect(() => {
    const l = () => setHere(lastHere);
    hereListeners.add(l);
    l();
    return () => { hereListeners.delete(l); };
  }, []);
  return here;
}

// Today's last answer and the sheets already loaded (Today prefetches today's), so the
// challenge sheet opens instantly from the hero: its top from Today, the rest from the
// cache, refreshed in the background.
let lastToday: DailyToday | null = null;
export function getLastToday(): DailyToday | null { return lastToday; }
const sheetCache = new Map<string, DailySheet>();
const sheetKey = (date: string, scope: string, cityId: string | null | undefined) => `${date}|${scope}|${cityId ?? ''}|${i18n.language}`;
export function cachedSheet(date: string, scope: 'world' | 'city', cityId: string | null | undefined): DailySheet | null {
  return sheetCache.get(sheetKey(date, scope, cityId)) ?? null;
}
const prefetchedAt = new Map<string, number>();
/** Load a sheet into the cache (Today, once its challenge is known), at most once a minute. Errors are silent. */
export function prefetchSheet(date: string, scope: 'world' | 'city', cityId: string | null | undefined, guestId: string | null): void {
  const key = sheetKey(date, scope, cityId);
  if (Date.now() - (prefetchedAt.get(key) ?? 0) < 60_000) return;
  prefetchedAt.set(key, Date.now());
  fetchDailySheet(date, { scope, cityId, guestId })
    .then(s => { sheetCache.set(sheetKey(date, scope, cityId), s); })
    .catch(() => {});
}

export function useDailyToday(cityId: string | null | undefined) {
  const { account, detectedCity, identity } = useApp();
  const guestIdRef = useRef<string | null>(null);
  guestIdRef.current = identity?.guestId ?? null;
  const [data, setData]       = useState<DailyToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  // A guest's own city: where the app placed them (GPS, else the IP guess). An account's comes from the server.
  const hereId  = account ? null : detectedCity?.channelId ?? null;
  const hereGps = isGpsCity(hereId);

  const load = useCallback(async () => {
    try {
      const d = await fetchDailyToday(cityId, hereId ? { cityId: hereId, gps: hereGps } : null);
      setData(d);
      lastToday = d;
      setLastHere(d.here);
      // The sheet's photos and the Compare board, so the hero's tap opens them ready.
      if (d.challenge) {
        prefetchSheet(d.challenge.date, 'world', cityId, account ? null : guestIdRef.current);
        const boardKey = `board|${d.challenge.date}`;
        if (d.challenge.compare && Date.now() - (prefetchedAt.get(boardKey) ?? 0) > 60_000) {
          prefetchedAt.set(boardKey, Date.now());
          fetchDailyBoard(d.challenge.date, account ? null : guestIdRef.current).catch(() => {});
        }
      }
      if (d.challenge?.isActive) seedVotesLeft(d.myVotes?.left ?? null);
      setError(false);
    } catch (err) {
      console.warn('[daily] today failed:', String(err));
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [cityId, hereId, hereGps]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') load(); });
    return () => sub.remove();
  }, [load]);
  useEffect(() => onDailyDropped(load), [load]);

  // A new challenge drops when the countdown ends: refetch a few seconds after.
  const left = useCountdown(data?.nextDropAt, data?.serverTime);
  const dropped = left === 0;
  useEffect(() => {
    if (!dropped) return;
    const id = setTimeout(load, 5000);
    return () => clearTimeout(id);
  }, [dropped, load]);

  return { data, loading, error, reload: load, secondsLeft: left };
}

/**
 * The challenge sheet of one date: header + approved proofs (paged) + practical
 * info. `scope` switches World / City; `setMyProof` lets the screen reflect an
 * edit or delete without a refetch.
 */
export function useDailySheet(date: string, scope: 'world' | 'city', cityId: string | null | undefined) {
  const { identity, account } = useApp();
  const guestId = account ? null : identity?.guestId ?? null;
  // Instant: the cached sheet (Today prefetched it), refreshed below.
  const [sheet, setSheet]           = useState<DailySheet | null>(() => cachedSheet(date, scope, cityId));
  const [loading, setLoading]       = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError]           = useState<'not_found' | 'failed' | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await fetchDailySheet(date, { scope, cityId, guestId });
      seedSheet(s);
      sheetCache.set(sheetKey(date, scope, cityId), s);
      setSheet(s);
      setError(null);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      setError(status === 404 ? 'not_found' : 'failed');
    } finally {
      setLoading(false);
    }
  }, [date, scope, cityId, guestId]);

  useEffect(() => {
    const cached = cachedSheet(date, scope, cityId);
    if (cached) { seedSheet(cached); setSheet(cached); }
    setLoading(true);
    load();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const loadMore = useCallback(async () => {
    if (!sheet?.hasMore || loadingMore || sheet.nextBefore === null) return;
    setLoadingMore(true);
    try {
      const next = await fetchDailySheet(date, { scope, cityId, guestId, before: sheet.nextBefore });
      seedProofs(next.proofs, !!next.challenge?.isActive);
      setSheet(prev => prev ? {
        ...prev,
        proofs:     [...prev.proofs, ...next.proofs.filter(p => !prev.proofs.some(q => q.id === p.id))],
        hasMore:    next.hasMore,
        nextBefore: next.nextBefore,
      } : next);
    } catch (err) {
      console.warn('[daily] load more failed:', String(err));
    } finally {
      setLoadingMore(false);
    }
  }, [sheet, loadingMore, date, scope, cityId, guestId]);

  const setMyProof = useCallback((proof: DailyProof | null) => {
    setSheet(prev => prev ? { ...prev, myProof: proof } : prev);
  }, []);

  return { sheet, loading, loadingMore, error, reload: load, loadMore, setMyProof };
}

/** Share a sheet's vote state with every proof card (votes store). */
function seedSheet(s: DailySheet) {
  const open = !!s.challenge?.isActive;
  seedProofs([...s.proofs, s.myProof, ...(s.results?.world ?? []), ...(s.results?.cities ?? []), s.results?.cityBest], open);
  if (open) seedVotesLeft(s.myVotes?.left ?? null);
}

/**
 * Past challenges, newest first, paged by date: a live city's (World for a
 * dead city) or, with want = 'world', every city's; `theme` filters.
 */
export function useDailyArchive(cityId: string | null | undefined, theme: string | null = null, want: 'world' | 'city' = 'city') {
  const { identity, account } = useApp();
  const guestId = account ? null : identity?.guestId ?? null;
  const [items, setItems]     = useState<DailyArchiveItem[]>([]);
  const [scope, setScope]     = useState<'world' | 'city'>('city');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    try {
      const a = await fetchDailyArchive({ scope: want, cityId: want === 'city' ? cityId : null, guestId, theme, limit: 10 });
      setItems(a.items);
      setScope(a.scope);
      setHasMore(a.hasMore);
    } catch (err) {
      console.warn('[daily] archive failed:', String(err));
    } finally {
      setLoading(false);
    }
  }, [cityId, guestId, theme, want]);

  useEffect(() => { setLoading(true); setItems([]); load(); }, [load]);

  const loadMore = useCallback(async () => {
    const last = items[items.length - 1];
    if (!hasMore || loadingMore || !last) return;
    setLoadingMore(true);
    try {
      const a = await fetchDailyArchive({ scope: want, cityId: want === 'city' ? cityId : null, guestId, theme, limit: 10, before: last.challenge.date });
      setItems(prev => [...prev, ...a.items.filter(i => !prev.some(p => p.challenge.id === i.challenge.id))]);
      setHasMore(a.hasMore);
    } catch (err) {
      console.warn('[daily] archive more failed:', String(err));
    } finally {
      setLoadingMore(false);
    }
  }, [items, hasMore, loadingMore, cityId, guestId, theme, want]);

  return { items, scope, hasMore, loading, loadingMore, loadMore, reload: load };
}

/**
 * Days from..to (Y-m-d, at most 62) with my status, and my streak. Refreshed on
 * focus. The response's `today` is the server's challenge date.
 */
export function useDailyCalendar(from: string, to: string) {
  const { account } = useApp();
  const [data, setData]       = useState<DailyCalendar | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setData(await fetchDailyCalendar(from, to));
    } catch (err) {
      console.warn('[daily] calendar failed:', String(err));
    } finally {
      setLoading(false);
    }
  // account: my statuses change when I sign in or out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, account?.id]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  return { data, loading, reload: load };
}

/** City guide (one summary per theme) and my Local Pass progress in that city. */
export function useDailyGuide(cityId: string | null | undefined) {
  const { identity, account } = useApp();
  const guestId = account ? null : identity?.guestId ?? null;
  const [guide, setGuide] = useState<DailyGuide | null>(null);

  const load = useCallback(async () => {
    try {
      setGuide(await fetchDailyGuide(cityId, guestId));
    } catch (err) {
      console.warn('[daily] guide failed:', String(err));
    }
  }, [cityId, guestId]);

  useEffect(() => { setGuide(null); load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  return guide;
}
