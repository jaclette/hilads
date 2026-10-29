import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { fetchDailyTodayCountries } from '@/api/daily';
import { seedProofs } from '@/features/daily/votes';
import { useHere } from '@/hooks/useDaily';
import type { DailyCityGroup, DailyToday, DailyTodayCountries } from '@/types';

let last: DailyTodayCountries | null = null;
/** The last list Today showed: Today's photos follows its story order. */
export function lastCountries(): DailyTodayCountries | null { return last; }

/**
 * Today's photos by city and by country (GET /daily/today/countries), loaded
 * once for the whole tab: the hero's live strip and the compare section read
 * the same list, so they never disagree ("first photos" vs "nobody played").
 * Reloads on focus and on pull-to-refresh ($refreshKey).
 */
export function useTodayCountries(today: DailyToday | null, refreshKey: number): DailyTodayCountries | null {
  const { account, identity } = useApp();
  const here = useHere();
  const [data, setData] = useState<DailyTodayCountries | null>(last);
  const challenge = today?.challenge ?? null;
  const guestId = account ? null : identity?.guestId ?? null;

  const load = useCallback(async () => {
    if (!challenge) return;
    try {
      // My city first: where I am, else the city I'm browsing.
      const next = await fetchDailyTodayCountries({ cityId: here?.id ?? today?.city?.id ?? null, guestId });
      seedProofs([...next.items.map(i => i.top), ...(next.cities ?? []).map(c => c.top)], challenge.isActive);
      last = next;
      setData(next);
    } catch { /* keep what we have */ }
  }, [challenge?.id, challenge?.isActive, here?.id, today?.city?.id, guestId]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { if (refreshKey > 0) load(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return challenge ? data : null;
}

/**
 * Today's cities (one per city that played): the server's `cities` when it
 * sends them, else one per country from an older server (its top photo's city).
 */
export function todayCities(data: DailyTodayCountries | null): DailyCityGroup[] {
  if (!data) return [];
  if (data.cities) return data.cities;
  return data.items.map(i => ({
    city: i.city, count: i.count, authorCount: null, authors: [], totalLikes: null,
    latestAt: i.latestAt, unseen: i.unseen, ids: i.ids, top: i.top,
  }));
}
