import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * "The Today banner's pill was tapped once" for a campaign: its pulse stops for good.
 */
const TAPPED = 'trip_banner_tapped';   // seasonId
let tapped: number | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());

AsyncStorage.getItem(TAPPED).then(t => {
  tapped = t ? Number(t) : null;
  emit();
}).catch(() => {});

export function markBannerTapped(seasonId: number) {
  if (tapped === seasonId) return;
  tapped = seasonId;
  AsyncStorage.setItem(TAPPED, String(seasonId)).catch(() => {});
  emit();
}

/** { tapped: the banner was tapped once for this campaign (its pill stops pulsing) }. */
export function useTripOpens(seasonId: number | null): { tapped: boolean } {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick(n => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return { tapped: seasonId !== null && tapped === seasonId };
}
