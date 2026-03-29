import { api, setAuthToken } from './client';
import { persistToken } from '@/services/session';
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
  const res = await api.post<{ user: User; token?: string }>('/auth/login', { email, password });
  // Persist token from response body — set-cookie headers are not reliably
  // exposed by React Native fetch on Android, so we carry the token in the body.
  if (res.token) {
    console.log('[auth] login: persisting session token from response body');
    setAuthToken(res.token);
    await persistToken();
  } else {
    console.warn('[auth] login: no token in response body — relying on set-cookie capture');
  }
  return res;
}

export async function authSignup(
  email: string,
  password: string,
  displayName: string,
  guestId: string,
): Promise<{ user: User }> {
  const res = await api.post<{ user: User; token?: string }>('/auth/signup', {
    email,
    password,
    display_name: displayName,
    guest_id: guestId,
  });
  if (res.token) {
    console.log('[auth] signup: persisting session token from response body');
    setAuthToken(res.token);
    await persistToken();
  } else {
    console.warn('[auth] signup: no token in response body — relying on set-cookie capture');
  }
  return res;
}

export async function authLogout(): Promise<void> {
  await api.post('/auth/logout').catch(() => {});
}

export async function updateProfile(
  fields: Partial<User>,
): Promise<{ user: User }> {
  return api.put('/profile', fields);
}
