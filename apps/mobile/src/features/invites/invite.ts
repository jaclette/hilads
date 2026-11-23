import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/api/client';

/**
 * Invitations (scoring v2). A link hilads.live/today?ref=CODE opened the app: the code
 * is kept until sign-up (sent as invite_code, the server credits the inviter once the
 * friend's first photo is approved) and the open is recorded (POST /invites/click).
 */
const KEY = 'hilads_invite_code';

export type Inviter = { username: string | null; displayName: string | null; photoUrl: string | null };
export type CrewFriend = { id: string; displayName: string | null; username: string | null; photoUrl: string | null; credited: boolean; joinedAt: number | null;
  /** joined (no photo yet) | played (a photo, no points: same phone, the cap...) | credited (+10). */
  status?: 'joined' | 'played' | 'credited' };
export type Crew = {
  code: string; link: string; count: number; max: number; bonus: boolean; season: string;
  /** Link opens this season; friends credited at most per season. */
  clicks?: number; perSeason?: number;
  points: { friend: number; crew: number }; friends: CrewFriend[];
};

/** A "ref" code in a URL or query string, else null. */
export function refFromUrl(url: string | null | undefined): string | null {
  const m = /[?&]ref=([A-Za-z0-9]{5,12})(?:&|#|$)/.exec(url ?? '');
  return m ? m[1].toUpperCase() : null;
}

/** Keep the code from a link that opened the app, and record the open. Never throws. */
export function captureInvite(url: string | null | undefined): void {
  const code = refFromUrl(url);
  if (!code) return;
  AsyncStorage.setItem(KEY, code).catch(() => {});
  api.post('/invites/click', { code }).catch(() => {});
}

export async function pendingInvite(): Promise<string | null> {
  try { return await AsyncStorage.getItem(KEY); } catch { return null; }
}

/** Who invited the account just created ("@minh invited you" on the welcome screen), for this run only. */
let welcomeInviter: string | null = null;
export function setWelcomeInviter(inviter: Inviter | null): void {
  welcomeInviter = inviter ? (inviter.username ? '@' + inviter.username : inviter.displayName ?? null) : null;
}
export function getWelcomeInviter(): string | null { return welcomeInviter; }

export function clearPendingInvite(): void {
  AsyncStorage.removeItem(KEY).catch(() => {});
}

export async function fetchInviter(code: string): Promise<Inviter | null> {
  try {
    const r = await api.get<{ inviter: Inviter }>(`/invites/${encodeURIComponent(code)}`);
    return r.inviter ?? null;
  } catch {
    return null;
  }
}

export function fetchCrew(): Promise<Crew> {
  return api.get<Crew>('/me/invite');
}
