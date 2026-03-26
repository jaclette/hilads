/**
 * Push notification service.
 *
 * Handles permission request, Expo push token registration, and backend sync.
 *
 * Backend assumption: POST /push/mobile-token { token, platform }
 * This endpoint does not yet exist in the web-push backend. The call is made
 * silently (non-fatal). Add it when the backend is extended for native push.
 */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/api/client';

const PUSH_TOKEN_KEY  = 'hilads_push_token';
const PUSH_ASKED_KEY  = 'hilads_push_asked';

// ── Android notification channel ─────────────────────────────────────────────

export async function setupNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name:            'Hilads',
    importance:      Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor:      '#FF7A3C',
    showBadge:       true,
  });
}

// ── Permission + token ────────────────────────────────────────────────────────

export async function hasPushPermission(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
}

export async function hasBeenAsked(): Promise<boolean> {
  return (await AsyncStorage.getItem(PUSH_ASKED_KEY)) === '1';
}

/**
 * Request push permission and register the device token.
 * Safe to call multiple times — no-ops if already registered.
 * Returns the token string, or null if permission was denied or unavailable.
 */
export async function requestAndRegisterPush(): Promise<string | null> {
  // Physical device only — simulators don't support push
  if (!Device.isDevice) return null;

  await AsyncStorage.setItem(PUSH_ASKED_KEY, '1');

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );

    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    await syncTokenWithBackend(token);
    return token;
  } catch {
    return null;
  }
}

export async function getSavedPushToken(): Promise<string | null> {
  return AsyncStorage.getItem(PUSH_TOKEN_KEY);
}

// ── Backend sync ──────────────────────────────────────────────────────────────
// Backend endpoint: POST /api/v1/push/mobile-token
// Body: { token: string, platform: 'android' | 'ios' }
// NOTE: this endpoint needs to be added to the backend for native push.

async function syncTokenWithBackend(token: string): Promise<void> {
  await api
    .post('/push/mobile-token', { token, platform: Platform.OS })
    .catch(() => {/* non-fatal — backend may not support this yet */});
}
