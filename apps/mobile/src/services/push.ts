/**
 * Push notification service — native (iOS / Android) via Expo.
 *
 * Flow:
 *   1. Request permission (once, after account is created / logged in)
 *   2. Get Expo push token (device-specific)
 *   3. Store token locally + register with backend
 *
 * Backend: POST /api/v1/push/mobile-token  { token, platform }
 *          DELETE /api/v1/push/mobile-token { token }
 */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, getAuthToken } from '@/api/client';
import { API_URL } from '@/constants';

const PUSH_TOKEN_KEY = 'hilads_push_token';
const PUSH_ASKED_KEY = 'hilads_push_asked';

// Log at module load so we can verify this file is executed and API_URL is correct.
// This runs once when the JS bundle is first evaluated.
console.log('[push-mobile] ── module loaded ─────────────────────────────');
console.log('[push-mobile] API_URL =', API_URL);
console.log('[push-mobile] platform =', Platform.OS);
console.log('[push-mobile] isDevice =', Device.isDevice);

// EAS project ID — required to get a valid Expo push token in production builds
const PROJECT_ID =
  (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ??
  '0555a464-8dda-484b-b0a2-d61b2ad2786c';

console.log('[push-mobile] PROJECT_ID =', PROJECT_ID);

// ── Android notification channel ──────────────────────────────────────────────
// NOTE: setNotificationHandler is set in NotificationHandler.tsx (mounted in
// _layout.tsx) so it can apply per-screen suppression logic. Do not set it
// here — only one handler is active at a time and the last call wins.

export async function setupNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  console.log('[push-mobile] setupNotificationChannel');
  await Notifications.setNotificationChannelAsync('default', {
    name:             'Hilads',
    importance:       Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor:       '#FF7A3C',
    showBadge:        true,
  });
  console.log('[push-mobile] Android channel "default" configured');
}

// ── Permission helpers ────────────────────────────────────────────────────────

export async function hasPushPermission(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
}

export async function hasBeenAsked(): Promise<boolean> {
  return (await AsyncStorage.getItem(PUSH_ASKED_KEY)) === '1';
}

// ── Register ──────────────────────────────────────────────────────────────────

/**
 * Request push permission and register this device.
 * Safe to call multiple times — no-ops if already registered.
 * Call after the user has a registered account (not for guests).
 */
export async function requestAndRegisterPush(): Promise<string | null> {
  console.log('[push-mobile] ── requestAndRegisterPush ────────────────────');
  console.log('[push-mobile] isDevice =', Device.isDevice, '| platform =', Platform.OS);
  console.log('[push-mobile] API_URL =', API_URL);
  console.log('[push-mobile] authToken present =',
    getAuthToken() !== null ? `yes (${getAuthToken()!.length} chars)` : 'NO — POST will get 401');

  if (!Device.isDevice) {
    console.log('[push-mobile] SKIP — not a physical device');
    return null;
  }

  // Always ensure the Android channel is set up before token acquisition.
  await setupNotificationChannel();

  await AsyncStorage.setItem(PUSH_ASKED_KEY, '1');

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  console.log('[push-mobile] permission status (existing):', existing);

  if (existing !== 'granted') {
    console.log('[push-mobile] requesting permission...');
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
    console.log('[push-mobile] permission status (after request):', finalStatus);
  }

  if (finalStatus !== 'granted') {
    console.warn('[push-mobile] STOP — permission not granted. Final status:', finalStatus);
    return null;
  }

  // ── Get Expo push token ──────────────────────────────────────────────────────
  console.log('[push-mobile] calling getExpoPushTokenAsync — projectId:', PROJECT_ID);
  let token: string;
  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID });
    token = result.data;
    console.log('[push-mobile] expo token =', token);
  } catch (err) {
    console.error('[push-mobile] getExpoPushTokenAsync FAILED:', String(err));
    return null;
  }

  const savedToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  console.log('[push-mobile] previously saved token:', savedToken ?? '(none)');
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);

  // ── Register with backend ────────────────────────────────────────────────────
  try {
    await registerTokenWithBackend(token);
  } catch (err) {
    console.error('[push-mobile] registerTokenWithBackend FAILED:', String(err));
    // Token obtained but not registered — caller can retry later.
  }

  return token;
}

export async function getSavedPushToken(): Promise<string | null> {
  return AsyncStorage.getItem(PUSH_TOKEN_KEY);
}

// ── Unregister (logout) ───────────────────────────────────────────────────────

export async function unregisterPushToken(): Promise<void> {
  const token = await getSavedPushToken();
  if (!token) return;
  console.log('[push-mobile] unregistering token from backend');
  await api
    .delete('/push/mobile-token', { token })
    .catch(err => console.warn('[push-mobile] unregister failed:', String(err)));
  await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
}

// ── Backend sync ──────────────────────────────────────────────────────────────
//
// Uses raw fetch (not api.post) so every step is logged explicitly.
// This bypasses the api wrapper to make network failures impossible to miss.

async function registerTokenWithBackend(token: string): Promise<void> {
  const authToken = getAuthToken();
  const fullUrl   = `${API_URL}/push/mobile-token`;
  const payload   = JSON.stringify({ token, platform: Platform.OS });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept':       'application/json',
  };
  if (authToken) {
    headers['Cookie'] = `hilads_token=${authToken}`;
  }

  console.log('[push-mobile] ── registerTokenWithBackend ──────────────────');
  console.log('[push-mobile] POST', fullUrl);
  console.log('[push-mobile] payload =', payload);
  console.log('[push-mobile] authToken present =',
    authToken !== null ? `yes (${authToken.length} chars)` : 'NO — will get 401');
  console.log('[push-mobile] headers =', JSON.stringify(headers));
  console.log('[push-mobile] fetch START...');

  let res: Response;
  try {
    res = await fetch(fullUrl, { method: 'POST', headers, body: payload });
  } catch (netErr) {
    // Network-level failure (no internet, DNS failure, connection refused, etc.)
    console.error('[push-mobile] NETWORK ERROR — fetch threw:', String(netErr));
    throw netErr;
  }

  console.log('[push-mobile] response status =', res.status);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = '(non-JSON or empty body)';
  }
  console.log('[push-mobile] response body =', JSON.stringify(body));

  if (!res.ok) {
    console.error('[push-mobile] POST FAILED — HTTP', res.status, JSON.stringify(body));
    throw new Error(`HTTP ${res.status}`);
  }

  console.log('[push-mobile] POST SUCCESS ✓ — token registered');
}
