import { router } from 'expo-router';
import { handOffList } from '@/lib/prefetch';
import type { DailyChallenge, DailyProof } from '@/types';

/**
 * Open the photo feed (/daily/photos) on a list of photos, in its order, on `startId` (else the
 * first; the ones before it stay a scroll up), then "Your turn". The one viewer for any set of
 * photos that isn't today's by city (that's the stories viewer): a ranking, yesterday's best, a
 * chat group card, a day's or a profile's photos, a single photo from a link.
 * `challenge`: the photos' challenge when it isn't today's (their Share). `share`: open the share
 * sheet on the start photo at once (yesterday's podium, "Share"). `comment`: open the start photo's
 * comments on that comment (a comment notification).
 */
export function openPhotoFeed(proofs: DailyProof[], startId: string | null, source: string,
  opts: { challenge?: DailyChallenge | null; share?: boolean; comment?: number | null } = {}): void {
  if (proofs.length === 0) return;
  const key = `${source}-${Date.now()}`;
  handOffList(key, proofs, opts.challenge ?? null);
  const extra = `${opts.share ? '&share=1' : ''}${opts.comment !== undefined ? `&comment=${opts.comment ?? ''}` : ''}`;
  router.push(`/daily/photos?list=${key}&proof=${startId ?? proofs[0].id}&source=${source}${extra}` as never);
}
