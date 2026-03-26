import { api } from './client';
import type { City, Message } from '@/types';

// ── City / channel resolution ─────────────────────────────────────────────────

export async function resolveLocation(lat: number, lng: number): Promise<City> {
  return api.post<City>('/location/resolve', { lat, lng });
}

export async function fetchChannels(): Promise<City[]> {
  const data = await api.get<{ channels: City[] }>('/channels');
  return data.channels ?? [];
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
  return api.post<Message>(`/channels/${channelId}/messages`, {
    sessionId,
    guestId,
    nickname,
    image_url: imageUrl,
    type: 'image',
  });
}
