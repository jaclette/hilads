import { api } from './client';
import type { Topic, NowItem, HiladsEvent } from '@/types';

// Mixed feed: Hilads events + active topics, sorted by liveness.
// Returns { items: NowItem[] } — each item tagged with kind: 'event' | 'topic'.
export async function fetchNowFeed(channelId: string, guestId?: string): Promise<NowItem[]> {
  try {
    const data = await api.get<{ items: Record<string, unknown>[] }>(
      `/channels/${channelId}/now`,
      guestId ? { params: { guestId } } : undefined,
    );
    return (data.items ?? []).map(item => {
      if (item.kind === 'topic') {
        return item as unknown as NowItem;
      }
      // Normalise event field names (API returns `type`/`source` — align to HiladsEvent shape)
      return {
        ...item,
        kind:        'event',
        event_type:  (item.event_type ?? item.type) as HiladsEvent['event_type'],
        source_type: (item.source_type ?? item.source ?? 'hilads') as HiladsEvent['source_type'],
      } as unknown as NowItem;
    });
  } catch {
    return [];
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
