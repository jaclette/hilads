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

// ── Android notification channel ──────────────────────────────────────────────

export async function setupNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name:             'Hilads',
    importance:       Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor:       '#FF7A3C',
    showBadge:        true,
  });
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
  if (!Device.isDevice) return null; // simulators don't support push

  await AsyncStorage.setItem(PUSH_ASKED_KEY, '1');

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID });
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    await registerTokenWithBackend(token);
    return token;
  } catch {
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
  await api
    .delete('/push/mobile-token', { token })
    .catch(() => {/* non-fatal */});
  await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
}

// ── Backend sync ──────────────────────────────────────────────────────────────

async function registerTokenWithBackend(token: string): Promise<void> {
  await api
    .post('/push/mobile-token', { token, platform: Platform.OS })
    .catch(() => {/* non-fatal */});
}
