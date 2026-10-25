import type { DailyCountryGroup, DailyProof } from '@/types';

/**
 * Photos, best first - the one rule everywhere a photo is ranked: the most
 * liked, then the earliest posted (the first to post keeps the spot until
 * someone gets more likes), then the id. The server ranks by the same rule
 * (DailyResults::rankProofs): each country's top photo (Today's mosaic tile),
 * the podium, the tour.
 */
export function compareCountryProofs(a: DailyProof, b: DailyProof): number {
  return (b.voteCount - a.voteCount)
    || ((a.createdAt ?? a.approvedAt ?? 0) - (b.createdAt ?? b.approvedAt ?? 0))
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
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
