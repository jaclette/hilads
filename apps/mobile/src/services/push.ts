/**
 * Push notification service - native (iOS / Android) via Expo.
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
import { Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, getAuthToken } from '@/api/client';
import { API_URL } from '@/constants';
import i18n from '@/i18n';
import { appHeaders } from '@/lib/appVersion';
import { deviceTimezone } from '@/lib/deviceTimezone';
import { track } from '@/services/analytics';

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

// EAS project ID - required to get a valid Expo push token in production builds
const PROJECT_ID =
  (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ??
  '0555a464-8dda-484b-b0a2-d61b2ad2786c';

console.log('[push-mobile] PROJECT_ID =', PROJECT_ID);

// ── Android notification channel ──────────────────────────────────────────────
// NOTE: setNotificationHandler is set in NotificationHandler.tsx (mounted in
// _layout.tsx) so it can apply per-screen suppression logic. Do not set it
// here - only one handler is active at a time and the last call wins.

/** Android channel of the Daily Challenge morning push (permanent id, see setupNotificationChannel). */
export const DAILY_CHANNEL_ID = 'daily_challenge_v1';

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

  // Daily Challenge morning push (V2-07): its own channel with the signature
  // sound (assets/sounds/daily_signature.wav, bundled by the expo-notifications
  // plugin in app.json). Android never lets an app change a channel's sound
  // once created, so the id is permanent: a new sound needs a new file name
  // AND a new id (daily_challenge_v2, also in DailyPushes::SIGNATURE_CHANNEL),
  // and the old channel deleted here with deleteNotificationChannelAsync.
  await Notifications.setNotificationChannelAsync(DAILY_CHANNEL_ID, {
    name:             'Daily Challenge',
    importance:       Notifications.AndroidImportance.HIGH,
    sound:            'daily_signature.wav',
    vibrationPattern: [0, 250, 250, 250],
    lightColor:       '#FF7A3C',
    showBadge:        true,
  });
}

