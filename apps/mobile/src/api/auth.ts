import { api } from './client';
import type { User } from '@/types';

export async function createGuestSession(nickname: string): Promise<{ guestId: string }> {
  return api.post('/guest/session', { nickname });
}

export async function authMe(): Promise<User | null> {
  try {
    const data = await api.get<{ user: User }>('/auth/me');
    return data.user ?? null;
  } catch {
    return null;
  }
}

export async function authLogin(
  email: string,
  password: string,
): Promise<{ user: User }> {
  return api.post('/auth/login', { email, password });
}

export async function authSignup(
  email: string,
  password: string,
  displayName: string,
  guestId: string,
): Promise<{ user: User }> {
  return api.post('/auth/signup', {
    email,
    password,
    display_name: displayName,
    guest_id: guestId,
  });
}

export async function authLogout(): Promise<void> {
  await api.post('/auth/logout').catch(() => {});
}

export async function updateProfile(
  fields: Partial<User>,
): Promise<{ user: User }> {
  return api.put('/profile', fields);
}
