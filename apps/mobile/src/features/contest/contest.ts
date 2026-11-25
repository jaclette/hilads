import { api } from '@/api/client';

/** Launch Season (GET /contest): a separate contest layer, never the game's points. */
export type ContestPhase = 'upcoming' | 'season' | 'final' | 'over';

export interface ContestSeason {
  id: number;
  /** The prize, set per season in Admin › Launch Season (in the app's language, else English). */
  prize?: { title: string; subtitle: string; description?: string };
  /** Ranks 2..to of the final week each win a souvenir (Admin › Launch Season), null when off. */
  souvenir?: { from: number; to: number; text: string | null } | null;
  /** Real photos from Admin › Launch Season › Photos (Pixabay picks or our own), in order; empty = the illustration. */
  photos?: { url: string; caption: string; credit: string }[];
  /** "Your week in Vietnam", a sample itinerary (Admin › Launch Season), in the app's language. */
  itinerary?: { day: number; title: string; text: string; photo: { url: string; credit: string } | null }[];
  /** "A word from the founder" (Admin), null until a name and a message are saved. */
  founder?: { name: string; role: string; message: string; photo: { url: string } | null } | null;
  name: string;
  isTest: boolean;
  phase: ContestPhase;
  startDate: string;
  endDate: string;
  finalWeekStart: string;
  /** The daily drops (ISO UTC) the season starts at, the final week starts at, it ends at (older API: absent). */
  startsAt?: string | null;
  finalAt?: string | null;
  endsAt?: string | null;
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
  /** The Upcoming phase's "Notify me": already tapped (an older API: absent). */
  notified?: boolean;
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

/** The Upcoming phase's "Notify me" (no age / country / rules yet): one push when the season starts. */
export function notifyContest(seasonId: number, locale?: string): Promise<ContestOverview & { ok: true }> {
  return api.post('/contest/notify', { seasonId }, { params: locale ? { locale } : undefined });
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
