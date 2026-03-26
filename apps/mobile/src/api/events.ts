import { api } from './client';
import type { HiladsEvent, Message } from '@/types';

// ── Events ────────────────────────────────────────────────────────────────────

export async function fetchCityEvents(channelId: string): Promise<HiladsEvent[]> {
  const data = await api.get<{ events: HiladsEvent[] }>(
    `/channels/${channelId}/city-events`,
  );
  return data.events ?? [];
}

export async function fetchMyEvents(guestId: string): Promise<HiladsEvent[]> {
  const data = await api.get<{ events: HiladsEvent[] }>('/users/me/events', {
    params: { guestId },
  });
  return data.events ?? [];
}

export async function fetchEventById(
  eventId: string,
): Promise<{ event: HiladsEvent; cityName: string; country: string; timezone: string } | null> {
  try {
    return await api.get(`/events/${encodeURIComponent(eventId)}`);
  } catch {
    return null;
  }
}

export async function createEvent(
  channelId: string,
  guestId: string,
  nickname: string,
  title: string,
  locationHint: string | undefined,
  startsAt: number,
  endsAt: number,
  type: string,
): Promise<HiladsEvent> {
  return api.post<HiladsEvent>(`/channels/${channelId}/events`, {
    guestId,
    nickname,
    title,
    starts_at: startsAt,
    ends_at: endsAt,
    type,
    location_hint: locationHint,
  });
}

export async function updateEvent(
  eventId: string,
  guestId: string,
  fields: Partial<{ title: string; location: string; starts_at: number; ends_at: number }>,
): Promise<HiladsEvent> {
  return api.put<HiladsEvent>(`/events/${eventId}`, { guestId, ...fields });
}

export async function deleteEvent(eventId: string, guestId: string): Promise<void> {
  await api.delete(`/events/${eventId}`, { guestId });
}

// ── Event participation ───────────────────────────────────────────────────────

export async function toggleEventParticipation(
  eventId: string,
  sessionId: string,
): Promise<{ count: number; isIn: boolean }> {
  return api.post(`/events/${eventId}/participants/toggle`, { sessionId });
}

// ── Event chat ────────────────────────────────────────────────────────────────

export async function fetchEventMessages(eventId: string): Promise<Message[]> {
  const data = await api.get<{ messages: Message[] }>(`/events/${eventId}/messages`);
  return data.messages ?? [];
}

export async function sendEventMessage(
  eventId: string,
  guestId: string,
  nickname: string,
  content: string,
): Promise<Message> {
  return api.post<Message>(`/events/${eventId}/messages`, { guestId, nickname, content });
}
