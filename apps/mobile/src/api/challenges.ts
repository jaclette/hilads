import { api, ApiError } from './client';
import type {
  Challenge,
  ChallengeType,
  ChallengeAudience,
  ChallengeAcceptance,
  ChallengeThreadSummary,
  AcceptFailureCode,
  Message,
  UserDTO,
} from '@/types';

// ── Reads ─────────────────────────────────────────────────────────────────────

/** Active (status='open') challenges for a city. NOW feed reads the top 5. */
export async function fetchCityChallenges(
  channelId: string,
  limit = 50,
): Promise<Challenge[]> {
  try {
    const data = await api.get<{ challenges: Challenge[] }>(
      `/channels/${channelId}/challenges`,
      { params: { limit } },
    );
    return data.challenges ?? [];
  } catch (err) {
    console.warn('[fetchCityChallenges] failed:', err);
    return [];
  }
}

/** Validated (archived) challenges — feeds the "See past challenges" CTA. */
export async function fetchValidatedChallenges(
  channelId: string,
  opts: { limit?: number; before?: number } = {},
): Promise<Challenge[]> {
  try {
    const params: Record<string, number> = {};
    if (opts.limit)  params.limit  = opts.limit;
    if (opts.before) params.before = opts.before;
    const data = await api.get<{ challenges: Challenge[] }>(
      `/channels/${channelId}/challenges/validated`,
      { params },
    );
    return data.challenges ?? [];
  } catch (err) {
    console.warn('[fetchValidatedChallenges] failed:', err);
    return [];
  }
}

export async function fetchChallengeById(challengeId: string): Promise<{
  challenge: Challenge;
  channelId: number;
  cityName: string | null;
  country: string | null;
  timezone: string;
}> {
  return api.get<{
    challenge: Challenge;
    channelId: number;
    cityName: string | null;
    country: string | null;
    timezone: string;
  }>(`/challenges/${challengeId}`);
}

// A challenge as listed on a profile — Challenge DTO plus whether the profile
// user owns it (created it) vs merely accepted it.
export type ProfileChallenge = Challenge & { is_owner?: boolean };

/** Challenges a user created or accepted — for the profile "Challenges" tab. */
export async function fetchUserChallenges(userId: string): Promise<ProfileChallenge[]> {
  try {
    const data = await api.get<{ challenges?: ProfileChallenge[] }>(`/users/${userId}/challenges`);
    return data.challenges ?? [];
  } catch {
    return [];
  }
}

// ── Writes ────────────────────────────────────────────────────────────────────

export async function createChallenge(
  channelId: string,
  guestId: string,
  nickname: string | null,
  title: string,
  challengeType: ChallengeType,
  audience: ChallengeAudience,
  maxParticipants: number,
  returnClause: string | null,
): Promise<Challenge> {
  return api.post<Challenge>(`/channels/${channelId}/challenges`, {
    guestId,
    nickname,
    title,
    challengeType,
    audience,
    maxParticipants,
    returnClause,
  });
}

/** Owner-only edit of a challenge's title / type / audience / cap / return clause. Status is not editable here — use validateChallenge(). */
export async function updateChallenge(
  challengeId: string,
  guestId: string,
  title: string,
  challengeType: ChallengeType,
  audience: ChallengeAudience,
  maxParticipants: number,
  returnClause: string | null,
): Promise<Challenge> {
  return api.put<Challenge>(`/challenges/${challengeId}`, {
    guestId,
    title,
    challengeType,
    audience,
    maxParticipants,
    returnClause,
  });
}

/** Owner-only soft-delete. */
export async function deleteChallenge(challengeId: string, guestId: string): Promise<void> {
  await api.delete(`/challenges/${challengeId}`, { guestId });
}

/** Owner-only: flip status open → validated. Idempotent. Server fans out a
 *  push notification to every other participant. */
export async function validateChallenge(challengeId: string, guestId: string): Promise<Challenge> {
  return api.post<Challenge>(`/challenges/${challengeId}/validate`, { guestId });
}

/** Owner-only: flip status validated → open. Silent undo (no notifications). */
export async function unvalidateChallenge(challengeId: string, guestId: string): Promise<Challenge> {
  return api.post<Challenge>(`/challenges/${challengeId}/unvalidate`, { guestId });
}

