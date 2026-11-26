import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * How many times I opened the Trip tab, per campaign. The Today banner stays near the top until
 * the 3rd open, then moves below the feed (it never goes away while the campaign runs).
 * Also "the banner's CTA was tapped once" (its pulse stops for good).
 */
const OPENS = 'trip_opens';            // `${seasonId}:${count}`
const TAPPED = 'trip_banner_tapped';   // seasonId
let opens: { id: number; n: number } | null = null;
let tapped: number | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());

AsyncStorage.multiGet([OPENS, TAPPED]).then(([[, o], [, t]]) => {
  const m = /^(\d+):(\d+)$/.exec(o ?? '');
  opens = m ? { id: Number(m[1]), n: Number(m[2]) } : null;
  tapped = t ? Number(t) : null;
  emit();
}).catch(() => {});

export function countTripOpen(seasonId: number) {
  const n = (opens?.id === seasonId ? opens.n : 0) + 1;
  opens = { id: seasonId, n };
  AsyncStorage.setItem(OPENS, `${seasonId}:${n}`).catch(() => {});
  emit();
}

export function markBannerTapped(seasonId: number) {
  if (tapped === seasonId) return;
  tapped = seasonId;
  AsyncStorage.setItem(TAPPED, String(seasonId)).catch(() => {});
  emit();
}

/** { opens: Trip tab opens for this campaign, tapped: the banner was tapped }. */
export function useTripOpens(seasonId: number | null): { opens: number; tapped: boolean } {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick(n => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return { opens: seasonId !== null && opens?.id === seasonId ? opens.n : 0, tapped: seasonId !== null && tapped === seasonId };
}
