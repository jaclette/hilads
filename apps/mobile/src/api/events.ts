import { api } from './client';
import type { HiladsEvent, Message, EventParticipant } from '@/types';

// ── Events ────────────────────────────────────────────────────────────────────

// Hilads events for a city — today's events (hilads-created, recurring included).
// Uses /channels/{id}/events which applies server-side "today" filtering in city timezone.
// NOTE: API returns `type` and `source` — normalised here to match HiladsEvent shape.
export async function fetchCityEvents(channelId: string): Promise<HiladsEvent[]> {
  const data = await api.get<{ events: Record<string, unknown>[] }>(
    `/channels/${channelId}/events`,
  );
  return (data.events ?? []).map(e => ({
    ...e,
    event_type: (e.event_type ?? e.type) as HiladsEvent['event_type'],
    source_type: (e.source_type ?? e.source ?? 'hilads') as HiladsEvent['source_type'],
  })) as HiladsEvent[];
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

export async function createEventSeries(
  channelId: string,
  guestId: string,
  payload: {
    title: string;
    start_time: string;       // "HH:MM"
    end_time: string;         // "HH:MM"
    type: string;
    recurrence_type: 'daily' | 'weekly' | 'every_n_days';
    weekdays?: number[];      // 0-6, required for weekly
    interval_days?: number;   // 2-365, required for every_n_days
    location_hint?: string;
  },
): Promise<{ series_id: string; first_event: HiladsEvent }> {
  return api.post(`/channels/${channelId}/event-series`, { guestId, ...payload });
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

// ── Event participants ────────────────────────────────────────────────────────
// GET /events/{id}/participants?sessionId={sid}
// Returns { participants, count, isIn } — mirrors web fetchEventParticipants(eventId, sessionId)
// isIn: whether the current session has joined (only present when sessionId is passed)

export async function fetchEventParticipants(
  eventId: string,
  sessionId?: string,
): Promise<{ participants: EventParticipant[]; count: number; isIn?: boolean }> {
  try {
    const data = await api.get<{ participants?: EventParticipant[]; count?: number; isIn?: boolean }>(
      `/events/${eventId}/participants`,
      sessionId ? { params: { sessionId } } : undefined,
    );
    return {
      participants: data.participants ?? [],
      count:        data.count ?? (data.participants?.length ?? 0),
      isIn:         data.isIn,
    };
  } catch {
    return { participants: [], count: 0 };
  }
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

export async function sendEventImageMessage(
  eventId: string,
  guestId: string,
  nickname: string,
  imageUrl: string,
): Promise<Message> {
  return api.post<Message>(`/events/${eventId}/messages`, {
    guestId,
    nickname,
    image_url: imageUrl,
    type: 'image',
  });
}
