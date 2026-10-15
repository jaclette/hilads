import { useEffect, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import { sendDeviceTimezone } from '@/api/daily';
import { getSavedPushToken } from '@/services/push';
import { deviceTimezone } from '@/lib/deviceTimezone';

/**
 * Sends the device's IANA timezone to the backend once per launch (and again
 * when the account changes), so Daily Challenge pushes land at local time.
 * Registered users store it on their account; guests on their push token.
 * Best effort - a failure only means the city timezone is used as fallback.
 */
export function useDeviceTimezone(): void {
  const { account, identity } = useApp();
  const sentFor = useRef<string | null>(null);

  useEffect(() => {
    const guestId = identity?.guestId ?? null;
    const key = account?.id ? `user:${account.id}` : guestId ? `guest:${guestId}` : null;
    const tz = deviceTimezone();
    if (!key || !tz || sentFor.current === key) return;
    sentFor.current = key;
    getSavedPushToken()
      .then(token => sendDeviceTimezone(tz, guestId, token))
      .catch(err => { console.warn('[daily] timezone send failed:', String(err)); sentFor.current = null; });
  }, [account?.id, identity?.guestId]);
}
