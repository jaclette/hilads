import { api } from '@/api/client';

/**
 * The campaign (GET /contest, "Launch Season" in the back office): a separate layer that reads the
 * regular Hilads points (play, podium, friends; not the perfect week) on its challenges, never writes them.
 * Phases: upcoming (teaser) · season (before the final week) · final · over (results being checked)
 * · ended (the winner, shown a few days, then the tab goes).
 */
export type ContestPhase = 'upcoming' | 'season' | 'final' | 'over' | 'ended';

/** The regular points the campaign counts (config/scoring.php), for the Rules section. */
export interface ContestPoints { play: number; podium: [number, number, number]; week: number; friend: number; crew: number; crewSize: number; friendsPerMonth: number }

/** Points by kind: play, podium, friends (+ crew bonus); week is always 0 (the perfect week isn't counted). */
export interface ContestBy { play: number; podium: number; week: number; friends: number }

export interface ContestSeason {
  id: number;
  /** The prize, set per season in Admin › Launch Season (in the app's language, else English). */
  prize?: { title: string; subtitle: string; description?: string };
  /** What the #1 wins if the players' goal isn't reached (Admin; a placeholder until set). */
  fallbackPrize?: string;
  /** The campaign's tab: its label and Ionicons name (Admin; default "Trip" + airplane). */
  tab?: { label: string; icon: string; prizeCta?: string; destination?: string;
          /** The Today banner: full for the first N visits and for H hours at key moments (Admin). */
          banner?: { fullVisits: number; momentHours: number } };
  points?: ContestPoints;
  /** The confirmed winner (Admin › Winner & export), else null. */
  winner?: { userId: string; username: string | null; displayName: string | null; photoUrl: string | null } | null;
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
  /** The current challenge date (the timeline's "day 2 of 2"; older API: absent). */
  today?: string;
  /** The daily drops (ISO UTC) the season starts at, the final week starts at, it ends at (older API: absent). */
  startsAt?: string | null;
  finalAt?: string | null;
  endsAt?: string | null;
  rules: { headstartTopN: number; voteCap: number; referralPoints: number; referralMinPhotos: number; referralCap: number };
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
  /** My place in the current race (before the final week, or the final week's). */
  /** My seat on the boarding pass (my place in the order players joined). */
  seat?: number | null;
  race?: { part: 'season' | 'final'; rank: number | null; prevRank: number | null; points: number; by: ContestBy; headstart: number;
           likes: number; gap: number | null; ranked: number };
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
  /** The players' goal, told as boarding a flight: seats taken / seats; showFrom = below it the app says "Be among the first to board" (never "0"). */
  counter?: { players: number; threshold: number; photos: number; reached?: boolean; showFrom?: number;
              /** The players' goal (the trip unlocks at it), null = no goal: the prize is unconditional (older API: absent = threshold). */
              goal?: number | null;
              /** The next free seat on the boarding pass (players in the race + 1). */
              seatNext?: number;
              /** The latest players on board (stacked avatars). */
              recent?: { userId: string; name: string | null; photoUrl: string | null }[] };
  participants?: number;
  me?: ContestMeJoined | ContestMeNotJoined | null;
}

export interface ContestRow {
  rank: number;
  /** The rank before today's challenge (null: not ranked then), for the movement arrows. */
  prevRank?: number | null;
  likes?: number;
  by?: ContestBy;
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
export function notifyContest(seasonId: number, locale?: string, guestId?: string | null): Promise<ContestOverview & { ok: true }> {
  return api.post('/contest/notify', guestId ? { seasonId, guestId } : { seasonId }, { params: locale ? { locale } : undefined });
}

/** The players' goal: a number, or null when the prize is unconditional (an older API sends only threshold). */
export function contestGoal(counter: ContestOverview['counter'] | null | undefined): number | null {
  if (!counter) return null;
  if (counter.goal !== undefined) return counter.goal;
  return counter.threshold > 0 ? counter.threshold : null;
}

/** Day n of a phase (1-based) and its length, from the server's challenge date. */
export function phaseDay(today: string | undefined, from: string, to: string): { day: number; days: number } | null {
  if (!today) return null;
  const n = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
  const days = n(from, to) + 1;
  const day = n(from, today) + 1;
  return day >= 1 && day <= days ? { day, days } : null;
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
