import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { fetchDailyPoints, type DailyPoints, type Season } from '@/api/daily';

/**
 * The scoring rules (scoring v2, GET /daily/points): never hardcoded, the server's config.
 * Until they arrive, the values the server ships with. Cached for the app's life.
 */
export const SEED_POINTS: DailyPoints = {
  proof: 10, vote: 0, top: [30, 20, 10], minVotesToWin: 1,
  v2: true, perfectWeek: 30, friendJoined: 10, crewBonus: 50, invitesPerSeason: 5, crewSize: 5,
};
let cached: DailyPoints | null = null;

export function useScoringPoints(): DailyPoints {
  const [pts, setPts] = useState<DailyPoints>(cached ?? SEED_POINTS);
  useEffect(() => {
    let alive = true;
    fetchDailyPoints().then(p => {
      if (!p || typeof p.proof !== 'number' || !Array.isArray(p.top)) return;
      cached = { ...SEED_POINTS, ...p };
      if (alive) setPts(cached);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return pts;
}

/** When a season ends, in the user's own time: "Mon, Dec 1, 9:00 AM". */
export function seasonEnd(season: Pick<Season, 'endsAt'>, lang: string): string {
  const d = new Date(season.endsAt);
  try {
    return d.toLocaleString(lang, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  } catch {
    return d.toLocaleString();
  }
}

/** A season's name: "November 2026" in the user's language. */
export function seasonName(key: string, lang: string): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, (m || 1) - 1, 15));
  try {
    return d.toLocaleDateString(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return key;
  }
}

/** The first season's start (the day after the pre-season month): "Dec 1". */
export function seasonStart(season: Pick<Season, 'endsAt'>, lang: string): string {
  const d = new Date(season.endsAt);
  try {
    return d.toLocaleDateString(lang, { day: 'numeric', month: 'short' });
  } catch {
    return d.toDateString();
  }
}

/** A finished season's result for me, not celebrated yet (GET /me/season-result). */
export type SeasonResult = {
  season: string; rank: number; points: number; podiums: number; days: number; players: number; medal: boolean;
  podium: { rank: number; points: number; user: { id: string; displayName: string | null; username: string | null; photoUrl: string | null } }[];
};
export async function fetchSeasonResult(): Promise<SeasonResult | null> {
  try { return (await api.get<{ result: SeasonResult | null }>('/me/season-result')).result ?? null; } catch { return null; }
}
export function markSeasonSeen(season: string): void {
  api.post('/me/season-result/seen', { season }).catch(() => {});
}
