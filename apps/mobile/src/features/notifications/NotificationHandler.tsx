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

// ── Cold-start notification — resolved at module load ─────────────────────────
// Start this promise immediately when the module is first imported, BEFORE any
// component mounts. This gives it the maximum time to resolve and lets
// useAppBoot await it before deciding where to redirect on boot.

const _coldStartPromise = Notifications.getLastNotificationResponseAsync().catch(() => null);

/**
 * Returns the deep-link route the user should land on if they cold-started the
 * app by tapping a push notification, or null if there was no such notification.
 * Safe to call multiple times — reuses the same single promise.
 */
export async function getColdStartNotificationRoute(): Promise<string | null> {
  const response = await _coldStartPromise;
  if (!response) return null;
  const route = resolveRoute(response.notification.request.content.data as NotifData);
  console.log('[push-nav] cold-start notification check → route:', route ?? 'none');
  return route;
}

// ── Active screen + account state ────────────────────────────────────────────
// Module-level mutable ref so the notification handler (called outside React)
// can read the current state without a closure/stale reference.

const activeScreen = {
  dmId:      null as string | null,
  eventId:   null as string | null,
  accountId: null as string | null, // current logged-in user — used to reject own-sender pushes
};

// ── Foreground display strategy ───────────────────────────────────────────────
// Suppress alert + sound when the user is already viewing the relevant screen.
// Always update the badge so the count stays accurate.

type NotifData = {
  type?:           string;
  conversationId?: string;
  eventId?:        string;
  topicId?:        string;
  channelId?:      string;
  senderName?:     string;
  senderUserId?:   string; // set by backend for dm_message — used to reject own-sender pushes
  actorId?:        string;
  actorName?:      string;
  vibeId?:         number;
};

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as NotifData;

    // Suppress push notifications that were sent by the current user.
    // This handles the case where a push token was re-assigned across accounts
    // (e.g. two accounts on one device) and a push intended for the recipient
    // arrives on the sender's device instead.
    const sentByMe = !!data.senderUserId && data.senderUserId === activeScreen.accountId;

    // Suppress if user is actively viewing the exact thread
    const suppress =
      sentByMe ||
      (data.type === 'dm_message'    && !!data.conversationId && data.conversationId === activeScreen.dmId) ||
      (data.type === 'event_message' && !!data.eventId        && data.eventId        === activeScreen.eventId);

    // SDK 53 / expo-notifications 0.31 split shouldShowAlert into
    // shouldShowBanner (top-of-screen toast) and shouldShowList (notif center).
    // Both must be set to keep prior behavior of "show the notification UI
    // unless the user is already looking at the conversation".
    return {
      shouldShowBanner: !suppress,
      shouldShowList:   !suppress,
      shouldPlaySound:  !suppress,
      shouldSetBadge:   true,
    };
  },
});

// ── Route resolver ────────────────────────────────────────────────────────────

function resolveRoute(data: NotifData): string | null {
  switch (data.type) {
    case 'dm_message':
      if (data.conversationId) {
        // conv param tells DM screen to open by conversationId directly (skip findOrCreateDM).
        // id segment is also the conversationId — only used as a URL segment / display key.
        const namePart = data.senderName ? `&name=${encodeURIComponent(data.senderName)}` : '';
        console.log('[push-nav] tapped DM notification with conversationId=', data.conversationId);
        return `/dm/${data.conversationId}?conv=${encodeURIComponent(data.conversationId)}${namePart}`;
      }
      return '/messages';

    case 'event_message':
    case 'event_join':
      if (data.eventId) return `/event/${data.eventId}`;
      return '/(tabs)/hot';

    case 'new_event':
      if (data.eventId) return `/event/${data.eventId}`;
      return '/(tabs)/hot';

    case 'topic_message':
    case 'new_topic':
      if (data.topicId) return `/topic/${data.topicId}`;
      return '/(tabs)/now';

    case 'channel_message':
    case 'city_join':
      // Deep link to the city chat tab — the user's current city channel.
      return '/(tabs)/chat';

    case 'vibe_received':
      // Open own profile on the Vibes tab — that's where the new vibe is visible.
      return '/(tabs)/me?tab=vibes';

    case 'profile_view':
      // Navigate to the viewer's profile so the recipient can see who visited.
      if (data.viewerId) return `/user/${data.viewerId}`;
      return null;

    default:
      return null;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NotificationHandler() {
  const { booting, account, activeDmId, activeEventId } = useApp();
  const pendingRoute = useRef<string | null>(null);

  // Keep module-level state in sync with React context
  // (runs on every render, which is intentional — no useEffect needed)
  activeScreen.dmId      = activeDmId;
  activeScreen.eventId   = activeEventId;
  activeScreen.accountId = account?.id ?? null;

  // Ref so the tap listener (set up once in useEffect([])) can read the current
  // booting value without a stale closure. Needed for background→foreground taps
  // where booting is already false by the time the notification is tapped.
  const bootingRef = useRef(booting);
  useEffect(() => { bootingRef.current = booting; }, [booting]);

  // On mount: set up channel + register cold-start route as fallback
  // (useAppBoot handles the actual navigation for returning users;
  //  this covers new-user / geo-flow paths where boot doesn't redirect)
  useEffect(() => {
    setupNotificationChannel();

    _coldStartPromise.then(response => {
      if (!response) return;
      const data  = response.notification.request.content.data as NotifData;
      const route = resolveRoute(data);
      if (route) {
        console.log('[push-nav] cold-start route stored in pendingRoute:', route);
        pendingRoute.current = route;
      }
    });

    // Foreground received listener — logs incoming notifications while app is open
    const receivedSub = Notifications.addNotificationReceivedListener(notification => {
      const data = notification.request.content.data as NotifData;
      const sentByMe = !!data.senderUserId && data.senderUserId === activeScreen.accountId;
      console.log('[notif] foreground notification received:',
        notification.request.content.title,
        '| type:', data.type ?? '(none)',
        '| sentByMe:', sentByMe,
        '| suppress:', sentByMe || (
          (data.type === 'dm_message'    && !!data.conversationId && data.conversationId === activeScreen.dmId) ||
          (data.type === 'event_message' && !!data.eventId        && data.eventId        === activeScreen.eventId)
        ),
      );
    });

    // Live tap listener (background → foreground, or foreground tap)
    // IMPORTANT: reads bootingRef.current (not the closed-over `booting`) so
    // background→foreground taps correctly see booting=false and navigate directly.
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data  = response.notification.request.content.data as NotifData;
      console.log('[push-nav] notification tapped | type:', data.type ?? '(none)',
        '| conversationId:', data.conversationId ?? '-',
        '| eventId:', data.eventId ?? '-');
      const route = resolveRoute(data);
      console.log('[push-nav] resolved route:', route ?? 'none — ignoring');
      if (!route) return;
      track('notification_opened', { type: data.type ?? 'unknown' });
      if (bootingRef.current) {
        console.log('[push-nav] app still booting — storing route for deferred navigation:', route);
        pendingRoute.current = route;
      } else {
        console.log('[push-nav] navigating to:', route);
        router.push(route as Parameters<typeof router.push>[0]);
      }
    });

    return () => { receivedSub.remove(); sub.remove(); };
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
