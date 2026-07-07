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
  RatePrompt,
} from '@/types';

// ── Reads ─────────────────────────────────────────────────────────────────────

/** A card in the public "Success challenges" showcase. */
export interface ShowcaseItem {
  id:                         string;
  title:                      string;
  challenge_type:             ChallengeType;
  mode:                       'local' | 'international';
  created_by:                 string | null;
  creator_display_name:       string | null;
  creator_thumb_avatar_url:   string | null;
  country:                    string | null;   // origin ISO-2
  city_name:                  string | null;   // origin city
  target_country:             string | null;
  target_city_name:           string | null;
  acceptor_user_id:           string | null;
  acceptor_display_name:      string | null;
  acceptor_thumb_avatar_url:  string | null;
  acceptor_country:           string | null;
  avg_stars:                  number | null;   // null for group winners (no star rating)
  rating_count:               number;
  comment:                    string | null;   // appreciation preview (longest)
  creator_comment:            string | null;   // challenger's own note
  acceptor_comment:           string | null;   // taker's own note
  proof_media_url:            string | null;
  proof_media_type:           string | null;
  completed_at:               number;
}

/** Public showcase of completed, well-rated challenges (global or a city). */
export async function fetchChallengeShowcase(
  opts: { cityId?: number | null; limit?: number; before?: number | null } = {},
): Promise<{ items: ShowcaseItem[]; hasMore: boolean }> {
  const params: Record<string, number> = {};
  if (opts.cityId) params.cityId = opts.cityId;
  if (opts.limit)  params.limit  = opts.limit;
  if (opts.before) params.before = opts.before;
  try {
    const data = await api.get<{ items: ShowcaseItem[]; hasMore: boolean }>(
      '/challenges/showcase', { params },
    );
    return { items: data.items ?? [], hasMore: !!data.hasMore };
  } catch {
    return { items: [], hasMore: false };
  }
}

export interface ChallengeExampleLine {
  kind:   'created' | 'winner' | 'present' | 'submission' | 'host';
  name?:  string;
  count?: number;
  points: number;
  per?:   boolean;
}
export interface ChallengeExample {
  id:          string;
  title:       string;
  type:        string;
  format:      'photo' | 'meet';
  creatorName: string;
  lines:       ChallengeExampleLine[];
}

/** 3 real resolved challenges + a who-earned-what point breakdown. */
export async function fetchChallengeExamples(): Promise<ChallengeExample[]> {
  try {
    const data = await api.get<{ examples: ChallengeExample[] }>('/challenges/examples');
    return data.examples ?? [];
  } catch {
    return [];
  }
}

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

/** Validated (archived) challenges - feeds the "See past challenges" CTA. */
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

/** One inert example for the zero-challenge empty state. No challenge id by
 *  design - these are read-only inspiration, never takeable. */
export interface InspirationExample {
  id:                       string;
  title:                    string;
  challenge_type:           ChallengeType;
  mode:                     'local' | 'international';
  country:                  string | null;   // origin (the inspiration city)
  target_country:           string | null;   // only on international challenges
  creator_username:         string | null;
  creator_display_name:     string | null;
  creator_thumb_avatar_url: string | null;
}

export interface ChallengeInspiration {
  city:     string | null;   // source city name (for the small "by … · city" line)
  cityId:   string | null;
  examples: InspirationExample[];
}

/**
 * Up to 3 example challenges from the most-active OTHER city, for the
 * zero-challenge empty state. Read-only "idea book" - the payload carries no
 * challenge id, so there is no way to open or take these from the client.
 * Returns an empty list (block renders nothing) when no other city qualifies
 * or on any error.
 */
