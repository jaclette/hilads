import type { DailyCountryGroup, DailyProof } from '@/types';

/**
 * A country's photos, best first: the most liked, then the most recent
 * (approval, else posting time). The server picks each country's top photo
 * by the same rule (DailyProofRepository::groupByCountry): Today's mosaic
 * tile shows that top photo.
 */
export function compareCountryProofs(a: DailyProof, b: DailyProof): number {
  return (b.voteCount - a.voteCount) || ((b.approvedAt ?? b.createdAt ?? 0) - (a.approvedAt ?? a.createdAt ?? 0));
}

/**
 * A country's photos in that order, its top photo (the mosaic tile's) always
 * first, so "See all" and the mosaic never disagree even when likes moved
 * between the two loads.
 */
export function rankCountryProofs(list: DailyProof[], topId: string): DailyProof[] {
  const top = list.find(p => p.id === topId);
  const rest = list.filter(p => p.id !== topId).sort(compareCountryProofs);
  return top ? [top, ...rest] : rest;
}

/**
 * Countries, best first, the same everywhere they're compared (Today's
 * mosaic, the challenge's bubbles, "See all"): my country first, then the
 * top photo's likes, then the number of photos, then the most recent.
 * (Today's stories row keeps its own order: unseen first.)
 */
export function compareCountryGroups(a: DailyCountryGroup, b: DailyCountryGroup, myCountry: string | null): number {
  const mine = (myCountry ?? '').toUpperCase();
  return Number(b.country === mine) - Number(a.country === mine)
    || (b.top.voteCount - a.top.voteCount) || (b.count - a.count) || (b.latestAt - a.latestAt);
}
