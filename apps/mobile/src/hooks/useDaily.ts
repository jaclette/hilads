import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { fetchDailyArchive, fetchDailySheet, fetchDailyToday } from '@/api/daily';
import { useApp } from '@/context/AppContext';
import { onDailyDropped } from '@/lib/dailyEvents';
import { seedProofs, seedVotesLeft } from '@/features/daily/votes';
import type { DailyArchiveItem, DailyProof, DailySheet, DailyToday } from '@/types';

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

/** "6h 12m" / "12m" / "45s" - compact, locale-neutral. */
export function formatCountdown(seconds: number | null): string {
  if (seconds === null) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

export function useDailyToday(cityId: string | null | undefined) {
  const [data, setData]       = useState<DailyToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await fetchDailyToday(cityId);
      setData(d);
      if (d.challenge?.isActive) seedVotesLeft(d.myVotes?.left ?? null);
      setError(false);
    } catch (err) {
      console.warn('[daily] today failed:', String(err));
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [cityId]);

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
  const [sheet, setSheet]           = useState<DailySheet | null>(null);
  const [loading, setLoading]       = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError]           = useState<'not_found' | 'failed' | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await fetchDailySheet(date, { scope, cityId, guestId });
      seedSheet(s);
      setSheet(s);
      setError(null);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      setError(status === 404 ? 'not_found' : 'failed');
    } finally {
      setLoading(false);
    }
  }, [date, scope, cityId, guestId]);

  useEffect(() => { setLoading(true); load(); }, [load]);
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

/** "Already done" archive of a city (World selection for a dead city), paged by date. */
export function useDailyArchive(cityId: string | null | undefined) {
  const { identity, account } = useApp();
  const guestId = account ? null : identity?.guestId ?? null;
  const [items, setItems]     = useState<DailyArchiveItem[]>([]);
  const [scope, setScope]     = useState<'world' | 'city'>('city');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    try {
      const a = await fetchDailyArchive({ cityId, guestId, limit: 10 });
      setItems(a.items);
      setScope(a.scope);
      setHasMore(a.hasMore);
    } catch (err) {
      console.warn('[daily] archive failed:', String(err));
    } finally {
      setLoading(false);
    }
  }, [cityId, guestId]);

  useEffect(() => { setLoading(true); setItems([]); load(); }, [load]);

  const loadMore = useCallback(async () => {
    const last = items[items.length - 1];
    if (!hasMore || loadingMore || !last) return;
    setLoadingMore(true);
    try {
      const a = await fetchDailyArchive({ cityId, guestId, limit: 10, before: last.challenge.date });
      setItems(prev => [...prev, ...a.items.filter(i => !prev.some(p => p.challenge.id === i.challenge.id))]);
      setHasMore(a.hasMore);
    } catch (err) {
      console.warn('[daily] archive more failed:', String(err));
    } finally {
      setLoadingMore(false);
    }
  }, [items, hasMore, loadingMore, cityId, guestId]);

  return { items, scope, hasMore, loading, loadingMore, loadMore, reload: load };
}
