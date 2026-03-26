/**
 * NotificationHandler — mounts in root layout, no UI rendered.
 *
 * Responsibilities:
 * 1. Set up the foreground notification display behaviour
 * 2. Listen for notification taps (background + killed → foreground)
 * 3. Handle cold-start notification routing (app opened from a push tap)
 * 4. Route to the correct screen based on notification data
 *
 * Uses the `router` singleton from expo-router (works outside navigator hooks).
 */
import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { setupNotificationChannel } from '@/services/push';
import { track } from '@/services/analytics';

// ── Foreground display strategy ───────────────────────────────────────────────
// Show banner + badge + sound even when the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  true,
  }),
});

// ── Route resolver ────────────────────────────────────────────────────────────

type NotifData = {
  type?: string;
  conversationId?: string;
  senderName?: string;
  eventId?: string;
  channelId?: string;
};

function resolveRoute(data: NotifData): string | null {
  switch (data.type) {
    case 'dm_message':
      if (data.conversationId) {
        const name = data.senderName ? `&name=${encodeURIComponent(data.senderName)}` : '';
        return `/dm/${data.conversationId}?${name}`;
      }
      return '/(tabs)/messages';

    case 'event_message':
    case 'event_join':
      if (data.eventId) return `/event/${data.eventId}`;
      return '/(tabs)/hot';

    case 'new_event':
      return '/(tabs)/hot';

    default:
      return null;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NotificationHandler() {
  const { booting } = useApp();
  const pendingRoute = useRef<string | null>(null);

  // On mount: set up channel + check for cold-start notification
  useEffect(() => {
    setupNotificationChannel();

    Notifications.getLastNotificationResponseAsync().then(response => {
      if (!response) return;
      const data = response.notification.request.content.data as NotifData;
      const route = resolveRoute(data);
      if (route) pendingRoute.current = route;
    });

    // Live tap listener (background → foreground, or foreground tap)
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as NotifData;
      const route = resolveRoute(data);
      if (route) {
        track('notification_opened', { type: data.type ?? 'unknown' });
        // If still booting, defer
        if (booting) {
          pendingRoute.current = route;
        } else {
          router.push(route as Parameters<typeof router.push>[0]);
        }
      }
    });

    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Execute deferred navigation once boot completes
  useEffect(() => {
    if (!booting && pendingRoute.current) {
      const route = pendingRoute.current;
      pendingRoute.current = null;
      // Small delay to ensure navigation is ready
      setTimeout(() => {
        router.push(route as Parameters<typeof router.push>[0]);
      }, 100);
    }
  }, [booting]);

  return null;
}