export async function fetchChallengeInspiration(excludeChannelId: string): Promise<ChallengeInspiration> {
  try {
    return await api.get<ChallengeInspiration>('/challenges/inspiration', {
      params: { excludeChannelId },
    });
  } catch (err) {
    console.warn('[fetchChallengeInspiration] failed:', err);
    return { city: null, cityId: null, examples: [] };
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

// A challenge as listed on a profile - Challenge DTO plus whether the profile
// user owns it (created it) vs merely accepted it.
export type ProfileChallenge = Challenge & { is_owner?: boolean };

/** Challenges a user created or accepted - for the profile "Challenges" tab. */
export async function fetchUserChallenges(userId: string): Promise<ProfileChallenge[]> {
  try {
    const data = await api.get<{ challenges?: ProfileChallenge[] }>(`/users/${userId}/challenges`);
    return data.challenges ?? [];
  } catch {
    return [];
  }
}

// ── Writes ────────────────────────────────────────────────────────────────────

/** Optional fields for International mode + visibility (privacy layer).
 *  Mode/target/proof fields are ignored by the server when `mode='local'`.
 *  `targetCityChannelId` null = "anywhere". `visibility` is 'public' or
 *  'friends' at input - 'private' is reachable only via the mutual privacy
 *  flow once the challenge has an acceptor. Server forces 'public' on
 *  International rows regardless of what we send. */
export interface InternationalChallengeFields {
  mode?:                 'local' | 'international';
  targetCityChannelId?:  string | number | null;
  proofRequirements?:    string | null;
  /** Validation method per challenge. International is locked to
   *  'photo_proof' by the server regardless of input; local creators
   *  pick. Default 'meet' preserves the historical IRL flow. */
  validationMethod?:     'meet' | 'photo_proof' | null;
  visibility?:           'public' | 'friends' | null;
  // Group model (Phase 4): a local MEET challenge created with format='group'
  // carries a meet date + location set at creation.
  format?:               'legacy' | 'group';
  meetAt?:               number | null;   // unix seconds
  meetEndsAt?:           number | null;   // unix seconds (optional)
  venue?:                string | null;
  venueLat?:             number | null;
  venueLng?:             number | null;
}

export async function createChallenge(
  channelId: string,
  guestId: string,
  nickname: string | null,
  title: string,
  challengeType: ChallengeType,
  audience: ChallengeAudience,
  returnClause: string | null,
  intl: InternationalChallengeFields = {},
): Promise<Challenge> {
  return api.post<Challenge>(`/channels/${channelId}/challenges`, {
    guestId,
    nickname,
    title,
    challengeType,
    audience,
    returnClause,
    mode:                intl.mode ?? 'local',
    targetCityChannelId: intl.targetCityChannelId ?? null,
    proofRequirements:   intl.proofRequirements ?? null,
    validationMethod:    intl.validationMethod ?? null,
    visibility:          intl.visibility ?? 'public',
    format:              intl.format ?? 'legacy',
    meetAt:              intl.meetAt ?? null,
    meetEndsAt:          intl.meetEndsAt ?? null,
    venue:               intl.venue ?? null,
    venueLat:            intl.venueLat ?? null,
    venueLng:            intl.venueLng ?? null,
  });
}

/** GROUP challenges: the challenger validates who was present at the meet.
 *  Returns the count + ids now marked present. Present takers earn the big
 *  reward; the challenger earns a base + per-head. One-shot (the challenge is
 *  marked validated). */
export async function validatePresence(
  challengeId: string,
  presentUserIds: string[],
  rating?: number | null,
): Promise<{ ok: boolean; present_count: number; present_ids: string[] }> {
  return api.post(`/challenges/${challengeId}/validate-presence`, {
    presentUserIds,
    ...(rating ? { rating } : {}),
  });
}

/** Challenger rates the challenge (stars + optional note). Used by the photo-proof
 *  reveal modal, where there's no validate sheet to capture the rating. */
export async function submitHostRating(
  challengeId: string,
  stars: number,
  comment?: string | null,
): Promise<{ ok: boolean }> {
  return api.post(`/challenges/${challengeId}/host-rating`, {
    stars,
    ...(comment && comment.trim() ? { comment: comment.trim() } : {}),
  });
}

/** Taker's own rating + note for the challenge (from the reveal modal). Mirrors
 *  submitHostRating but stored on the caller's acceptance. */
export async function submitTakerRating(
  challengeId: string,
  stars: number,
  comment?: string | null,
): Promise<{ ok: boolean }> {
  return api.post(`/challenges/${challengeId}/taker-rating`, {
    stars,
    ...(comment && comment.trim() ? { comment: comment.trim() } : {}),
  });
}

/** Challenger designates the winning photo of a GROUP photo-proof contest.
 *  The winner earns the +40 bonus and the challenge is marked validated. The
 *  backend rejects a pick whose user has no submission. */
export async function pickWinner(
  challengeId: string,
  winnerUserId: string,
): Promise<{ ok: boolean; winnerUserId: string }> {
  return api.post(`/challenges/${challengeId}/pick-winner`, { winnerUserId });
}

/** One submitter's photo in a GROUP photo-proof contest gallery. */
export interface GroupSubmission {
  id:           string;
  user_id:      string;
  display_name: string;
  avatar_url:   string | null;
  media_url:    string;
  media_type:   string;
  status:       string;
  submitted_at: number;
}

/** Every submitter's photo for a GROUP photo-proof challenge + the winner (if
 *  picked). Powers the in-channel submissions gallery and the winner picker. */
export async function fetchGroupSubmissions(
  challengeId: string,
): Promise<{ submissions: GroupSubmission[]; winnerUserId: string | null }> {
  return api.get(`/challenges/${challengeId}/submissions`);
}

/** Owner-only edit of a challenge's title / type / audience / return clause.
 *  Status is not editable here - use validateChallenge(). max_participants
 *  is no longer accepted (1:1 model). Mode is also not editable - delete +
 *  recreate is the expected path. International edit can re-target the city
 *  and revise the proof requirements. */
export async function updateChallenge(
  challengeId: string,
  guestId: string,
  title: string,
  challengeType: ChallengeType,
  audience: ChallengeAudience,
  returnClause: string | null,
  intl: Omit<InternationalChallengeFields, 'mode'> = {},
): Promise<Challenge> {
  return api.put<Challenge>(`/challenges/${challengeId}`, {
    guestId,
    title,
    challengeType,
    audience,
    returnClause,
    targetCityChannelId: intl.targetCityChannelId ?? null,
    proofRequirements:   intl.proofRequirements ?? null,
    // null = don't change. 'public' | 'friends' only at input; the mutual
    // privacy flow is the only path to 'private'.
    visibility:          intl.visibility ?? null,
    // null = don't change. Local rows can flip meet ⇄ photo_proof (swaps the
    // pipeline); the server forces 'photo_proof' on International.
    validationMethod:    intl.validationMethod ?? null,
  });
}

/** Flip users.has_seen_public_optin to TRUE so the first-time public modal
 *  stops showing for this user. One-shot endpoint, idempotent. */
export async function dismissPublicOptin(): Promise<{ ok: boolean; hasSeenPublicOptin: boolean }> {
  return api.post<{ ok: boolean; hasSeenPublicOptin: boolean }>(`/me/dismiss-public-optin`, {});
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
 * Take on a challenge - creates a thread channel + acceptance row.
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
 *  Only allowed in phase='accepted' - PR3+ phases lock cancel (server 409). */
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

/** Proposer-only - clears the current proposal. Phase stays 'accepted'. */
export async function withdrawProposal(acceptanceId: string): Promise<ChallengeAcceptance> {
  return api.post<ChallengeAcceptance>(`/acceptances/${acceptanceId}/withdraw-proposal`, {});
}

/** Creator-only - approves the current proposal. Flips phase to 'scheduled';
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

/** Taker leaves an active take-on: deletes the acceptance (challenge reopens
 *  from zero), wipes the challenge chat, pushes + WS-resets the creator. */
export async function abandonAcceptance(acceptanceId: string): Promise<{ ok: boolean; challengeId: string }> {
  return api.post<{ ok: boolean; challengeId: string }>(
    `/acceptances/${acceptanceId}/abandon`,
    {},
  );
}

/** Creator restarts from zero: removes the active taker (deletes their
 *  acceptance), wipes the chat, reopens the challenge, pushes + WS-resets the
 *  removed taker. */
export async function restartChallenge(challengeId: string): Promise<{ ok: boolean; challengeId: string }> {
  return api.post<{ ok: boolean; challengeId: string }>(
    `/challenges/${challengeId}/restart`,
    {},
  );
}

/** Relaunch an ENDED challenge: reopens with the SAME countdown originally set
 *  (server recomputes the deadline). Returns the updated challenge. */
export async function relaunchChallenge(challengeId: string): Promise<{ ok: boolean; challenge: Challenge }> {
  return api.post<{ ok: boolean; challenge: Challenge }>(
    `/challenges/${challengeId}/relaunch`,
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

/** "My threads" - every relationship I'm in (as creator or acceptor). */
export async function fetchMyAcceptances(): Promise<ChallengeThreadSummary[]> {
  const data = await api.get<{ threads: ChallengeThreadSummary[] }>('/me/acceptances');
  return data.threads ?? [];
}

// ── PR6: rate-prompts + ratings ─────────────────────────────────────────────

/** Caller's currently rate-eligible meet-ups. Sorted oldest-first. Returns
 *  [] on network error (banner just doesn't render - non-blocking surface). */
export async function fetchRatePrompts(): Promise<RatePrompt[]> {
  try {
    const data = await api.get<{ prompts: RatePrompt[] }>('/me/rate-prompts');
    return data.prompts ?? [];
  } catch (err) {
    console.warn('[fetchRatePrompts] failed:', err);
    return [];
  }
}

// PR17 - Score celebration popin (the "+X points!" launch surface).
export type ScoreEventKind = 'accepted' | 'date_locked' | 'meetup' | 'debrief' | 'ghost' | 'meet_bonus';

export interface ScoreCelebrationEvent {
  id:              string;
  challenge_id:    string;
  challenge_title: string | null; // null if the challenge was deleted
  kind:            ScoreEventKind;
  role:            'challenger' | 'taker';
  points:          number;
  created_at:      string;        // ISO
}

export interface ScoreCelebration {
  points:       number;                          // 0 = nothing to show - DELTA since last ack
  event_count?: number;
  top_kind?:    ScoreEventKind | null;
  events?:      ScoreCelebrationEvent[];         // newest first, capped server-side
  events_truncated?: boolean;
  seen_until?:  string | null;                   // ISO timestamp; ack with this
  city_id?:     string | null;
  city_name?:   string | null;
  city_country?: string | null;
  top_n?:       number;
  // Cached personal totals AFTER the delta lands. `points` is the +X gained;
  // these are "you now have N points" (alltime + this month).
  total_alltime?: number;
  total_month?:   number;
  rank_alltime?: { city: number | null; global: number | null };
  rank_month?:   { city: number | null; global: number | null };
  // Caller's CITY's rank in the Cities cup (sum of all members' points per
  // city). Distinct from rank_*.city which ranks the USER within that city.
  city_rank_alltime?: number | null;
  city_rank_month?:   number | null;
}

/** A pending GROUP challenge result reveal for the viewer (one per resolved
 *  challenge they participated in, until acked). `id` is the notification id —
 *  ack with markNotificationsRead([id]). */
export interface ChallengeReveal {
  id:               number;
  challengeId:      string;
  format:           'photo' | 'meet';
  myRole:           'winner' | 'loser' | 'present' | 'absent' | 'host';
  myPoints:         number;
  winnerUserId?:    string | null;
  winnerName?:      string | null;
  winnerPhotoUrl?:  string | null;
  challengerName?:  string | null;
  participantCount?: number;
  hostBreakdown?:   { base: number; perHead: number; heads: number } | null;
  /** The viewer's current total score - lets the modal climb the running total. */
  myTotal?:         number;
  /** Which challenge this reveal is for (shown under the headline). */
  challengeTitle?:  string | null;
  /** Viewer's current city / world rank + the bounded top-N (rank rows). */
  rankCity?:        number | null;
  rankGlobal?:      number | null;
  rankTopN?:        number | null;
  cityName?:        string | null;
}

/** Unread group-result reveals for the caller. */
export async function fetchChallengeReveals(): Promise<ChallengeReveal[]> {
  try {
    const r = await api.get<{ reveals: ChallengeReveal[] }>('/me/challenge-reveals');
    return r.reveals ?? [];
  } catch (err) {
    console.warn('[fetchChallengeReveals] failed:', err);
    return [];
  }
}

/** Pending celebration delta. Returns { points: 0 } when nothing to show. */
export async function fetchScoreCelebration(): Promise<ScoreCelebration> {
  try {
    return await api.get<ScoreCelebration>('/me/score-celebration');
  } catch (err) {
    console.warn('[fetchScoreCelebration] failed:', err);
    return { points: 0 };
  }
}

/** Ack the celebration so the next GET returns 0. seen_until comes from the
 *  GET payload - it's the max event timestamp the server included in the sum. */
export async function ackScoreCelebration(seenUntil: string): Promise<void> {
  try {
    await api.post('/me/score-celebration/seen', { seen_until: seenUntil });
  } catch (err) {
    console.warn('[ackScoreCelebration] failed:', err);
  }
}

// PR33 - toggle a reaction on a challenge-channel message. Same allowed
// emojis as the event/city reactions. Returns the updated reaction list
// so callers can hydrate state without a separate fetch.
export async function toggleChallengeReaction(
  challengeId: string,
  messageId:   string,
  emoji:       string,
  guestId:     string,
): Promise<import('@/types').Reaction[]> {
  const data = await api.post<{ reactions: import('@/types').Reaction[] }>(
    `/challenges/${challengeId}/messages/${messageId}/reactions`,
    { emoji, guestId },
  );
  return data.reactions;
}

/** Submit a rating for a challenge. Throws ApiError on 4xx so the sheet can
 *  branch - in particular code='already_rated' (409) and code='not_rate_eligible'
 *  (403) are recoverable by dismissing + refetching the prompts list. */
export async function submitRating(
  challengeId: string,
  stars: number,
  comment: string | null,
): Promise<{ revealed: boolean }> {
  const body: Record<string, unknown> = { stars };
  if (comment !== null && comment.length > 0) body.comment = comment;
  const data = await api.post<{ rating: unknown; revealed: boolean }>(
    `/challenges/${challengeId}/ratings`,
    body,
  );
  return { revealed: !!data?.revealed };
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

// ── International - proof submission ────────────────────────────────────────

export interface ChallengeProof {
  id:               string;
  acceptance_id:    string;
  media_url:        string;
  media_type:       'image' | 'video';
  geotag_lat:       number;
  geotag_lng:       number;
  geotag_verified:  boolean;
  status:           'pending' | 'approved' | 'rejected';
  rejection_reason: string | null;
  submitted_at:     string;
  reviewed_at:      string | null;
}

export interface ProofListResult {
  proofs:       ChallengeProof[];
  attempts:     number;
  maxAttempts:  number;
}

export async function fetchProofs(acceptanceId: string): Promise<ProofListResult> {
  return api.get<ProofListResult>(`/acceptances/${acceptanceId}/proofs`);
}

/** Acceptor submits a proof. Caller has the media uploaded to R2 via
 *  uploadFile(). lat/lng are optional - PR59 dropped the GPS prompt;
 *  the server stubs 0/0 + marks the proof verified when coords are
 *  absent. */
export async function submitProof(
  acceptanceId: string,
  body: { mediaUrl: string; mediaType: 'image' | 'video'; lat?: number; lng?: number },
): Promise<{ proof: ChallengeProof; attempt: number; maxAttempts: number }> {
  return api.post<{ proof: ChallengeProof; attempt: number; maxAttempts: number }>(
    `/acceptances/${acceptanceId}/submit-proof`,
    body,
  );
}

/** Creator approves the proof - terminal success. */
export async function approveProof(proofId: string): Promise<{ proof: ChallengeProof }> {
  return api.post<{ proof: ChallengeProof }>(`/proofs/${proofId}/approve`, {});
}

/** Creator rejects with a mandatory reason (1–200 chars). Returns whether
 *  this was the acceptor's last attempt (`isFinal`) so the UI can switch
 *  copy from "they can try again" to "challenge closed". */
export async function rejectProof(
  proofId: string,
  reason: string,
): Promise<{ proof: ChallengeProof; isFinal: boolean; attemptsLeft: number }> {
  return api.post<{ proof: ChallengeProof; isFinal: boolean; attemptsLeft: number }>(
    `/proofs/${proofId}/reject`,
    { reason },
  );
}

// ── Personal invitations ────────────────────────────────────────────────────

/** Hand-pick city members to ping with a personal invitation to take this on. */
export async function inviteToChallenge(
  challengeId: string,
  userIds: string[],
): Promise<{ invited: string[]; count: number; duplicates: number }> {
  return api.post<{ invited: string[]; count: number; duplicates: number }>(
    `/challenges/${challengeId}/invite`,
    { userIds },
  );
}

/** Accept an invitation. May fall through to the regular take-on flow's gates
 *  (in_progress, mode_mismatch, …) - surfaces the same code shape. */
export async function acceptInvitation(invitationId: string): Promise<{
  acceptance?: ChallengeAcceptance;
  challengeId: string;
}> {
  return api.post<{ acceptance?: ChallengeAcceptance; challengeId: string }>(
    `/invitations/${invitationId}/accept`,
    {},
  );
}

/** Dismiss an invitation. Silent - does not notify the inviter. */
export async function ignoreInvitation(invitationId: string): Promise<void> {
  await api.post(`/invitations/${invitationId}/ignore`, {});
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
  replyToMessageId?: string | null,
  mentions?: import('./mentions').MentionInput[],
): Promise<Message> {
  const body: Record<string, unknown> = { guestId, nickname, content };
  if (replyToMessageId) body.replyToMessageId = replyToMessageId;
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

// ── Channel participation (Join / Leave / Kick / settings) ───────────────────

export interface ChannelMember {
  id:             string;
  displayName:    string | null;
  username:       string | null;
  thumbAvatarUrl: string | null;
  joinedAt:       number;
}

/** Publicly visible joined-member list (creator + active taker NOT included
 *  here - they're surfaced separately on the detail page). */
export async function fetchChannelParticipants(challengeId: string): Promise<{ members: ChannelMember[]; count: number }> {
  try {
    return await api.get<{ members: ChannelMember[]; count: number }>(`/challenges/${challengeId}/channel-participants`);
  } catch {
    return { members: [], count: 0 };
  }
}

export interface MyParticipation {
  isIn:                   boolean;
  isKicked?:              boolean;
  notificationPreference?: 'milestones' | 'all' | 'off' | null;
  reason?:                string;
}

/** "Am I in this channel?" probe. Anon viewers always get isIn=false. */
export async function fetchMyChallengeParticipation(challengeId: string): Promise<MyParticipation> {
  try {
    return await api.get<MyParticipation>(`/challenges/${challengeId}/participants/me`);
  } catch {
    return { isIn: false };
  }
}

export async function joinChallengeChannel(challengeId: string): Promise<{ count: number; isIn: boolean }> {
  return api.post<{ count: number; isIn: boolean }>(`/challenges/${challengeId}/join`, {});
}

export async function leaveChallengeChannel(challengeId: string): Promise<{ ok: boolean; isIn: false; count: number }> {
  return api.delete<{ ok: boolean; isIn: false; count: number }>(`/challenges/${challengeId}/participants/me`);
}

export async function kickChallengeParticipant(challengeId: string, userId: string, reason?: string): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(
    `/challenges/${challengeId}/participants/${userId}/kick`,
    reason ? { reason } : {},
  );
}

export async function setChallengeVisibility(
  challengeId: string,
  visibility: 'public' | 'friends' | 'private',
): Promise<{ ok: boolean; visibility: 'public' | 'friends' | 'private'; closed_to_new_joins?: boolean }> {
  return api.post<{ ok: boolean; visibility: 'public' | 'friends' | 'private'; closed_to_new_joins?: boolean }>(
    `/challenges/${challengeId}/visibility`,
    { visibility },
  );
}

export async function setChallengeCloseToJoins(challengeId: string, closed: boolean): Promise<{ ok: boolean; closed_to_new_joins: boolean }> {
  return api.post<{ ok: boolean; closed_to_new_joins: boolean }>(
    `/challenges/${challengeId}/close-to-new-joins`,
    { closed },
  );
}

export async function setChallengeNotificationPreference(
  challengeId: string,
  preference: 'milestones' | 'all' | 'off',
): Promise<{ ok: boolean; preference: string }> {
  return api.post<{ ok: boolean; preference: string }>(
    `/challenges/${challengeId}/notification-preference`,
    { preference },
  );
}
