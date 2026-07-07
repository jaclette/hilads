import { api } from './client';
import type { Message } from '@/types';
import type { MentionInput } from './mentions';

// ── World channel (global companion channel) ────────────────────────────────

export interface WorldActivity {
  online: number;
  cities: number;
  crossCity: { count: number; cities: string[] };
}

export async function fetchWorldMessages(
  opts: { beforeId?: string; limit?: number } = {},
): Promise<{ messages: Message[]; hasMore: boolean }> {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.beforeId) q.set('before_id', opts.beforeId);
  const data = await api.get<{ messages: Message[]; hasMore?: boolean }>(`/world/messages?${q}`);
  return { messages: data.messages ?? [], hasMore: data.hasMore ?? false };
}

export async function sendWorldMessage(
  guestId: string,
  nickname: string,
  content: string,
  mentions?: MentionInput[],
): Promise<Message> {
  const body: Record<string, unknown> = { guestId, nickname, content };
  if (mentions && mentions.length) body.mentions = mentions;
  const r = await api.post<{ message: Message }>('/world/messages', body);
  return r.message;
}

export async function fetchWorldActivity(): Promise<WorldActivity> {
  return api.get<WorldActivity>('/world/activity');
}

export interface WorldChallenge {
  id: string;
  title: string;
  challenge_type: string;
  mode: string;
  country: string | null;
  target_country: string | null;
  creator_username: string | null;
  creator_display_name: string | null;
  creator_thumb_avatar_url: string | null;
}

// Recent international (cross-city) challenges for the World hero carousel.
export async function fetchWorldChallenges(): Promise<WorldChallenge[]> {
  try {
    const data = await api.get<{ challenges?: WorldChallenge[] }>('/world/challenges');
    return data.challenges ?? [];
  } catch {
    return [];
  }
}

// ALL international challenges worldwide (full card DTOs) for the "See all" screen.
export async function fetchWorldChallengesAll<T = unknown>(limit = 60): Promise<T[]> {
  try {
    const data = await api.get<{ challenges?: T[] }>(`/world/challenges/all?limit=${limit}`);
    return data.challenges ?? [];
  } catch {
    return [];
  }
}

export interface WorldArrival {
  nickname: string;
  guestId: string | null;
  userId: string | null;
  city: string | null;
  country: string | null;
  createdAt: number;
  thumbAvatarUrl: string | null;
}

export async function fetchWorldArrivals(): Promise<WorldArrival[]> {
  try {
    const data = await api.get<{ arrivals?: WorldArrival[] }>('/world/arrivals');
    return data.arrivals ?? [];
  } catch {
    return [];
  }
}

export async function fetchQuietContext(cityChannelId: string): Promise<{ cityQuiet: boolean; worldActive: boolean }> {
  try {
    return await api.get<{ cityQuiet: boolean; worldActive: boolean }>(`/world/quiet-context?city=${encodeURIComponent(cityChannelId)}`);
  } catch {
    return { cityQuiet: false, worldActive: false };
  }
}

// Mark a channel (city integer id or 'world') read up to now. Non-fatal.
export async function markChannelRead(channelId: string, guestId: string): Promise<void> {
  try {
    await api.post('/read', { channelId, guestId });
  } catch { /* unread is a convenience, never blocks the UI */ }
}

// Batch unread counts. channelIds = [cityChannelId, 'world']. → { [id]: count }
export async function fetchUnread(channelIds: string[], guestId: string): Promise<Record<string, number>> {
  const q = new URLSearchParams();
  for (const c of channelIds) q.append('channels[]', String(c));
  if (guestId) q.set('guestId', guestId);
  try {
    const data = await api.get<{ unread?: Record<string, number> }>(`/unread?${q}`);
    return data.unread ?? {};
  } catch {
    return {};
  }
}
