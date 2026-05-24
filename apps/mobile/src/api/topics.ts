import { api, ApiError } from './client';
import type { FeedItem, Topic, Message, UserDTO } from '@/types';

// ── Now feed ──────────────────────────────────────────────────────────────────
// GET /channels/{id}/now → { items: FeedItem[], publicEvents: FeedItem[] }
// Backend returns a normalized DTO: events, topics, and public events with a
// consistent set of top-level fields (kind, title, description, active_now, …).
export async function fetchNowFeed(
  channelId: string,
  guestId?: string,
): Promise<{ items: FeedItem[]; publicEvents: FeedItem[] }> {
  try {
    const data = await api.get<{ items: FeedItem[]; publicEvents?: FeedItem[] }>(
      `/channels/${channelId}/now`,
      guestId ? { params: { guestId } } : undefined,
    );
    return { items: data.items ?? [], publicEvents: data.publicEvents ?? [] };
  } catch (err) {
    console.warn('[fetchNowFeed] failed:', err);
    return { items: [], publicEvents: [] };
  }
}

// Past archive — finished one-off hangouts + expired pulses for a city.
// GET /channels/{id}/past → { items: FeedItem[], nextCursor: number|null }
// Items share the same normalized FeedItem shape as the now feed, so the same
// cards render them. `before` is a unix cursor (pass nextCursor from the prior
// page); `from`/`to` are city-local YYYY-MM-DD (backend clamps the span ≤14d).
export async function fetchPastArchive(
  channelId: string,
  opts: {
    type?:  'both' | 'hangouts' | 'pulses';
    limit?: number;
    before?: number;
    from?:  string;
    to?:    string;
  } = {},
): Promise<{ items: FeedItem[]; nextCursor: number | null }> {
  const params: Record<string, string | number> = {};
  if (opts.type)   params.type   = opts.type;
  if (opts.limit)  params.limit  = opts.limit;
  if (opts.before) params.before = opts.before;
  if (opts.from && opts.to) { params.from = opts.from; params.to = opts.to; }
  try {
    const data = await api.get<{ items?: FeedItem[]; nextCursor?: number | null }>(
      `/channels/${channelId}/past`,
      { params },
    );
    return { items: data.items ?? [], nextCursor: data.nextCursor ?? null };
  } catch (err) {
    console.warn('[fetchPastArchive] failed:', err);
    return { items: [], nextCursor: null };
  }
}

// Active topics only — used when you need just the topic list.
export async function fetchCityTopics(channelId: string): Promise<Topic[]> {
  try {
    const data = await api.get<{ topics: Topic[] }>(`/channels/${channelId}/topics`);
    return data.topics ?? [];
  } catch {
    return [];
  }
}

export async function fetchTopicById(topicId: string): Promise<Topic> {
  const data = await api.get<{ topic: Topic }>(`/topics/${topicId}`);
  return data.topic;
}

export async function fetchTopicMessages(
  topicId: string,
  opts: { beforeId?: string; limit?: number } = {},
): Promise<{ messages: Message[]; hasMore: boolean; forbidden?: boolean }> {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.beforeId) q.set('before_id', opts.beforeId);
  try {
    const data = await api.get<{ messages: Message[]; hasMore?: boolean }>(
      `/topics/${topicId}/messages?${q}`,
    );
    return { messages: data.messages ?? [], hasMore: data.hasMore ?? false };
  } catch (e) {
    // Members-only: a non-member (incl. pending requester) gets 403. Surface it
    // so the screen shows the gated "request pending" state instead of erroring.
    if (e instanceof ApiError && e.status === 403) {
      return { messages: [], hasMore: false, forbidden: true };
    }
    throw e;
  }
}

// ── Hangout request-to-join (internally "topic") ──────────────────────────────

export type JoinRequestStatus = 'pending' | 'accepted' | 'rejected' | 'duplicate' | 'cooldown' | 'already_participant' | 'already_resolved';

