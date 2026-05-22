import { api } from './client';
import type { MentionRef } from '@/types';

export interface MentionSuggestion {
  userId:      string;
  username:    string;
  displayName: string;
  avatarUrl:   string | null;
}

export type MentionContext = 'city' | 'event' | 'topic';

/** What the composer sends to the backend — username is resolved server-side on read. */
export type MentionInput = Pick<MentionRef, 'userId' | 'offset' | 'length'>;

/**
 * @mention autocomplete suggestions for a context. `channelId` is the city
 * numeric id (city) or the 16-hex id (event/topic). Registered, in-context users
 * only — the backend excludes guests and the caller.
 */
export async function fetchMentionSuggestions(
  context: MentionContext,
  channelId: string,
  q: string,
): Promise<MentionSuggestion[]> {
  const path = context === 'city'  ? `/channels/${channelId}/mention-suggestions`
             : context === 'event' ? `/events/${channelId}/mention-suggestions`
             :                       `/topics/${channelId}/mention-suggestions`;
  try {
    const data = await api.get<{ suggestions?: MentionSuggestion[] }>(path, { params: { q } });
    return data.suggestions ?? [];
  } catch {
    return [];
  }
}