// ── Interactive notification categories (Accept / Decline action buttons) ──────
// Registered once at startup. The backend sends `categoryId` on friend-request
// and hangout-join-request pushes; the action response is handled in
// NotificationHandler.tsx (acts directly without opening the app).
export async function setupNotificationCategories(): Promise<void> {
  try {
    // Friend request: act in the background, never open the app.
    await Notifications.setNotificationCategoryAsync('friend_request', [
      { identifier: 'accept',  buttonTitle: 'Accept',  options: { opensAppToForeground: false } },
      { identifier: 'decline', buttonTitle: 'Decline', options: { opensAppToForeground: false, isDestructive: true } },
    ]);

    // Hangout join request: accepting opens the app and lands on the hangout so
    // the host sees it worked (otherwise it feels like nothing happened).
    // Declining stays silent in the background.
    await Notifications.setNotificationCategoryAsync('join_request', [
      { identifier: 'accept',  buttonTitle: 'Accept',  options: { opensAppToForeground: true } },
      { identifier: 'decline', buttonTitle: 'Decline', options: { opensAppToForeground: false, isDestructive: true } },
    ]);

    // New event in your city: one-tap Join opens the event and auto-joins it.
    // Reuses the already-translated event "join" label.
    await Notifications.setNotificationCategoryAsync('new_event', [
      { identifier: 'join', buttonTitle: i18n.t('join', { ns: 'event' }), options: { opensAppToForeground: true } },
    ]);

    // Personal challenge invitation: Accept opens the challenge (so the user
    // sees they're now in the take-on review queue). Ignore stays silent.
    await Notifications.setNotificationCategoryAsync('challenge_invitation', [
      { identifier: 'accept', buttonTitle: i18n.t('invitation.accept', { ns: 'challenge', defaultValue: 'Accept' }), options: { opensAppToForeground: true } },
      { identifier: 'ignore', buttonTitle: i18n.t('invitation.ignore', { ns: 'challenge', defaultValue: 'Ignore' }), options: { opensAppToForeground: false, isDestructive: true } },
    ]);

    // New-challenge offer (cross-city target / your-city new): take it on
    // straight from the push. Opens the app + lands on the challenge.
    await Notifications.setNotificationCategoryAsync('challenge_offer', [
      { identifier: 'accept', buttonTitle: i18n.t('invitation.acceptChallenge', { ns: 'challenge', defaultValue: 'Accept the challenge' }), options: { opensAppToForeground: true } },
    ]);
    console.log('[push-mobile] notification categories registered');
  } catch (e) {
    console.warn('[push-mobile] setNotificationCategoryAsync failed:', String(e));
  }
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
 * Safe to call multiple times - no-ops if already registered.
 * Pass `guestId` so the token is stored against the guest device too (a
 * logged-in user passes both → the row carries user_id + guest_id).
 *
 * `opts.prompt` (default true) controls whether the iOS/Android permission
 * dialog is shown when permission is still undetermined. Pass `prompt: false`
 * to register ONLY if the user has already granted permission - used for the
 * at-boot guest registration so a first launch never triggers an unsolicited
 * system prompt (product rule: no boot prompts). The real prompt happens on a
 * value-first moment instead (sign-in / sign-up).
 */
export async function requestAndRegisterPush(
  guestId?: string | null,
  opts: { prompt?: boolean } = {},
): Promise<string | null> {
  const prompt = opts.prompt !== false; // default: allowed to prompt
  console.log('[push-mobile] ── requestAndRegisterPush ────────────────────');
  console.log('[push-mobile] isDevice =', Device.isDevice, '| platform =', Platform.OS);
  console.log('[push-mobile] API_URL =', API_URL);
  console.log('[push-mobile] authToken present =',
    getAuthToken() !== null ? `yes (${getAuthToken()!.length} chars)` : 'NO - POST will get 401');

  if (!Device.isDevice) {
    console.log('[push-mobile] SKIP - not a physical device (simulator/emulator)');
    return null;
  }

  // Always ensure the Android channel is set up before token acquisition.
  await setupNotificationChannel();

  const existing = await Notifications.getPermissionsAsync();
  let finalStatus = existing.status;
  console.log('[push-mobile] permission status (existing):', existing.status);
  if (Platform.OS === 'ios' && existing.ios) {
    console.log('[push-mobile] iOS granular status:', JSON.stringify(existing.ios));
  }

  // Prompt suppressed (at-boot guest path): register only if already granted,
  // never show the system dialog. Bail quietly so the next value-first trigger
  // (sign-in / sign-up) can do the real ask.
  if (existing.status !== 'granted' && !prompt) {
    console.log('[push-mobile] permission not granted and prompt disabled - skipping (no boot prompt)');
    return null;
  }

  if (existing.status !== 'granted') {
    console.log('[push-mobile] requesting permission...');
    // Only mark "asked" when we actually show the dialog, so a suppressed
    // (prompt:false) pass never makes hasBeenAsked() lie.
    await AsyncStorage.setItem(PUSH_ASKED_KEY, '1');
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
    console.warn('[push-mobile] STOP - permission not granted. Final status:', finalStatus);
    if (Platform.OS === 'ios') {
      console.warn('[push-mobile] iOS: user may have denied in Settings. Cannot re-prompt programmatically.');
    }
    return null;
  }

  // ── Get Expo push token ──────────────────────────────────────────────────────
  // On iOS, getExpoPushTokenAsync calls APNs under the hood.
  // The aps-environment entitlement in the signed binary must match the APNs
  // environment Expo routes to (development for internal builds, production for
  // store builds). EAS manages this automatically - do NOT hardcode aps-environment
  // in app.json or the entitlement will mismatch for internal/preview builds.
  console.log('[push-mobile] calling getExpoPushTokenAsync - projectId:', PROJECT_ID);
  if (Platform.OS === 'ios') {
    // Log the raw APNs device token for debugging - useful to verify APNs registration
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
      console.error('[push-mobile] iOS: do NOT hardcode aps-environment in app.json - let EAS manage it.');
    }
    return null;
  }

  const savedToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  console.log('[push-mobile] previously saved token:', savedToken ?? '(none)');
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);

  // ── Register with backend ────────────────────────────────────────────────────
  try {
    await registerTokenWithBackend(token, guestId);
  } catch (err) {
    console.error('[push-mobile] registerTokenWithBackend FAILED:', String(err));
    // Token obtained but not registered - caller can retry later.
  }

  return token;
}

export async function getSavedPushToken(): Promise<string | null> {
  return AsyncStorage.getItem(PUSH_TOKEN_KEY);
}

// ── Value-first ask (guests) ──────────────────────────────────────────────────

// One attempt per app session - a guest who declines is never nagged again in
// the same run, and a guest who accepts only re-syncs their token once.
let promptedThisSession = false;

/**
 * Ask an unregistered guest for push permission after they DO something real
 * (their first message). This is the "value-first moment" the boot-time
 * registration defers to: usePushRegistration passes prompt:false for guests so
 * a first launch never shows an unsolicited dialog, and sign-in/sign-up is the
 * trigger for accounts - but a guest who never registers has no trigger at all,
 * so their device never acquired a token and admin "All installs (+guests)"
 * broadcasts reached nobody.
 *
 * Passing guestId is REQUIRED: POST /push/mobile-token 401s without a user or a
 * guestId, and PushBroadcastService::guestTokens() only sees rows where
 * guest_id IS NOT NULL.
 *
 * Silent no-op when permission was already refused - iOS grants one dialog and
 * we don't spend it twice.
 */
