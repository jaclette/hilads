import { api } from './client';
import type { User, HiladsEvent, FriendUser } from '@/types';

export async function fetchPublicProfile(userId: string): Promise<User> {
  const data = await api.get<{ user: User }>(`/users/${userId}`);
  return data.user;
}

export async function fetchUserEvents(userId: string): Promise<HiladsEvent[]> {
  try {
    const data = await api.get<{ events: Record<string, unknown>[] }>(`/users/${userId}/events`);
    return (data.events ?? []).map(e => ({
      ...e,
      event_type: (e.event_type ?? e.type) as HiladsEvent['event_type'],
      source_type: (e.source_type ?? e.source ?? 'hilads') as HiladsEvent['source_type'],
    })) as HiladsEvent[];
  } catch {
    return [];
  }
}

export async function fetchUserFriends(
  userId: string,
  page = 1,
  limit = 20,
): Promise<{ friends: FriendUser[]; total: number; hasMore: boolean }> {
  const data = await api.get<{ friends: FriendUser[]; total: number; hasMore: boolean }>(
    `/users/${userId}/friends?page=${page}&limit=${limit}`,
  );
  return data;
}

export async function addFriend(userId: string): Promise<void> {
  await api.post(`/users/${userId}/friends`, {});
}

export async function removeFriend(userId: string): Promise<void> {
  await api.delete(`/users/${userId}/friends`);
}
