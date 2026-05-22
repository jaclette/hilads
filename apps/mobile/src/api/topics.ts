import { api } from './client';
import type { FeedItem, Topic, Message } from '@/types';

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

export async function fetchTopicMessages(topicId: string): Promise<{ messages: Message[]; hasMore: boolean }> {
  const data = await api.get<{ messages: Message[] }>(`/topics/${topicId}/messages`);
  return { messages: data.messages ?? [], hasMore: false };
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

export async function createTopic(
  channelId: string,
  guestId: string,
  title: string,
  description: string | null,
  category: string,
): Promise<Topic> {
  return api.post<Topic>(`/channels/${channelId}/topics`, {
    guestId,
    title,
    description,
    category,
  });
}
