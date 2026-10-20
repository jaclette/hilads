import i18n from '@/i18n';
import { api, ApiError } from './client';
import type {
  DailyBoard, DailyCompared, DailyRates, DailyTour,
  NearbyPlace,
  DailyArchive,
  DailyCalendar,
  DailyGuide,
  DailyLeaderboard,
  DailyPlacePin,
  DailyProposal,
  DailyProof,
  DailyProofInput,
  DailySheet,
  DailyTodayProofs,
  DailyPodium,
  DailyToday,
  DailyTwistProposal,
  DailyTwistProposalScreen,
  DailyUserStats,
  DailyVoteState,
} from '@/types';

// Daily Challenge API (docs/daily-challenge/API.md). City ids are the integer
// form the API uses (City.channelId is that integer as a string). Reads send
// the UI language (`locale`): the API returns the founder's translations of
// challenges and twists in it, with the English original alongside.

function locale(): string {
  return i18n.language || 'en';
}

function cityParam(cityId?: string | number | null): number | undefined {
  const n = Number(cityId);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** `here`: a guest's own city (an account's comes from the server), from GPS or an IP guess. */
export async function fetchDailyToday(cityId?: string | number | null,
                                      here?: { cityId: string | number | null; gps: boolean } | null): Promise<DailyToday> {
  return api.get<DailyToday>('/daily/today', { params: {
    cityId: cityParam(cityId), locale: locale(),
    hereId: here ? cityParam(here.cityId) : undefined, hereSource: here ? (here.gps ? 'gps' : 'ip') : undefined,
  } });
}

/** How the world answered: one row per city (SPEC 10.6). Public. */
export async function fetchDailyBoard(date: string, guestId?: string | null): Promise<DailyBoard> {
  return api.get<DailyBoard>(`/daily/challenges/${date}/compare`, { params: { locale: locale(), guestId: guestId ?? undefined } });
}

/** Yesterday around the world (SPEC 10.7): one slide per city of yesterday's challenge. Public. */
export async function fetchDailyTour(opts: { cityId?: string | number | null; guestId?: string | null; date?: string } = {}): Promise<DailyTour> {
  return api.get<DailyTour>('/daily/tour', {
    params: { cityId: cityParam(opts.cityId), guestId: opts.guestId ?? undefined, date: opts.date, locale: locale() },
  });
}

/** The world, compared (SPEC 10.9): comparisons by shared key, last week (Today's carousel) or all time (the Index screen). */
export async function fetchCompared(scope: 'week' | 'all'): Promise<DailyCompared> {
  return api.get<DailyCompared>('/daily/compared', { params: { scope, locale: locale() } });
}

/** The day's reference exchange rates, EUR base (SPEC 10.5). */
export async function fetchDailyRates(): Promise<DailyRates> {
  return api.get<DailyRates>('/daily/rates');
}

/** "Remind me later" (Today's how-it-works sheet): today's evening reminder for me, within the push cap. */
export async function remindMeLater(): Promise<{ queued: boolean }> {
  return api.post<{ queued: boolean }>('/daily/remind-me', {});
}

/** Yesterday's podium: the scope's top 3 proofs of yesterday, total and countries. A city with none falls back to World. */
export async function fetchDailyPodium(
  opts: { scope?: 'world' | 'city'; cityId?: string | number | null; guestId?: string | null } = {},
): Promise<DailyPodium> {
  return api.get<DailyPodium>('/daily/podium', {
    params: { scope: opts.scope ?? 'world', cityId: cityParam(opts.cityId), guestId: opts.guestId ?? undefined, locale: locale() },
  });
}

/** Today's proof strip: the scope's proofs (most voted, then newest), total and countries. A city with none falls back to World. */
export async function fetchDailyTodayProofs(
  opts: { scope?: 'world' | 'city' | 'cities'; cityId?: string | number | null; limit?: number; guestId?: string | null } = {},
): Promise<DailyTodayProofs> {
  return api.get<DailyTodayProofs>('/daily/today/proofs', {
    params: {
      scope:   opts.scope ?? 'world',
      cityId:  cityParam(opts.cityId),
      limit:   opts.limit ?? 12,
      guestId: opts.guestId ?? undefined,
      locale:  locale(),
    },
  });
}

