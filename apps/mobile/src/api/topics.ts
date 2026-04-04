import { api } from './client';
import type { FeedItem, HiladsEvent, Topic, Message } from '@/types';

// ── Now feed ──────────────────────────────────────────────────────────────────
// GET /channels/{id}/now → { items: FeedItem[], publicEvents: FeedItem[] }
// Backend returns a normalized DTO: events, topics, and public events with a
// consistent set of top-level fields (kind, title, description, active_now, …).
export async function fetchNowFeed(
  channelId: string,
  guestId?: string,
): Promise<{ items: FeedItem[]; publicEvents: HiladsEvent[] }> {
  try {
    const data = await api.get<{ items: FeedItem[]; publicEvents?: HiladsEvent[] }>(
      `/channels/${channelId}/now`,
      guestId ? { params: { guestId } } : undefined,
    );
    return { items: data.items ?? [], publicEvents: data.publicEvents ?? [] };
  } catch (err) {
    console.warn('[fetchNowFeed] failed:', err);
    return { items: [], publicEvents: [] };
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
  return api.get<Topic>(`/topics/${topicId}`);
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
): Promise<Message> {
  return api.post<Message>(`/topics/${topicId}/messages`, { guestId, nickname, content });
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
