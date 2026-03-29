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
import { useCallback } from 'react';
import {
  requestAndRegisterPush,
  hasBeenAsked,
  hasPushPermission,
  setupNotificationChannel,
} from '@/services/push';

interface Result {
  /** Ask for push permission if not already asked and not already granted. */
  requestIfAppropriate: () => Promise<void>;
}

export function usePushNotifications(): Result {
  const requestIfAppropriate = useCallback(async () => {
    console.log('[push-hook] requestIfAppropriate called');
    await setupNotificationChannel();

    const granted = await hasPushPermission();
    const asked   = await hasBeenAsked();
    console.log('[push-hook] hasPushPermission =', granted, '| hasBeenAsked =', asked);

    if (granted) {
      // Already granted — re-sync token with backend (handles token refresh / new installs)
      console.log('[push-hook] permission already granted → re-syncing token with backend');
      await requestAndRegisterPush();
      return;
    }

    if (asked) {
      // Previously asked but not granted — do not prompt again, but still try to register
      // in case permission was manually enabled in Settings after the initial ask.
      console.log('[push-hook] already asked, permission not granted — attempting silent re-register');
      await requestAndRegisterPush();
      return;
    }

    console.log('[push-hook] first time asking → calling requestAndRegisterPush');
    await requestAndRegisterPush();
  }, []);

  return { requestIfAppropriate };
}
