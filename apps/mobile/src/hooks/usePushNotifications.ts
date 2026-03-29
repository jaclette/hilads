/**
 * Deferred push notification permission.
 *
 * Strategy: ask after the user has experienced value — specifically after
 * they sign in or after they've sent their first message. Don't ask on
 * first launch.
 *
 * Call `requestIfAppropriate()` at the right moments:
 *   - After successful sign-in / sign-up
 *   - After sending a first message
 *   - On Messages tab mount (registered users only)
 */
import { useCallback, useEffect } from 'react';
import {
  requestAndRegisterPush,
  hasBeenAsked,
  hasPushPermission,
  setupNotificationChannel,
} from '@/services/push';
import { getAuthToken } from '@/api/client';
import { API_URL } from '@/constants';

interface Result {
  /** Ask for push permission if not already asked and not already granted. */
  requestIfAppropriate: () => Promise<void>;
}

export function usePushNotifications(): Result {

  // ── Mount proof — confirms this hook is alive in the current render tree ────
  useEffect(() => {
    console.log('[push-hook] ── usePushNotifications MOUNTED ────────────────');
    console.log('[push-hook] API_URL =', API_URL);
    console.log('[push-hook] authToken at mount =',
      getAuthToken() !== null ? `yes (${getAuthToken()!.length} chars)` : 'NO');
  }, []);

  const requestIfAppropriate = useCallback(async () => {
    console.log('[push-hook] ── requestIfAppropriate called ──────────────────');
    console.log('[push-hook] API_URL =', API_URL);
    console.log('[push-hook] authToken =',
      getAuthToken() !== null ? `yes (${getAuthToken()!.length} chars)` : 'NO — push will get 401');

    await setupNotificationChannel();

    const granted = await hasPushPermission();
    const asked   = await hasBeenAsked();
    console.log('[push-hook] hasPushPermission =', granted, '| hasBeenAsked =', asked);

    if (granted) {
      console.log('[push-hook] permission granted → re-syncing token with backend');
      await requestAndRegisterPush();
      return;
    }

    if (asked) {
      // Previously asked — still attempt registration in case user enabled in Settings.
      console.log('[push-hook] already asked, not yet granted — attempting silent re-register');
      await requestAndRegisterPush();
      return;
    }

    console.log('[push-hook] first time asking → calling requestAndRegisterPush');
    await requestAndRegisterPush();
  }, []);

  return { requestIfAppropriate };
}