export async function promptPushAfterAction(guestId?: string | null): Promise<void> {
  if (promptedThisSession) return;
  promptedThisSession = true;

  const granted = await hasPushPermission();
  if (!granted && (await hasBeenAsked())) {
    console.log('[push-mobile] value-first ask skipped - already asked, not granted');
    return;
  }
  // granted === true still runs: it re-registers the token, which restores a
  // guest_id row on a device that dropped its token at logout.
  await requestAndRegisterPush(guestId, { prompt: true });
}

// ── Daily Challenge ask (in context only, AUDIT Q9) ───────────────────────────

export type DailyPushResult = 'granted' | 'denied' | 'dismissed' | 'already';

/**
 * Ask for push in a Daily Challenge context (after the first posted proof, or
 * from the banner on the Daily card). An in-app pre-prompt comes first so the
 * single iOS system dialog is only spent on a "yes". If the user already
 * refused at the system level, offer the phone settings instead.
 * Tracks daily_push_permission { result, source }.
 */
export async function askDailyPush(source: 'first_proof' | 'banner' | 'remind_me', guestId?: string | null): Promise<DailyPushResult> {
  const t = (key: string) => i18n.t(key, { ns: 'daily' });
  if (await hasPushPermission()) {
    await requestAndRegisterPush(guestId, { prompt: false }).catch(() => null);
    return 'already';
  }
  const perm = await Notifications.getPermissionsAsync();
  const blocked = perm.status === 'denied' && perm.canAskAgain === false;

  const choice = await new Promise<boolean>((resolve) => {
    Alert.alert(
      t('push.askTitle'),
      blocked ? t('push.askBodyBlocked') : t('push.askBody'),
      [
        { text: t('push.notNow'), style: 'cancel', onPress: () => resolve(false) },
        { text: blocked ? t('push.openSettings') : t('push.yes'), onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });

  let result: DailyPushResult;
  if (!choice) {
    result = 'dismissed';
  } else if (blocked) {
    Linking.openSettings().catch(() => {});
    result = 'denied';
  } else {
    await requestAndRegisterPush(guestId, { prompt: true }).catch(() => null);
    result = (await hasPushPermission()) ? 'granted' : 'denied';
  }
  track('daily_push_permission', { result, source, blocked });
  return result;
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

async function registerTokenWithBackend(token: string, guestId?: string | null): Promise<void> {
  const authToken = getAuthToken();
  const fullUrl   = `${API_URL}/push/mobile-token`;
  // guestId lets the backend store the token for an unregistered device (and is
  // harmless for logged-in users - it just records which guest session backs them).
  // timezone: the device's IANA zone, so Daily Challenge pushes land at local time.
  // dailyChannel (Android): this build created the Daily channel, so the server may
  // send Daily pushes on it (with the signature sound) - Android drops a push sent
  // to a channel the phone doesn't have.
  const payload   = JSON.stringify({
    token, platform: Platform.OS, locale: i18n.language, guestId: guestId ?? undefined, timezone: deviceTimezone() ?? undefined,
    dailyChannel: Platform.OS === 'android' ? DAILY_CHANNEL_ID : undefined,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept':       'application/json',
    ...appHeaders(),
  };
  // Send auth via BOTH Cookie and Authorization: Bearer. iOS NSURLSession owns
  // its own cookie jar and silently strips manually-set Cookie headers, so a
  // Cookie-only request authenticates on Android but 401s on iOS - which is why
  // iOS devices never registered a token. Mirrors the api client (client.ts).
  if (authToken) {
    headers['Cookie']        = `hilads_token=${authToken}`;
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  console.log('[push-mobile] ── registerTokenWithBackend ──────────────────');
  console.log('[push-mobile] POST', fullUrl);
  console.log('[push-mobile] payload =', payload);
  console.log('[push-mobile] authToken present =',
    authToken !== null ? `yes (${authToken.length} chars)` : 'NO - will get 401');
  console.log('[push-mobile] headers =', JSON.stringify(headers));
  console.log('[push-mobile] fetch START...');

  let res: Response;
  try {
    res = await fetch(fullUrl, { method: 'POST', headers, body: payload });
  } catch (netErr) {
    // Network-level failure (no internet, DNS failure, connection refused, etc.)
    console.error('[push-mobile] NETWORK ERROR - fetch threw:', String(netErr));
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
    console.error('[push-mobile] POST FAILED - HTTP', res.status, JSON.stringify(body));
    throw new Error(`HTTP ${res.status}`);
  }

  console.log('[push-mobile] POST SUCCESS ✓ - token registered');
}