/** Accept / leave a challenge. Returns the new count + whether the caller is in.
 *  LEGACY (PR1 pooled-acceptance model). Kept for backward-compat with the
 *  live mobile build until the next app release. New code uses acceptChallenge(). */
export async function toggleChallengeParticipation(
  challengeId: string,
  guestId: string,
  nickname?: string | null,
): Promise<{ count: number; isIn: boolean }> {
  return api.post<{ count: number; isIn: boolean }>(
    `/challenges/${challengeId}/participants/toggle`,
    { guestId, nickname },
  );
}

// ── PR2: per-acceptance thread model ─────────────────────────────────────────

/** A 403 from /accept carries a `code` + (sometimes) `required_mode`. */
export class AcceptChallengeError extends Error {
  constructor(
    public readonly code: AcceptFailureCode | 'unknown',
    message: string,
    public readonly requiredMode?: 'local' | 'exploring',
  ) {
    super(message);
    this.name = 'AcceptChallengeError';
  }
}

/**
 * Take on a challenge — creates a thread channel + acceptance row.
 * Idempotent: re-accepting returns the existing acceptance.
 *
 * Throws AcceptChallengeError on 403 with a typed `code` (not_creator /
 * mode_required / mode_mismatch / cap_reached) so the UI can show a tailored
 * message + (for mode_required/mode_mismatch) offer a quick mode-switch.
 */
export async function acceptChallenge(challengeId: string): Promise<ChallengeAcceptance> {
  try {
    return await api.post<ChallengeAcceptance>(`/challenges/${challengeId}/accept`, {});
  } catch (err: unknown) {
    if (err instanceof ApiError && err.body?.code) {
      throw new AcceptChallengeError(err.body.code, err.body.error ?? err.message, err.body.required_mode);
    }
    throw err;
  }
}

/** Cancel an acceptance (acceptor OR creator). Hard-deletes the thread.
 *  Only allowed in phase='accepted' — PR3+ phases lock cancel (server 409). */
export async function cancelAcceptance(acceptanceId: string): Promise<void> {
  await api.post(`/acceptances/${acceptanceId}/cancel`, {});
}

// ── PR3: date concertation ──────────────────────────────────────────────────

/** Either party proposes a meetup date. Counter-proposals overwrite the
 *  previous proposal. `startsAt`/`endsAt` are unix timestamps (seconds). */
export async function proposeDate(
  acceptanceId: string,
  startsAt: number,
  endsAt: number | null,
  venue: string | null,
): Promise<ChallengeAcceptance> {
  return api.post<ChallengeAcceptance>(`/acceptances/${acceptanceId}/propose-date`, {
    startsAt,
    endsAt,
    venue,
  });
}

/** Proposer-only — clears the current proposal. Phase stays 'accepted'. */
export async function withdrawProposal(acceptanceId: string): Promise<ChallengeAcceptance> {
  return api.post<ChallengeAcceptance>(`/acceptances/${acceptanceId}/withdraw-proposal`, {});
}

/** Creator-only — approves the current proposal. Flips phase to 'scheduled';
 *  the thread chat IS the meet-up surface, no separate event row is created. */
export async function approveDate(acceptanceId: string): Promise<{ acceptance: ChallengeAcceptance }> {
  return api.post<{ acceptance: ChallengeAcceptance }>(
    `/acceptances/${acceptanceId}/approve-date`,
    {},
  );
}

// ── PR5: pending take-on review (creator only) ──────────────────────────────

/** Creator approves a pending take-on request → phase 'pending' → 'accepted'.
 *  Unlocks the thread chat for the acceptor + pushes them. */
export async function approveTakeOn(acceptanceId: string): Promise<{ acceptance: ChallengeAcceptance }> {
  return api.post<{ acceptance: ChallengeAcceptance }>(
    `/acceptances/${acceptanceId}/approve-takeon`,
    {},
  );
}

/** Creator declines a pending take-on request → phase 'pending' → 'rejected'.
 *  Acceptor is notified. The slot reopens (rejected rows don't count). */