/** Member asks to join a hangout. Returns the resulting status. */
export async function requestToJoinHangout(topicId: string): Promise<{ status: JoinRequestStatus; requestId?: string }> {
  try {
    return await api.post<{ status: JoinRequestStatus; requestId?: string }>(`/topics/${topicId}/join-requests`, {});
  } catch (e) {
    // 409 conflicts (duplicate/cooldown/already_resolved) carry a body status —
    // surface it rather than throwing so the UI can show a friendly message.
    const body = (e as { body?: { status?: JoinRequestStatus } } | null)?.body;
    if (body?.status) return { status: body.status };
    throw e;
  }
}

/** Any participant accepts/rejects a pending request. 409 = already resolved. */
export async function resolveHangoutJoinRequest(
  topicId: string,
  requestId: string,
  action: 'accept' | 'reject',
): Promise<{ status: JoinRequestStatus; resolvedByName?: string }> {
  try {
    return await api.post<{ status: JoinRequestStatus; resolvedByName?: string }>(
      `/topics/${topicId}/join-requests/${requestId}/resolve`, { action },
    );
  } catch (e) {
    const body = (e as { body?: { status?: JoinRequestStatus } } | null)?.body;
    if (body?.status) return { status: body.status }; // already_resolved → reconcile silently
    throw e;
  }
}

export async function sendTopicMessage(
  topicId: string,
  guestId: string,
  nickname: string,
  content: string,
  mentions?: import('./mentions').MentionInput[],
): Promise<Message> {
  const body: Record<string, unknown> = { guestId, nickname, content };
  if (mentions && mentions.length) body.mentions = mentions;
  return api.post<Message>(`/topics/${topicId}/messages`, body);
}

export async function sendTopicImageMessage(
  topicId: string,
  guestId: string,
  nickname: string,
  imageUrl: string,
): Promise<Message> {
  return api.post<Message>(`/topics/${topicId}/messages`, {
    guestId,
    nickname,
    imageUrl,
    type: 'image',
  });
}

export async function markTopicRead(topicId: string, guestId: string): Promise<void> {
  await api.post(`/topics/${topicId}/mark-read`, { guestId }).catch(() => {});
}

/** Full member list for a hangout (avatar-row modal). */
export async function fetchHangoutParticipants(topicId: string): Promise<{ participants: UserDTO[]; count: number }> {
  try {
    const data = await api.get<{ participants?: UserDTO[]; count?: number }>(`/topics/${topicId}/participants`);
    return { participants: data.participants ?? [], count: data.count ?? (data.participants?.length ?? 0) };
  } catch {
    return { participants: [], count: 0 };
  }
}

// A hangout as listed on a profile — Topic DTO plus whether the profile user
// owns it (created it) vs merely joined.
export type ProfileHangout = Topic & { is_owner?: boolean };

/** Active hangouts a user created or joined — for the profile "Hangouts" tab. */
export async function fetchUserHangouts(userId: string): Promise<ProfileHangout[]> {
  try {
    const data = await api.get<{ hangouts?: ProfileHangout[] }>(`/users/${userId}/hangouts`);
    return data.hangouts ?? [];
  } catch {
    return [];
  }
}

/** Owner-only edit of a hangout's title/description/category. */
export async function updateTopic(
  topicId: string,
  guestId: string,
  title: string,
  description: string | null,
  category: string,
): Promise<Topic> {
  return api.put<Topic>(`/topics/${topicId}`, { guestId, title, description, category });
}

/** Owner-only delete (soft) of a hangout. */
export async function deleteTopic(topicId: string, guestId: string): Promise<void> {
  await api.delete(`/topics/${topicId}`, { guestId });
}

export async function createTopic(
  channelId: string,
  guestId: string,
  title: string,
  description: string | null,
  category: string,
  coords?: { lat: number; lng: number } | null,
): Promise<Topic> {
  const body: Record<string, unknown> = { guestId, title, description, category };
  // Hangouts have no address — send the creator's coords so NOW can show distance.
  if (coords && typeof coords.lat === 'number' && typeof coords.lng === 'number') {
    body.lat = coords.lat;
    body.lng = coords.lng;
  }
  return api.post<Topic>(`/channels/${channelId}/topics`, body);
}
