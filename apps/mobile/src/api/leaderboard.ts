import { api } from './client';
import type {
  LeaderboardResponse,
  LeaderboardScope,
  LeaderboardPeriod,
} from '@/types';

/**
 * Fetch the leaderboard for a given scope/period.
 *
 * Returns null on network error so the caller (chip / screen) can render a
 * neutral state without throwing. The chip uses this to silently fall back
 * to "🏆 Top challengers"; the screen surfaces its own retry path.
 */
export async function fetchLeaderboard(opts: {
  scope:   LeaderboardScope;
  period:  LeaderboardPeriod;
  limit?:  number;
  offset?: number;
  cityId?: string;
}): Promise<LeaderboardResponse | null> {
  const params: Record<string, string | number> = {
    scope:  opts.scope,
    period: opts.period,
    limit:  opts.limit  ?? 50,
    offset: opts.offset ?? 0,
  };
  if (opts.cityId) params.city_id = opts.cityId;

  try {
    return await api.get<LeaderboardResponse>('/leaderboard', { params });
  } catch (err) {
    console.warn('[fetchLeaderboard] failed:', err);
    return null;
  }
}
