import { api } from './client';
import type { City, FeedItem, HiladsEvent, Message, UserDTO } from '@/types';

// ── City / channel resolution ─────────────────────────────────────────────────

// Backend returns { city: string, channelId: string|number, timezone: string, country: string }.
// The 'city' field is the name — different from the City type's 'name' field.
// We normalise here so the rest of the app always gets a proper City object.
export async function resolveLocation(lat: number, lng: number): Promise<City> {
  const data = await api.post<{
    city:      string;
    channelId: string | number;
    timezone:  string;
    country:   string | null;
  }>('/location/resolve', { lat, lng });

  return {
    channelId: String(data.channelId),
    name:      data.city,
    country:   data.country ?? '',
    timezone:  data.timezone ?? 'UTC',
    slug:      (data.city ?? '').toLowerCase().replace(/\s+/g, '-'),
  };
}

// Raw shape returned by GET /channels — fields differ from the City type.
interface RawChannel {
  channelId:    string | number;
  city:         string;          // web: ch.city — city display name
  country:      string | null;
  timezone:     string | null;
  activeUsers?: number;          // web: ch.activeUsers — online count
  messageCount?: number;
  eventCount?:   number;
  topicCount?:   number;
  liveScore?:    number;
}

export async function fetchChannels(): Promise<City[]> {
  const data = await api.get<{ channels: RawChannel[] }>('/channels');
  return (data.channels ?? []).map(ch => ({
    channelId:    String(ch.channelId),
    name:         ch.city,                                               // normalize city → name
    country:      ch.country ?? '',
    timezone:     ch.timezone ?? 'UTC',
    slug:         (ch.city ?? '').toLowerCase().replace(/\s+/g, '-'),
    onlineCount:  ch.activeUsers,                                        // normalize activeUsers → onlineCount
    messageCount: ch.messageCount,
    eventCount:   ch.eventCount,
    topicCount:   ch.topicCount,
    liveScore:    ch.liveScore,
  }));
}

export async function fetchCityBySlug(slug: string): Promise<City | null> {
  try {
    return await api.get<City>(`/cities/by-slug/${encodeURIComponent(slug)}`);
  } catch {
    return null;
  }
}

// ── Presence ──────────────────────────────────────────────────────────────────

export async function joinChannel(
  channelId: string,
  sessionId: string,
  guestId: string,
  nickname: string,
  previousChannelId?: string,
): Promise<void> {
  await api.post(`/channels/${channelId}/join`, {
    sessionId,
    guestId,
    nickname,
    previousChannelId,
  });
}

export interface OpenCityResult {
  joinMessage:  Message | null;
  messages:     Message[];
  hasMore:      boolean;
  onlineUsers:  UserDTO[];
  onlineCount:  number;
  feedItems:    FeedItem[];
  publicEvents: HiladsEvent[];
}

/**
 * Bootstrap a city open in a single round-trip.
 * Equivalent to POST /join + GET /messages + GET /now — eliminates 2 extra PHP
 * bootstrap costs + 2 extra network RTTs on initial city entry.
 */
export async function openCity(
  channelId: string,
  sessionId: string,
  guestId: string,
  nickname: string,
  previousChannelId?: string,
): Promise<OpenCityResult> {
  const data = await api.post<OpenCityResult>(`/channels/${channelId}/open`, {
    sessionId,
    guestId,
    nickname,
    ...(previousChannelId ? { previousChannelId } : {}),
  });
  return {
    joinMessage:  data.joinMessage  ?? null,
    messages:     data.messages     ?? [],
    hasMore:      data.hasMore      ?? false,
    onlineUsers:  data.onlineUsers  ?? [],
    onlineCount:  data.onlineCount  ?? 0,
    feedItems:    data.feedItems    ?? [],
    publicEvents: data.publicEvents ?? [],
  };
}

export async function leaveChannel(channelId: string, sessionId: string): Promise<void> {
  await api.post(`/channels/${channelId}/leave`, { sessionId }).catch(() => {});
}

export async function heartbeat(
  channelId: string,
  sessionId: string,
  guestId: string,
  nickname: string,
): Promise<void> {
  await api.post(`/channels/${channelId}/heartbeat`, { sessionId, guestId, nickname });
}

// ── Messages ──────────────────────────────────────────────────────────────────

/** City crew member — canonical UserDTO from /channels/{id}/members. */
export type CityMember = UserDTO;

export interface CityMembersResult {
  members: CityMember[];
  total:   number;
  page:    number;
  hasMore: boolean;
}

export async function fetchCityMembers(
  channelId: string,
  opts: { page?: number; limit?: number; badge?: string | null; vibe?: string | null } = {},
): Promise<CityMembersResult> {
  const q = new URLSearchParams({ page: String(opts.page ?? 1), limit: String(opts.limit ?? 10) });
  if (opts.badge) q.set('badge', opts.badge);
  if (opts.vibe)  q.set('vibe',  opts.vibe);
  return api.get<CityMembersResult>(`/channels/${channelId}/members?${q}`);
}

export interface CityAmbassador extends UserDTO {
  ambassadorPicks?: {
    restaurant?: string;
    spot?: string;
    tip?: string;
    story?: string;
  };
}

export async function fetchCityAmbassadors(channelId: string): Promise<CityAmbassador[]> {
  try {
    const data = await api.get<{ ambassadors: CityAmbassador[] }>(`/channels/${channelId}/ambassadors`);
    return data.ambassadors ?? [];
  } catch {
    return [];
  }
}

export async function fetchMessages(
  channelId: string,
  opts: { beforeId?: string; limit?: number } = {},
): Promise<{ messages: Message[]; hasMore: boolean }> {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.beforeId) q.set('before_id', opts.beforeId);
  const data = await api.get<{ messages: Message[]; hasMore?: boolean }>(
    `/channels/${channelId}/messages?${q}`,
  );
  return { messages: data.messages ?? [], hasMore: data.hasMore ?? false };
}

export async function sendMessage(
  channelId: string,
  sessionId: string,
  guestId: string,
  nickname: string,
  content: string,
): Promise<Message> {
  return api.post<Message>(`/channels/${channelId}/messages`, {
    sessionId,
    guestId,
    nickname,
    content,
  });
}

export async function sendImageMessage(
  channelId: string,
  sessionId: string,
  guestId: string,
  nickname: string,
  imageUrl: string,
): Promise<Message> {
  const payload = { sessionId, guestId, nickname, imageUrl, type: 'image' };
  console.log('[image-upload] sending message payload =', JSON.stringify(payload));
  return api.post<Message>(`/channels/${channelId}/messages`, payload);
}
