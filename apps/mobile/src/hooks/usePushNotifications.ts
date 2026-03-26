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
    // Only ask once — respect prior choice
    if (await hasBeenAsked()) return;
    if (await hasPushPermission()) return;
    await setupNotificationChannel();
    await requestAndRegisterPush();
  }, []);

  return { requestIfAppropriate };
}
