import { api } from './client';
import type { HiladsEvent, Message, EventParticipant } from '@/types';

// ── Events ────────────────────────────────────────────────────────────────────

// Hilads events for a city — today's events (hilads-created, recurring included).
// Uses /channels/{id}/events which applies server-side "today" filtering in city timezone.
// Passing guestId embeds participant_count + is_participating per event, eliminating N+1 fetches.
// NOTE: API returns `type` and `source` — normalised here to match HiladsEvent shape.
export async function fetchCityEvents(channelId: string, guestId?: string): Promise<HiladsEvent[]> {
  const data = await api.get<{ events: Record<string, unknown>[] }>(
    `/channels/${channelId}/events`,
    guestId ? { params: { guestId } } : undefined,
  );
  return (data.events ?? []).map(e => ({
    ...e,
    event_type: (e.event_type ?? e.type) as HiladsEvent['event_type'],
    source_type: (e.source_type ?? e.source ?? 'hilads') as HiladsEvent['source_type'],
  })) as HiladsEvent[];
}

// Public (ticketmaster) events for a city — mirrors web fetchCityEvents().
// Endpoint: GET /channels/{id}/city-events
export async function fetchPublicCityEvents(channelId: string): Promise<HiladsEvent[]> {
  try {
    const data = await api.get<{ events: Record<string, unknown>[] }>(
      `/channels/${channelId}/city-events`,
    );
    return (data.events ?? []).map(e => ({
      ...e,
      event_type: (e.event_type ?? e.type) as HiladsEvent['event_type'],
      source_type: (e.source_type ?? e.source ?? 'ticketmaster') as HiladsEvent['source_type'],
    })) as HiladsEvent[];
  } catch {
    return [];
  }
}

// All Hilads + public events for the next N days — powers the Upcoming screen.
// Generates missing series occurrences server-side so days 2-7 are always populated.
export async function fetchUpcomingEvents(channelId: string, days = 7): Promise<HiladsEvent[]> {
  const data = await api.get<{ events: Record<string, unknown>[] }>(
    `/channels/${channelId}/events/upcoming`,
    { params: { days } },
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
  guestId?: string,
): Promise<{ event: HiladsEvent; cityName: string; country: string; timezone: string } | null> {
  try {
    return await api.get(
      `/events/${encodeURIComponent(eventId)}`,
      guestId ? { params: { guestId } } : undefined,
    );
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
  guestId?: string,
): Promise<{ participants: EventParticipant[]; count: number; isIn?: boolean }> {
  try {
    const data = await api.get<{ participants?: EventParticipant[]; count?: number; isIn?: boolean }>(
      `/events/${eventId}/participants`,
      // Send guestId (persistent) so isIn survives app restarts
      guestId ? { params: { guestId } } : undefined,
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
  guestId: string,
  nickname: string,
): Promise<{ count: number; isIn: boolean }> {
  // Send guestId (persistent across restarts) not sessionId (ephemeral)
  return api.post(`/events/${eventId}/participants/toggle`, { guestId, nickname });
}

// ── Event chat ────────────────────────────────────────────────────────────────

export async function fetchEventMessages(eventId: string): Promise<{ messages: Message[]; hasMore: boolean }> {
  const data = await api.get<{ messages: Message[] }>(`/events/${eventId}/messages`);
  return { messages: data.messages ?? [], hasMore: false };
}

export async function sendEventMessage(
  eventId: string,
  guestId: string,
  nickname: string,
  content: string,
  replyToMessageId?: string | null,
): Promise<Message> {
  const body: Record<string, unknown> = { guestId, nickname, content };
  if (replyToMessageId) body.replyToMessageId = replyToMessageId;
  return api.post<Message>(`/events/${eventId}/messages`, body);
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