export async function fetchDailySheet(
  date: string,
  opts: { scope?: 'world' | 'city'; cityId?: string | number | null; before?: number | null; limit?: number; guestId?: string | null } = {},
): Promise<DailySheet> {
  return api.get<DailySheet>(`/daily/challenges/${date}`, {
    params: {
      scope:   opts.scope ?? 'world',
      cityId:  cityParam(opts.cityId),
      before:  opts.before ?? undefined,
      limit:   opts.limit ?? 20,
      guestId: opts.guestId ?? undefined,
      locale:  locale(),
    },
  });
}

export async function fetchDailyArchive(
  opts: { scope?: 'world' | 'city'; cityId?: string | number | null; before?: string | null; limit?: number; guestId?: string | null; theme?: string | null } = {},
): Promise<DailyArchive> {
  return api.get<DailyArchive>('/daily/archive', {
    params: {
      scope:   opts.scope ?? undefined,
      cityId:  cityParam(opts.cityId),
      theme:   opts.theme ?? undefined,
      before:  opts.before ?? undefined,
      limit:   opts.limit ?? 20,
      guestId: opts.guestId ?? undefined,
      locale:  locale(),
    },
  });
}

/** Week strip / month calendar: days from..to (at most 62) with my status, and my streak. */
export async function fetchDailyCalendar(from: string, to: string): Promise<DailyCalendar> {
  return api.get<DailyCalendar>('/daily/calendar', { params: { from, to } });
}

/** City guide: one summary per weekly theme, plus my Local Pass progress in that city. */
export async function fetchDailyGuide(cityId?: string | number | null, guestId?: string | null): Promise<DailyGuide> {
  return api.get<DailyGuide>('/daily/guide', { params: { cityId: cityParam(cityId), guestId: guestId ?? undefined } });
}

/** "Already done" map: pinned places of past challenges for a city (World selection for a dead city). */
export async function fetchDailyPlaces(
  opts: { cityId?: string | number | null; limit?: number; guestId?: string | null } = {},
): Promise<{ scope: 'world' | 'city'; items: DailyPlacePin[] }> {
  return api.get('/daily/places', {
    params: { cityId: cityParam(opts.cityId), limit: opts.limit ?? 200, guestId: opts.guestId ?? undefined, locale: locale() },
  });
}

export async function fetchDailyProof(id: string): Promise<DailyProof> {
  return (await api.get<{ proof: DailyProof }>(`/daily/proofs/${id}`, { params: { locale: locale() } })).proof;
}

/** cityFirstToday: no other proof from its city today yet ("You put Saigon on the world map today."). */
export async function createDailyProof(input: DailyProofInput): Promise<{ proof: DailyProof; cityFirstToday: boolean }> {
  const r = await api.post<{ proof: DailyProof; cityFirstToday?: boolean }>('/daily/proofs', input);
  return { proof: r.proof, cityFirstToday: !!r.cityFirstToday };
}

/** Hilads places within 100 m of the device, nearest first (the proof's place step). */
export async function fetchNearbyPlaces(lat: number, lng: number): Promise<NearbyPlace[]> {
  return (await api.get<{ items: NearbyPlace[] }>('/daily/places/nearby', { params: { lat: lat.toFixed(6), lng: lng.toFixed(6) } })).items;
}

export async function updateDailyProof(id: string, input: DailyProofInput): Promise<DailyProof> {
  return (await api.patch<{ proof: DailyProof }>(`/daily/proofs/${id}`, input)).proof;
}

export async function deleteDailyProof(id: string): Promise<void> {
  await api.delete(`/daily/proofs/${id}`);
}

/**
 * The device's IANA timezone, sent at each launch (Daily pushes at local time),
 * with the Android channel this build created for Daily pushes (signature sound).
 */
export async function sendDeviceTimezone(timezone: string, guestId?: string | null, pushToken?: string | null,
                                         dailyChannel?: string | null): Promise<void> {
  await api.post('/daily/device', {
    timezone, guestId: guestId ?? undefined, pushToken: pushToken ?? undefined, dailyChannel: dailyChannel ?? undefined,
  });
}

/** The API's machine error code ("already_posted", "moderation_blocked"…), if any. */
export function dailyErrorCode(err: unknown): string | null {
  return err instanceof ApiError && typeof err.body?.code === 'string' ? err.body.code : null;
}

