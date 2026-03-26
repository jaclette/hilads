import { api } from './client';
import type { Notification } from '@/types';

export async function fetchNotifications(): Promise<{ notifications: Notification[]; unread_count: number }> {
  return api.get('/notifications');
}

export async function fetchUnreadCount(): Promise<number> {
  const data = await api.get<{ count: number }>('/notifications/unread-count');
  return data.count ?? 0;
}

export async function markNotificationsRead(ids?: number[]): Promise<void> {
  const body = ids ? { ids } : { all: true };
  await api.post('/notifications/mark-read', body).catch(() => {});
}
