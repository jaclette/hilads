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
console.log('[push-mobile] platform =', Platform.OS, '| version =', Platform.Version);
console.log('[push-mobile] isDevice =', Device.isDevice);
if (Platform.OS === 'ios') {
  console.log('[push-mobile] iOS device model =', Device.modelName ?? 'unknown');
  console.log('[push-mobile] iOS OS version =', Device.osVersion ?? 'unknown');
}

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
    console.log('[push-mobile] SKIP — not a physical device (simulator/emulator)');
    return null;
  }

  // Always ensure the Android channel is set up before token acquisition.
  await setupNotificationChannel();

  await AsyncStorage.setItem(PUSH_ASKED_KEY, '1');

  const existing = await Notifications.getPermissionsAsync();
  let finalStatus = existing.status;
  console.log('[push-mobile] permission status (existing):', existing.status);
  if (Platform.OS === 'ios' && existing.ios) {
    console.log('[push-mobile] iOS granular status:', JSON.stringify(existing.ios));
  }

  if (existing.status !== 'granted') {
    console.log('[push-mobile] requesting permission...');
    // On iOS, explicitly request alert + badge + sound.
    // On Android, requestPermissionsAsync() does nothing before Android 13
    // and prompts for POST_NOTIFICATIONS on Android 13+; ios options are ignored.
    const requested = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
    finalStatus = requested.status;
    console.log('[push-mobile] permission status (after request):', finalStatus);
    if (Platform.OS === 'ios' && requested.ios) {
      console.log('[push-mobile] iOS granular status after request:', JSON.stringify(requested.ios));
    }
  }

  if (finalStatus !== 'granted') {
    console.warn('[push-mobile] STOP — permission not granted. Final status:', finalStatus);
    if (Platform.OS === 'ios') {
      console.warn('[push-mobile] iOS: user may have denied in Settings. Cannot re-prompt programmatically.');
    }
    return null;
  }

  // ── Get Expo push token ──────────────────────────────────────────────────────
  // On iOS, getExpoPushTokenAsync calls APNs under the hood.
  // The aps-environment entitlement in the signed binary must match the APNs
  // environment Expo routes to (development for internal builds, production for
  // store builds). EAS manages this automatically — do NOT hardcode aps-environment
  // in app.json or the entitlement will mismatch for internal/preview builds.
  console.log('[push-mobile] calling getExpoPushTokenAsync — projectId:', PROJECT_ID);
  if (Platform.OS === 'ios') {
    // Log the raw APNs device token for debugging — useful to verify APNs registration
    // is working before Expo wraps it.
    try {
      const deviceToken = await Notifications.getDevicePushTokenAsync();
      console.log('[push-mobile] iOS raw APNs device token type:', deviceToken.type, '| data length:', String(deviceToken.data).length);
    } catch (dtErr) {
      console.warn('[push-mobile] iOS getDevicePushTokenAsync failed (not fatal):', String(dtErr));
    }
  }
  let token: string;
  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID });
    token = result.data;
    console.log('[push-mobile] expo token =', token);
    if (Platform.OS === 'ios') {
      // Expo iOS tokens start with ExponentPushToken[ for managed workflow
      const looksValid = token.startsWith('ExponentPushToken[');
      console.log('[push-mobile] iOS token looks valid:', looksValid);
    }
  } catch (err) {
    console.error('[push-mobile] getExpoPushTokenAsync FAILED:', String(err));
    if (Platform.OS === 'ios') {
      console.error('[push-mobile] iOS: ensure aps-environment entitlement matches build type.');
      console.error('[push-mobile] iOS: do NOT hardcode aps-environment in app.json — let EAS manage it.');
    }
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
