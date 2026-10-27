import { api, ApiError } from './client';
import i18n from '@/i18n';
import { rememberCityNames } from '@/i18n/cityName';
import type { City, Message, Reaction, UserDTO, Badge } from '@/types';

// ── City / channel resolution ─────────────────────────────────────────────────

// A city as the V5 endpoints send it (resolve, search pick, by-id, /me/city):
// `city` the English name (the app's key: slug, cityNames), `name` /
// `shortName` in the app's language, remembered for localizeCityName.
interface CityPayload {
  channelId:  string | number;
  city:       string;
  name?:      string | null;
  shortName?: string | null;
  country:    string | null;
  timezone:   string | null;
  geonameId?: number | null;
}

function locale(): string {
  return i18n.language || 'en';
}

function toCity(data: CityPayload): City {
  rememberCityNames(data.city, locale(), data.name, data.shortName);
  return {
    channelId: String(data.channelId),
    name:      data.city,
    country:   data.country ?? '',
    timezone:  data.timezone ?? 'UTC',
    slug:      (data.city ?? '').toLowerCase().replace(/\s+/g, '-'),
    geonameId: data.geonameId ?? null,
  };
}

/** GPS found a city other than the account's (kept) one: the app asks "Switch?". */
export interface CitySwitchFrom { channelId: string; name: string; country: string }

/** No city within 50 km of the position (POST /location/resolve 404 no_city). */
export function isNoCity(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404 && err.body?.code === 'no_city';
}

// Optional `country` (ISO-2): a hint for older servers' nearest-city. propose:
// the server never moves an account's GPS-confirmed or chosen city; it reports
// it as switchFrom and the app asks (CitySwitchSheet). Throws no_city (isNoCity)
// beyond 50 km of any city.
export async function resolveLocation(lat: number, lng: number, country?: string | null): Promise<City & { switchFrom?: CitySwitchFrom | null }> {
  const data = await api.post<CityPayload & { switchFrom?: { channelId: string | number; city: string; country: string | null } | null }>(
    '/location/resolve', { lat, lng, ...(country ? { country } : {}), propose: true, locale: locale() });
  const sf = data.switchFrom;
  return {
    ...toCity(data),
    switchFrom: sf ? { channelId: String(sf.channelId), name: sf.city, country: sf.country ?? '' } : null,
  };
}

/** A city of the world search (GET /cities/search): where a pick plays, and its Hilads city if any. */
export interface CitySearchResult {
  geonameId:  number;
  name:       string;               // in the app's language
  country:    string;
  population: number;
  playsIn:    { geonameId: number; name: string } | null;
  channelId:  number | null;
}

export async function searchCities(q: string): Promise<CitySearchResult[]> {
  const data = await api.get<{ cities: CitySearchResult[] }>('/cities/search', { params: { q, locale: locale() } });
  return data.cities ?? [];
}

/** The Hilads city a picked search result plays in, created at its first pick. */
export async function pickCity(geonameId: number): Promise<City> {
  return toCity(await api.post<CityPayload>('/cities/pick', { geonameId, locale: locale() }));
}

