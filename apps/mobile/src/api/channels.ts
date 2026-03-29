import { api } from './client';
import type { City, Message } from '@/types';

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

export async function fetchMessages(channelId: string): Promise<Message[]> {
  const data = await api.get<{ messages: Message[] }>(`/channels/${channelId}/messages`);
  return data.messages ?? [];
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
