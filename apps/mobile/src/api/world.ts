import { api } from './client';
import type { Message } from '@/types';
import type { MentionInput } from './mentions';
import type { HiHeader } from './channels';

// ── World channel (global companion channel) ────────────────────────────────

export async function fetchWorldMessages(
  opts: { beforeId?: string; limit?: number } = {},
): Promise<{ messages: Message[]; hasMore: boolean; hi?: HiHeader | null }> {
  // chat=1: the Hi chat's rows only and today's question; hi = the header's live counts.
  const q = new URLSearchParams({ limit: String(opts.limit ?? 50), chat: '1' });
  if (opts.beforeId) q.set('before_id', opts.beforeId);
  const data = await api.get<{ messages: Message[]; hasMore?: boolean; hi?: HiHeader | null }>(`/world/messages?${q}`);
  return { messages: data.messages ?? [], hasMore: data.hasMore ?? false, hi: data.hi ?? null };
}

export async function sendWorldMessage(
  guestId: string,
  nickname: string,
  content: string,
  mentions?: MentionInput[],
  replyToMessageId?: string | null,
): Promise<Message> {
  const body: Record<string, unknown> = { guestId, nickname, content };
  if (mentions && mentions.length) body.mentions = mentions;
  if (replyToMessageId) body.replyToMessageId = replyToMessageId;
  const r = await api.post<{ message: Message }>('/world/messages', body);
  return r.message;
}

// Toggle an emoji reaction on a World message (own endpoint; same shape as city).
export async function toggleWorldReaction(
  messageId: string,
  emoji: string,
  guestId: string,
): Promise<import('@/types').Reaction[]> {
  const data = await api.post<{ reactions: import('@/types').Reaction[] }>(
    `/world/messages/${messageId}/reactions`,
    { emoji, guestId },
  );
  return data.reactions ?? [];
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
