import { api } from './client';
import type { Notification } from '@/types';

export interface NotificationPreferences {
  dm_push:              boolean;
  event_message_push:   boolean;
  event_join_push:      boolean;
  new_event_push:       boolean;
  new_challenge_push:   boolean;
  mention_push:         boolean;
  channel_message_push: boolean;
  city_join_push:       boolean;
  world_arrival_push:   boolean;
  friend_request_push:  boolean;
  vibe_received_push:   boolean;
  profile_view_push:    boolean;
  topic_reply_push:     boolean;
  new_topic_push:       boolean;
  admin_announcement_push: boolean;
  comment_push?:        boolean;   // comments on my photos and threads I joined (absent: an older API)
  // V6 (absent: an older API)
  friend_arrival_push?: boolean;
  join_request_push?:   boolean;
  daily_challenge_push?: boolean;
  like_push?:           boolean;
  results_push?:        boolean;
  rank_push?:           boolean;
  stamp_push?:          boolean;
  reminder_push?:       boolean;
  quiet_start?:         number | null;   // minutes of the day, local time
  quiet_end?:           number | null;
}

export async function fetchNotifications(
  limit = 50,
  offset = 0,
): Promise<{ notifications: Notification[]; unread_count: number }> {
  return api.get(`/notifications?limit=${limit}&offset=${offset}`);
}

export async function fetchUnreadCount(): Promise<number> {
  const data = await api.get<{ count: number }>('/notifications/unread-count');
  return data.count ?? 0;
}

export async function markNotificationsRead(ids?: number[]): Promise<void> {
  const body = ids ? { ids } : { all: true };
  await api.post('/notifications/mark-read', body).catch(() => {});
}

export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  const data = await api.get<{ preferences: NotificationPreferences }>('/notification-preferences');
  return data.preferences;
}

export async function updateNotificationPreferences(
  prefs: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
  const data = await api.put<{ preferences: NotificationPreferences }>('/notification-preferences', prefs);
  return data.preferences;
}

// ── V6 inbox (grouped items, categories, counts) ─────────────────────────────

export type NotifCategory = 'social' | 'game' | 'plans' | 'city' | 'hilads';
export const NOTIF_CATEGORIES: NotifCategory[] = ['social', 'game', 'plans', 'city', 'hilads'];

export interface InboxActor { id: string | null; name: string; photoUrl: string | null }
export interface InboxItem {
  id:         number;
  ids:        number[];           // every row folded into this item (mark read / delete them all)
  category:   NotifCategory;
  type:       string;
  title:      string;
  body:       string | null;
  data:       Record<string, any>;
  actors:     InboxActor[];       // newest first, max 3
  count:      number;             // people (or rows) behind the item
  object:     { kind: 'photo'; id: string; date: string | null; thumbUrl: string | null }
            | { kind: 'plan'; id: string; title: string | null }
            | { kind: 'challenge'; date: string } | null;
  deep_link:  string | null;
  created_at: string;
  read:       boolean;
  seen:       boolean;
}
export interface NotifCounts {
  total:  number;
  unread: Record<NotifCategory, number>;
  unseen: Record<NotifCategory, number>;
  badges: { chat: number; passport: number; ranks: number };
}

export async function fetchInbox(opts: { categories?: NotifCategory[]; cursor?: string | null; limit?: number; unseen?: boolean } = {}):
  Promise<{ items: InboxItem[]; nextCursor: string | null }> {
  const q = new URLSearchParams();
  if (opts.categories?.length) q.set('categories', opts.categories.join(','));
  if (opts.cursor) q.set('cursor', opts.cursor);
  if (opts.limit) q.set('limit', String(opts.limit));
  if (opts.unseen) q.set('unseen', '1');
  return api.get(`/notifications/inbox?${q.toString()}`);
}

export async function fetchNotifCounts(): Promise<NotifCounts> {
  return api.get('/notifications/counts');
}

export async function markNotificationsSeen(body: { ids?: number[]; categories?: NotifCategory[] }): Promise<void> {
  await api.post('/notifications/seen', body).catch(() => {});
}

export async function markNotificationsUnread(ids: number[]): Promise<void> {
  await api.post('/notifications/mark-unread', { ids }).catch(() => {});
}

export async function deleteNotifications(ids: number[]): Promise<void> {
  await api.post('/notifications/delete', { ids }).catch(() => {});
}

/** Mark read every unread notification of these types (opening a tab clears its badge). */
export async function markNotificationTypesRead(types: string[]): Promise<void> {
  await api.post('/notifications/mark-read', { types }).catch(() => {});
}

/** Mark read every unread notification of these categories ("Mark all read" on a filter). */
export async function markNotificationCategoriesRead(categories: NotifCategory[]): Promise<void> {
  await api.post('/notifications/mark-read', { categories }).catch(() => {});
}
