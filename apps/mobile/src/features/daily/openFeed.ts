import { router } from 'expo-router';
import { handOffList } from '@/lib/prefetch';
import type { DailyProof } from '@/types';

/**
 * Open the photo feed (/daily/photos) on a given list of photos, played in its order from
 * `startId` (else the first), then "Your turn". The one viewer for any set of photos that isn't
 * today's by city (that's the stories viewer): a ranking, yesterday's best, a chat group card.
 */
export function openPhotoFeed(proofs: DailyProof[], startId: string | null, source: string): void {
  if (proofs.length === 0) return;
  const key = `${source}-${Date.now()}`;
  handOffList(key, proofs);
  router.push(`/daily/photos?list=${key}&proof=${startId ?? proofs[0].id}&source=${source}` as never);
}
