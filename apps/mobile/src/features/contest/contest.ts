import { api } from '@/api/client';

/** Launch Season (GET /contest): a separate contest layer, never the game's points. */
export type ContestPhase = 'upcoming' | 'season' | 'final' | 'over';

export interface ContestSeason {
  id: number;
  /** The prize, set per season in Admin › Launch Season (in the app's language, else English). */
  prize?: { title: string; subtitle: string };
  name: string;
  isTest: boolean;
  phase: ContestPhase;
  startDate: string;
  endDate: string;
  finalWeekStart: string;
  rules: { voteCap: number; referralPoints: number; referralMinPhotos: number; referralCap: number; headstartTopN: number };
  rulesUrl: string;
}

export type ContestFriendStatus = 'active' | 'pending' | 'before_season' | 'invited_after_join' | 'same_device' | 'disqualified';

export interface ContestMeJoined {
  joined: true;
  disqualified: boolean;
  excluded?: boolean;
  seasonRank?: number | null;
  finalRank?: number | null;
  points?: { votes: number; finalVotes: number; referral: number; headstart: number; season: number; final: number };
  photos?: number;
  days?: number;
  referrals?: { active: number; cap: number; minPhotos: number; friends: { username: string | null; photos: number; status: ContestFriendStatus }[] };
}

export interface ContestMeNotJoined {
  joined: false;
  canJoin: boolean;
  reason: string | null;
  suggestedCountry?: string | null;
}

export interface ContestOverview {
  season: ContestSeason | null;
  counter?: { players: number; threshold: number; photos: number };
  participants?: number;
  me?: ContestMeJoined | ContestMeNotJoined | null;
}

export interface ContestRow {
  rank: number;
  userId: string;
  username: string | null;
  displayName: string | null;
  photoUrl: string | null;
  points: number;
  votes: number;
  referral: number;
  headstart: number;
  days: number;
  photos: number;
}

export interface ContestRanking {
  phase: 'season' | 'final';
  frozen: boolean;
  rows: ContestRow[];
  me: ContestRow | null;
  total: number;
}

export function fetchContest(locale?: string): Promise<ContestOverview> {
  return api.get<ContestOverview>('/contest', { params: { locale } });
}

export function fetchContestRanking(phase: 'season' | 'final'): Promise<ContestRanking> {
  return api.get<ContestRanking>('/contest/ranking', { params: { phase } });
}

export function joinContest(seasonId: number, country: string): Promise<ContestOverview & { result: 'joined' | 'already' }> {
  return api.post('/contest/join', { seasonId, country, ageConfirmed: true, rulesAccepted: true });
}

/** Days left until a season's end date closes (its next drop), at least 0. */
export function daysLeft(endDate: string): number {
  const end = new Date(`${endDate}T23:59:59Z`).getTime();
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
}

/** A challenge date (YYYY-MM-DD) as a short day in the app's language. */
export function contestDate(date: string, locale: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}