/** One city by id; a merged city answers with the city it lives in now. Null when unknown. */
export async function fetchCityById(channelId: string | number): Promise<City | null> {
  try {
    return toCity(await api.get<CityPayload>(`/cities/by-id/${encodeURIComponent(String(channelId))}`, { params: { locale: locale() } }));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Set where I am (an account's city for the Daily, source manual): a city
 * (channelId) or a search pick (geonameId). Returns the city. Throws (429
 * city_change_limit after 10 changes a day).
 */
export async function setMyCity(target: { channelId: string | number } | { geonameId: number }): Promise<City> {
  return toCity(await api.post<CityPayload>('/me/city', { ...target, locale: locale() }));
}

// Raw shape returned by GET /channels - fields differ from the City type.
interface RawChannel {
  channelId:           string | number;
  city:                string;          // web: ch.city - city display name
  country:             string | null;
  timezone:            string | null;
  activeUsers?:        number;          // web: ch.activeUsers - online count
  messageCount?:       number;
  recentMessageCount?: number;          // messages in last 24 h - used for "most active" ranking
  eventCount?:         number;
  topicCount?:         number;
  challengeCount?:     number;
  memberCount?:        number;
  liveScore?:          number;
}

export async function fetchChannels(sort?: string): Promise<City[]> {
  const url = sort ? `/channels?sort=${encodeURIComponent(sort)}` : '/channels';
  const data = await api.get<{ channels: RawChannel[] }>(url);
  return (data.channels ?? []).map(ch => ({
    channelId:           String(ch.channelId),
    name:                ch.city,                                               // normalize city → name
    country:             ch.country ?? '',
    timezone:            ch.timezone ?? 'UTC',
    slug:                (ch.city ?? '').toLowerCase().replace(/\s+/g, '-'),
    onlineCount:         ch.activeUsers,                                        // normalize activeUsers → onlineCount
    messageCount:        ch.messageCount,
    recentMessageCount:  ch.recentMessageCount,
    eventCount:          ch.eventCount,
    topicCount:          ch.topicCount,
    challengeCount:      ch.challengeCount,
    memberCount:         ch.memberCount,
    liveScore:           ch.liveScore,
  }));
}

export async function fetchCityBySlug(slug: string): Promise<City | null> {
  // Backend returns { channelId, city, country, timezone, slug } where `city`
  // is the display name. Native `City` type uses `name`. Without the
  // normalisation here the screen reads `city.name` and gets undefined,
  // rendering only the flag emoji on deep-link entry. Mirrors the same
  // shape transform that resolveLocation() and fetchChannels() do.
  try {
    const data = await api.get<{
      channelId: string | number;
      city:      string;
      country:   string | null;
      timezone:  string | null;
      slug:      string;
    }>(`/cities/by-slug/${encodeURIComponent(slug)}`);
    const normalized: City = {
      channelId: String(data.channelId),
      name:      data.city,
      country:   data.country ?? '',
      timezone:  data.timezone ?? 'UTC',
      slug:      data.slug ?? slug,
    };
    console.log('[deeplink] fetchCityBySlug', { slug, channelId: normalized.channelId, name: normalized.name, country: normalized.country });
    return normalized;
  } catch (err) {
    console.log('[deeplink] fetchCityBySlug failed', { slug, err: String(err) });
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

export interface BootstrapResult {
  joinMessage:          Message | null;
  messages:             Message[];
  hasMore:              boolean;
  onlineUsers:          UserDTO[];
  onlineCount:          number;
  hasUnreadDMs:         boolean | null;  // null for guests
  unreadNotifications:  number | null;   // null for guests
  currentUser:          Record<string, unknown> | null;
}

/**
 * Single bootstrap call replacing:
 *   POST /join + GET /messages + GET /now +
 *   GET /city-events + GET /conversations/unread + GET /notifications/unread-count
 *
 * Returns everything needed to render the channel and initialize global state.
 * Auth-conditional fields (hasUnreadDMs, unreadNotifications, currentUser) are
 * null for guest users.
 */
export async function bootstrapChannel(
  channelId: string,
  sessionId: string,
  guestId: string,
  nickname: string,
  previousChannelId?: string,
): Promise<BootstrapResult> {
  const data = await api.post<BootstrapResult>(`/channels/${channelId}/bootstrap`, {
    sessionId,
    guestId,
    nickname,
    ...(previousChannelId ? { previousChannelId } : {}),
  });
  return {
    joinMessage:          data.joinMessage          ?? null,
    messages:             data.messages             ?? [],
    hasMore:              data.hasMore              ?? false,
    onlineUsers:          data.onlineUsers          ?? [],
    onlineCount:          data.onlineCount          ?? 0,
    hasUnreadDMs:         data.hasUnreadDMs         ?? null,
    unreadNotifications:  data.unreadNotifications  ?? null,
    currentUser:          data.currentUser          ?? null,
  };
}

export async function leaveChannel(channelId: string, sessionId: string): Promise<void> {
  await api.post(`/channels/${channelId}/leave`, { sessionId }).catch(() => {});
}

// POST /me/city - commit a manual city switch as users.current_city_id.
// Backend bypasses the two-signal rule and sets the city immediately. Errors
// are swallowed: the local UI switch is the source of truth for this frame;
// the next /location/resolve will reconcile if the backend write failed.
export async function setCurrentCity(channelId: string | number): Promise<void> {
  try {
    await api.post('/me/city', { channelId });
  } catch (err) {
    console.log('[me/city] failed', { channelId, err: String(err) });
  }
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

/** City crew member - canonical UserDTO from /channels/{id}/members. */
export type CityMember = UserDTO;

export interface CityMembersResult {
  members: CityMember[];
  total:   number;
  page:    number;
  hasMore: boolean;
}

export async function fetchCityMembers(
  channelId: string,
  opts: { page?: number; limit?: number; badge?: string | null; vibe?: string | null; mode?: string | null } = {},
): Promise<CityMembersResult> {
  const q = new URLSearchParams({ page: String(opts.page ?? 1), limit: String(opts.limit ?? 10) });
  if (opts.badge) q.set('badge', opts.badge);
  if (opts.vibe)  q.set('vibe',  opts.vibe);
  if (opts.mode)  q.set('mode',  opts.mode);
  return api.get<CityMembersResult>(`/channels/${channelId}/members?${q}`);
}

/** Badge + avatar for an arbitrary set of user IDs (not just message authors).
 *  Used to enrich the "here now" presence list, whose WS payload carries no
 *  avatar and whose users aren't guaranteed to be in the paginated crew list. */
export interface UserBadgeInfo {
  primaryBadge?:   Badge | null;
  contextBadge?:   Badge | null;
  vibe?:           string | null;
  mode?:           string | null;
  thumbAvatarUrl?: string | null;
  country?:        string | null;
}
export async function fetchMessageBadges(
  channelId: string,
  userIds: string[],
): Promise<Record<string, UserBadgeInfo>> {
  if (!userIds.length) return {};
  const qs = userIds.map(id => `ids[]=${encodeURIComponent(id)}`).join('&');
  try {
    const data = await api.get<{ badges?: Record<string, UserBadgeInfo> }>(`/channels/${channelId}/message-badges?${qs}`);
    return data.badges ?? {};
  } catch { return {}; }
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
  replyToMessageId?: string | null,
  mentions?: import('./mentions').MentionInput[],
): Promise<Message> {
  const body: Record<string, unknown> = { sessionId, guestId, nickname, content };
  if (replyToMessageId) body.replyToMessageId = replyToMessageId;
  if (mentions && mentions.length) body.mentions = mentions;
  return api.post<Message>(`/channels/${channelId}/messages`, body);
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

export async function toggleChannelReaction(
  channelId: string,
  messageId: string,
  emoji: string,
  guestId: string,
): Promise<Reaction[]> {
  const data = await api.post<{ reactions: Reaction[] }>(
    `/channels/${channelId}/messages/${messageId}/reactions`,
    { emoji, guestId },
  );
  return data.reactions;
}

// Edit a channel message (city / event / topic share the messages table, so a
// single endpoint handles all three). Backend checks ownership by user_id
// (registered) or guest_id (guest).
export async function editMessage(
  messageId: string,
  content: string,
  guestId?: string | null,
): Promise<{ content: string; editedAt: number }> {
  const body: Record<string, unknown> = { content };
  if (guestId) body.guestId = guestId;
  const data = await api.patch<{ content: string; editedAt: number }>(
    `/messages/${messageId}`,
    body,
  );
  return { content: data.content, editedAt: data.editedAt };
}

export async function deleteMessage(
  messageId: string,
  guestId?: string | null,
): Promise<{ deletedAt: number }> {
  const body: Record<string, unknown> = {};
  if (guestId) body.guestId = guestId;
  const data = await api.delete<{ deletedAt?: number; alreadyDeleted?: boolean }>(
    `/messages/${messageId}`,
    body,
  );
  return { deletedAt: data.deletedAt ?? Math.floor(Date.now() / 1000) };
}
