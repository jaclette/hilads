import i18n from '@/i18n';
import { api, ApiError } from './client';
import type {
  DailyArchive,
  DailyLeaderboard,
  DailyPlacePin,
  DailyProof,
  DailyProofInput,
  DailySheet,
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

export async function fetchDailyToday(cityId?: string | number | null): Promise<DailyToday> {
  return api.get<DailyToday>('/daily/today', { params: { cityId: cityParam(cityId), locale: locale() } });
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
  opts: { cityId?: string | number | null; before?: string | null; limit?: number; guestId?: string | null } = {},
): Promise<DailyArchive> {
  return api.get<DailyArchive>('/daily/archive', {
    params: {
      cityId:  cityParam(opts.cityId),
      before:  opts.before ?? undefined,
      limit:   opts.limit ?? 20,
      guestId: opts.guestId ?? undefined,
      locale:  locale(),
    },
  });
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

export async function createDailyProof(input: DailyProofInput): Promise<DailyProof> {
  return (await api.post<{ proof: DailyProof }>('/daily/proofs', input)).proof;
}

export async function updateDailyProof(id: string, input: DailyProofInput): Promise<DailyProof> {
  return (await api.patch<{ proof: DailyProof }>(`/daily/proofs/${id}`, input)).proof;
}

export async function deleteDailyProof(id: string): Promise<void> {
  await api.delete(`/daily/proofs/${id}`);
}

/** The device's IANA timezone, sent at each launch (Daily pushes at local time). */
export async function sendDeviceTimezone(timezone: string, guestId?: string | null, pushToken?: string | null): Promise<void> {
  await api.post('/daily/device', { timezone, guestId: guestId ?? undefined, pushToken: pushToken ?? undefined });
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
