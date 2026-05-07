import { api } from './client';
import type { Notification } from '@/types';

export interface NotificationPreferences {
  dm_push:              boolean;
  event_message_push:   boolean;
  event_join_push:      boolean;
  new_event_push:       boolean;
  channel_message_push: boolean;
  city_join_push:       boolean;
  friend_request_push:  boolean;
  vibe_received_push:   boolean;
  profile_view_push:    boolean;
  topic_reply_push:     boolean;
  new_topic_push:       boolean;
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