export async function rejectTakeOn(acceptanceId: string): Promise<{ acceptance: ChallengeAcceptance }> {
  return api.post<{ acceptance: ChallengeAcceptance }>(
    `/acceptances/${acceptanceId}/reject-takeon`,
    {},
  );
}

// ── PR4: debrief verdict (creator only, after meetup ends) ──────────────────

/** Creator approves the take-on as accomplished (post-debrief). Final state. */
export async function approveChallenge(acceptanceId: string): Promise<ChallengeAcceptance> {
  return api.post<ChallengeAcceptance>(`/acceptances/${acceptanceId}/approve-challenge`, {});
}

/** Creator rejects (no-show / didn't really happen). Final state. */
export async function rejectChallenge(acceptanceId: string): Promise<ChallengeAcceptance> {
  return api.post<ChallengeAcceptance>(`/acceptances/${acceptanceId}/reject-challenge`, {});
}

/** "My threads" — every relationship I'm in (as creator or acceptor). */
export async function fetchMyAcceptances(): Promise<ChallengeThreadSummary[]> {
  const data = await api.get<{ threads: ChallengeThreadSummary[] }>('/me/acceptances');
  return data.threads ?? [];
}

/** Creator's view of who took on a specific challenge. */
export async function fetchChallengeAcceptances(challengeId: string): Promise<ChallengeAcceptance[]> {
  const data = await api.get<{ acceptances: ChallengeAcceptance[] }>(`/challenges/${challengeId}/acceptances`);
  return data.acceptances ?? [];
}

// ── Thread chat (per-acceptance 1:1 channel) ────────────────────────────────

/** Paginated thread chat messages. Members-only (acceptor + creator). */
export async function fetchThreadMessages(
  threadChannelId: string,
  opts: { beforeId?: string; limit?: number } = {},
): Promise<{ messages: Message[]; hasMore: boolean }> {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.beforeId) q.set('before_id', opts.beforeId);
  const data = await api.get<{ messages: Message[]; hasMore?: boolean }>(
    `/threads/${threadChannelId}/messages?${q}`,
  );
  return { messages: data.messages ?? [], hasMore: data.hasMore ?? false };
}

export async function sendThreadMessage(threadChannelId: string, content: string): Promise<Message> {
  return api.post<Message>(`/threads/${threadChannelId}/messages`, { type: 'text', content });
}

export async function sendThreadImageMessage(threadChannelId: string, imageUrl: string): Promise<Message> {
  return api.post<Message>(`/threads/${threadChannelId}/messages`, { type: 'image', imageUrl });
}

// ── Participants + chat (detail screen) ──────────────────────────────────────

/** Full participant list for the members modal. */
export async function fetchChallengeParticipants(challengeId: string): Promise<{ participants: UserDTO[]; count: number }> {
  try {
    const data = await api.get<{ participants?: UserDTO[]; count?: number }>(`/challenges/${challengeId}/participants`);
    return { participants: data.participants ?? [], count: data.count ?? (data.participants?.length ?? 0) };
  } catch {
    return { participants: [], count: 0 };
  }
}

/** Paginated chat messages for a challenge channel. */
export async function fetchChallengeMessages(
  challengeId: string,
  opts: { beforeId?: string; limit?: number } = {},
): Promise<{ messages: Message[]; hasMore: boolean }> {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.beforeId) q.set('before_id', opts.beforeId);
  const data = await api.get<{ messages: Message[]; hasMore?: boolean }>(
    `/challenges/${challengeId}/messages?${q}`,
  );
  return { messages: data.messages ?? [], hasMore: data.hasMore ?? false };
}

export async function sendChallengeMessage(
  challengeId: string,
  guestId: string,
  nickname: string,
  content: string,
  mentions?: import('./mentions').MentionInput[],
): Promise<Message> {
  const body: Record<string, unknown> = { guestId, nickname, content };
  if (mentions && mentions.length) body.mentions = mentions;
  return api.post<Message>(`/challenges/${challengeId}/messages`, body);
}

export async function sendChallengeImageMessage(
  challengeId: string,
  guestId: string,
  nickname: string,
  imageUrl: string,
): Promise<Message> {
  return api.post<Message>(`/challenges/${challengeId}/messages`, {
    guestId,
    nickname,
    imageUrl,
    type: 'image',
  });
}
