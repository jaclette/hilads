import { api, setAuthToken, getAuthToken } from './client';
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
  // If the token came in the response body, load it into the client explicitly.
  // If it came via Set-Cookie, client.ts already captured it into authToken.
  // Either way, always persist whatever token is now in memory to SecureStore
  // so the session survives app restarts.
  if (res.token) {
    setAuthToken(res.token);
  }
  await persistToken();
  console.log('[auth] login: token persisted to SecureStore =',
    getAuthToken() !== null ? `yes (${getAuthToken()!.length} chars)` : 'NO — no token received from server');
  return res;
}

/** Real-time username availability + format check for the @-handle picker. */
export async function checkUsernameAvailability(
  username: string,
): Promise<{ valid: boolean; available: boolean; reason: string | null }> {
  return api.get('/username/check', { params: { username } });
}

export async function authSignup(
  email: string,
  password: string,
  displayName: string,
  username: string,
  guestId: string,
  mode: string | null = null,
  /** Required by the backend (Apple G1.2 EULA gate). Caller must collect explicit consent. */
  eulaAccepted: boolean = false,
): Promise<{ user: User }> {
  const res = await api.post<{ user: User; token?: string }>('/auth/signup', {
    email,
    password,
    display_name:  displayName,
    username,
    guest_id:      guestId,
    mode,
    eula_accepted: eulaAccepted,
  });
  if (res.token) {
    setAuthToken(res.token);
  }
  await persistToken();
  console.log('[auth] signup: token persisted to SecureStore =',
    getAuthToken() !== null ? `yes (${getAuthToken()!.length} chars)` : 'NO — no token received from server');
  return res;
}

/**
 * Accept the EULA for the currently authenticated user. Used by the boot-time
 * re-prompt modal for users who registered before the moderation update.
 * Idempotent server-side — safe to call again.
 */
export async function acceptEula(): Promise<{ user: User }> {
  return api.post<{ user: User }>('/users/me/eula');
}

export async function authLogout(): Promise<void> {
  await api.post('/auth/logout').catch(() => {});
}

export async function deleteAccount(): Promise<void> {
  await api.delete('/auth/me');
}

export async function updateProfile(
  fields: Partial<User>,
): Promise<{ user: User }> {
  return api.put('/profile', fields);
}

export async function authForgotPassword(email: string): Promise<void> {
  await api.post('/auth/forgot-password', { email });
}

export async function authValidateResetToken(token: string): Promise<boolean> {
  const data = await api.get<{ valid: boolean }>(`/auth/reset-password/validate?token=${encodeURIComponent(token)}`);
  return data.valid === true;
}

export async function authResetPassword(
  token: string,
  password: string,
  passwordConfirmation: string,
): Promise<{ user: User }> {
  const res = await api.post<{ user: User; token?: string }>('/auth/reset-password', {
    token,
    password,
    password_confirmation: passwordConfirmation,
  });
  if (res.token) {
    setAuthToken(res.token);
  }
  await persistToken();
  return res;
}
