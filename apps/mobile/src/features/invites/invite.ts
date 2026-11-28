import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
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

/**
 * Android, first launch after a Play Store install: the store keeps the referrer of the link
 * that led to it (the /today landing sends ref=CODE in Play's `referrer`), so an invite
 * survives the store (Play Install Referrer API, via expo-application). Read once per install;
 * a code already kept (the app was opened by the link) wins. Never throws.
 */
const REFERRER_DONE = 'hilads_install_referrer_done';
const RAW_REFERRER = 'hilads_install_referrer';

/** The Play install referrer kept at first launch (Android), for the sign-up's source. */
export async function installReferrer(): Promise<string | null> {
  try { return await AsyncStorage.getItem(RAW_REFERRER); } catch { return null; }
}
export async function captureInstallReferrer(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    if (await AsyncStorage.getItem(REFERRER_DONE)) return;
    await AsyncStorage.setItem(REFERRER_DONE, '1');
    if (await AsyncStorage.getItem(KEY)) return;
    const referrer = await Promise.race([
      Application.getInstallReferrerAsync(),
      new Promise<string>(resolve => setTimeout(() => resolve(''), 5000)),
    ]);
    // The raw referrer goes with the sign-up too (Back office › a user's Sign-up: store, campaign).
    if (referrer) await AsyncStorage.setItem(RAW_REFERRER, String(referrer).slice(0, 300));
    const m = /(?:^|&)ref=([A-Za-z0-9]{5,12})(?:&|$)/.exec(decodeURIComponent(referrer ?? ''));
    if (m) await AsyncStorage.setItem(KEY, m[1].toUpperCase());
  } catch {
    // no Play Store (emulator, sideload) or the service is down: the same-network fallback stays
  }
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