export type DailyReportReason = 'inappropriate' | 'person_without_consent' | 'dangerous' | 'spam' | 'other';

/** Report a visible proof (guests pass their guestId). 409 = already reported. */
export async function reportDailyProof(proofId: string, reasonCode: DailyReportReason, guestId?: string | null): Promise<void> {
  await api.post(`/daily/proofs/${proofId}/report`, { reasonCode, guestId: guestId ?? undefined });
}

export interface DailyVoteResult {
  voted:            boolean;
  votesLeft:        number;
  voteCount:        number;
  validatedByLocal: boolean;
}

/** Vote for a proof (3 per challenge). Voting twice is a no-op. */
export async function voteDailyProof(proofId: string): Promise<DailyVoteResult> {
  return api.post<DailyVoteResult>(`/daily/proofs/${proofId}/vote`, {});
}

/** Withdraw my vote (gives it back) while the challenge is open. */
export async function unvoteDailyProof(proofId: string): Promise<DailyVoteResult> {
  return api.delete<DailyVoteResult>(`/daily/proofs/${proofId}/vote`);
}

/** Up to 50 approved proofs in the order given (a group card's gallery). */
export async function fetchDailyProofsByIds(ids: string[], guestId?: string | null): Promise<DailyProof[]> {
  return (await api.get<{ items: DailyProof[] }>('/daily/proofs', {
    params: { ids: ids.join(','), guestId: guestId ?? undefined, locale: locale() },
  })).items;
}

/** Live vote state of up to 50 proofs (channel cards), plus my votes left today. */
export async function fetchDailyProofStates(ids: string[], guestId?: string | null): Promise<{
  items: Record<string, DailyVoteState>; myVotes: { used: number; left: number } | null;
}> {
  return api.get('/daily/proofs/state', { params: { ids: ids.join(','), guestId: guestId ?? undefined } });
}

/**
 * Provisional leaderboard of the active challenge. Pass the last ETag: the
 * result is null when nothing changed (304).
 */
export async function fetchDailyLeaderboard(etag: string | null, guestId?: string | null): Promise<{ data: DailyLeaderboard; etag: string | null } | null> {
  try {
    return await api.getWithEtag<DailyLeaderboard>('/daily/leaderboard', etag, { params: { guestId: guestId ?? undefined } });
  } catch (err) {
    if (err instanceof ApiError && err.status === 304) return null;
    throw err;
  }
}

/** Propose a Daily Challenge (signed in; one pending at a time). */
export async function proposeChallenge(input: { text: string; theme: string; why?: string; twistText?: string }): Promise<DailyProposal> {
  return (await api.post<{ proposal: DailyProposal }>('/daily/proposals', input)).proposal;
}

/** My challenge and Local Twist proposals, newest first. */
export async function fetchMyProposals(): Promise<{ items: DailyProposal[]; maxPending: number }> {
  return api.get('/daily/proposals/mine', { params: { locale: locale() } });
}

/** Withdraw my pending challenge proposal. */
export async function withdrawProposal(id: string): Promise<void> {
  await api.delete(`/daily/proposals/${id}`);
}

/** Daily Challenge profile stats (signed-in viewers only). */
export async function fetchUserDaily(userId: string): Promise<DailyUserStats> {
  return api.get<DailyUserStats>(`/users/${userId}/daily`, { params: { locale: locale() } });
}

/** Tomorrow's Local Twist proposal screen (signed in). */
export async function fetchTwistProposal(): Promise<DailyTwistProposalScreen> {
  return api.get<DailyTwistProposalScreen>('/daily/twist-proposal', { params: { locale: locale() } });
}

/** Propose tomorrow's Local Twist for my city (locals of a live city, one per day). */
export async function proposeTwist(text: string): Promise<DailyTwistProposal> {
  return (await api.post<{ proposal: DailyTwistProposal }>('/daily/twist-proposal', { text })).proposal;
}

/** Edit my proposal while open and not picked. */
export async function editTwistProposal(text: string): Promise<DailyTwistProposal> {
  return (await api.patch<{ proposal: DailyTwistProposal }>('/daily/twist-proposal', { text })).proposal;
}

/** Withdraw my proposal while open and not picked. */
export async function withdrawTwistProposal(): Promise<void> {
  await api.delete('/daily/twist-proposal');
}
