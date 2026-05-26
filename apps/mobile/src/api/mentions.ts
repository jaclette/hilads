import { api } from './client';
import type { MentionRef } from '@/types';

export interface MentionSuggestion {
  userId?:      string;   // member suggestion
  guestId?:     string;   // online-guest suggestion (live-only)
  isGuest?:     boolean;
  username:     string;
  displayName:  string;
  avatarUrl:    string | null;
}

export type MentionContext = 'city' | 'event' | 'topic';

/** What the composer sends to the backend — username is resolved server-side on read.
 *  Member mentions carry userId; online-guest mentions carry guestId. */
export type MentionInput = { userId?: string; guestId?: string; offset: number; length: number };

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
