import { api } from './client';
import type { Spot } from './spots';

/** GET /me/spots: the spots where I have an approved proof (V3-10). */
export async function fetchMySpots(): Promise<Spot[]> {
  return (await api.get<{ items: Spot[] }>('/me/spots')).items;
}

/** My weekly Most Local rank (GET /leaderboard/week, V3-04); null without points this week. */
export async function fetchWeeklyRank(cityId: string | null): Promise<{ rank: number | null; points: number }> {
  const res = await api.get<{ me: { rank: number | null; points: number } }>('/leaderboard/week', {
    params: cityId ? { scope: 'city', cityId: cityId.replace(/^city_/, ''), limit: 1 } : { scope: 'world', limit: 1 },
  });
  return res.me;
}
