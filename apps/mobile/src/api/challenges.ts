import { api } from './client';
import type {
  Challenge,
  ChallengeType,
  ChallengeAudience,
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
): Promise<Challenge> {
  return api.post<Challenge>(`/channels/${channelId}/challenges`, {
    guestId,
    nickname,
    title,
    challengeType,
    audience,
  });
}

/** Owner-only edit of a challenge's title / type / audience. Status is not editable here — use validateChallenge(). */
export async function updateChallenge(
  challengeId: string,
  guestId: string,
  title: string,
  challengeType: ChallengeType,
  audience: ChallengeAudience,
): Promise<Challenge> {
  return api.put<Challenge>(`/challenges/${challengeId}`, {
    guestId,
    title,
    challengeType,
    audience,
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

/** Accept / leave a challenge. Returns the new count + whether the caller is in. */
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
