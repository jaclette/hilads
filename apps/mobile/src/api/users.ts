import { api } from './client';
import type { User } from '@/types';

export async function fetchPublicProfile(userId: string): Promise<User> {
  const data = await api.get<{ user: User }>(`/users/${userId}`);
  return data.user;
}
