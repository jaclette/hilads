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
import { api } from '@/api/client';

const PUSH_TOKEN_KEY = 'hilads_push_token';
const PUSH_ASKED_KEY = 'hilads_push_asked';

// EAS project ID — required to get a valid Expo push token in production builds
const PROJECT_ID =
  (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ??
  '0555a464-8dda-484b-b0a2-d61b2ad2786c';

// ── Foreground notification handler ───────────────────────────────────────────
//
// Must be set at module load — before any notification can arrive.
// Without this Expo silently drops notifications received while the app is open.
// For background / terminated state Android handles it natively via FCM.

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  true,
  }),
});

// ── Android notification channel ──────────────────────────────────────────────

export async function setupNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  console.log('[push] setupNotificationChannel');
  await Notifications.setNotificationChannelAsync('default', {
    name:             'Hilads',
    importance:       Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor:       '#FF7A3C',
    showBadge:        true,
  });
  console.log('[push] Android channel "default" configured (importance MAX)');
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
  console.log('[push-mobile] requestAndRegisterPush — isDevice:', Device.isDevice, 'platform:', Platform.OS);
  if (!Device.isDevice) {
    console.log('[push-mobile] skipping — not a physical device');
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
    console.warn('[push-mobile] permission NOT granted — aborting token registration. Final status:', finalStatus);
    return null;
  }

  console.log('[push-mobile] permission granted — calling getExpoPushTokenAsync (projectId:', PROJECT_ID, ')');
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID });
    console.log('[push-mobile] expo token =', token);

    const savedToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    console.log('[push-mobile] previously saved token:', savedToken ?? '(none)');
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);

    await registerTokenWithBackend(token);
    return token;
  } catch (err) {
    console.error('[push-mobile] getExpoPushTokenAsync FAILED:', String(err));
    return null;
  }
}

export async function getSavedPushToken(): Promise<string | null> {
  return AsyncStorage.getItem(PUSH_TOKEN_KEY);
}

// ── Unregister (logout) ───────────────────────────────────────────────────────

/**
 * Remove this device's push token from the backend.
 * Call on logout so the user stops receiving pushes on this device.
 */
export async function unregisterPushToken(): Promise<void> {
  const token = await getSavedPushToken();
  if (!token) return;
  console.log('[push] unregistering token from backend');
  await api
    .delete('/push/mobile-token', { token })
    .catch(err => console.warn('[push] unregister failed:', String(err)));
  await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
}

// ── Backend sync ──────────────────────────────────────────────────────────────

async function registerTokenWithBackend(token: string): Promise<void> {
  const payload = { token, platform: Platform.OS };
  console.log('[push-mobile] subscribing token to backend — payload:', JSON.stringify(payload));
  try {
    const res = await api.post<{ ok?: boolean }>('/push/mobile-token', payload);
    console.log('[push-mobile] subscribe response ok:', res?.ok ?? '(no body)');
  } catch (err) {
    console.error('[push-mobile] subscribe request FAILED:', String(err));
    // Re-throw so the caller can see registration failed
    throw err;
  }
}
