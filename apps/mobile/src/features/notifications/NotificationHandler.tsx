/**
 * NotificationHandler — mounts in root layout, no UI rendered.
 *
 * Responsibilities:
 * 1. Configure foreground notification display — suppress alert when user is
 *    already viewing the relevant screen (avoids redundant banners)
 * 2. Listen for notification taps (background + killed → foreground)
 * 3. Handle cold-start notification routing (app opened from a push tap)
 * 4. Route to the correct screen based on notification payload
 *
 * Uses the `router` singleton from expo-router (works outside navigator hooks).
 */
import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { setupNotificationChannel } from '@/services/push';
import { track } from '@/services/analytics';

// ── Active screen state ───────────────────────────────────────────────────────
// Module-level mutable ref so the notification handler (called outside React)
// can read the current active screen without a closure/stale reference.

const activeScreen = {
  dmId:    null as string | null,
  eventId: null as string | null,
};

// ── Foreground display strategy ───────────────────────────────────────────────
// Suppress alert + sound when the user is already viewing the relevant screen.
// Always update the badge so the count stays accurate.

type NotifData = {
  type?:           string;
  conversationId?: string;
  eventId?:        string;
  channelId?:      string;
  senderName?:     string;
};

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as NotifData;

    // Suppress if user is actively viewing the exact thread
    const suppress =
      (data.type === 'dm_message'    && !!data.conversationId && data.conversationId === activeScreen.dmId) ||
      (data.type === 'event_message' && !!data.eventId        && data.eventId        === activeScreen.eventId);

    return {
      shouldShowAlert: !suppress,
      shouldPlaySound: !suppress,
      shouldSetBadge:  true,
    };
  },
});

// ── Route resolver ────────────────────────────────────────────────────────────

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
      if (data.eventId) return `/event/${data.eventId}`;
      return '/(tabs)/hot';

    default:
      return null;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NotificationHandler() {
  const { booting, activeDmId, activeEventId } = useApp();
  const pendingRoute = useRef<string | null>(null);

  // Keep module-level state in sync with React context
  // (runs on every render, which is intentional — no useEffect needed)
  activeScreen.dmId    = activeDmId;
  activeScreen.eventId = activeEventId;

  // On mount: set up channel + check for cold-start notification
  useEffect(() => {
    setupNotificationChannel();

    Notifications.getLastNotificationResponseAsync().then(response => {
      if (!response) return;
      const data  = response.notification.request.content.data as NotifData;
      const route = resolveRoute(data);
      if (route) pendingRoute.current = route;
    });

    // Live tap listener (background → foreground, or foreground tap)
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data  = response.notification.request.content.data as NotifData;
      const route = resolveRoute(data);
      if (!route) return;
      track('notification_opened', { type: data.type ?? 'unknown' });
      if (booting) {
        pendingRoute.current = route;
      } else {
        router.push(route as Parameters<typeof router.push>[0]);
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
      setTimeout(() => {
        router.push(route as Parameters<typeof router.push>[0]);
      }, 100);
    }
  }, [booting]);

  return null;
}
