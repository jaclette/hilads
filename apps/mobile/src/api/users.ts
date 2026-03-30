import { api } from './client';
import type { User, HiladsEvent } from '@/types';

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
