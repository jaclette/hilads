/**
 * NotificationHandler - mounts in root layout, no UI rendered.
 *
 * Responsibilities:
 * 1. Configure foreground notification display - suppress alert when user is
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
import { setupNotificationChannel, setupNotificationCategories } from '@/services/push';
import { acceptFriendRequest, declineFriendRequest } from '@/api/friendRequests';
import { resolveHangoutJoinRequest } from '@/api/topics';
import { acceptInvitation, ignoreInvitation } from '@/api/challenges';
import { track } from '@/services/analytics';

// ── Cold-start notification - resolved at module load ─────────────────────────
// Start this promise immediately when the module is first imported, BEFORE any
// component mounts. This gives it the maximum time to resolve and lets
// useAppBoot await it before deciding where to redirect on boot.

const _coldStartPromise = Notifications.getLastNotificationResponseAsync().catch(() => null);

// Cold-start is consumed exactly once across BOTH callers (useAppBoot via
// getColdStartNotificationRoute, and the component mount effect). The guard
// prevents double navigation AND double side-effects (e.g. an Accept action
// button firing its API call twice).
let _coldStartConsumed = false;

/**
 * Resolve the cold-start notification once. For a plain tap it returns the deep
 * link; for an action button (Join / Accept / Decline) it performs the action's
 * side-effect and returns the route to land on afterwards. Returns null if there
 * was no cold-start notification, or if it was already consumed by the other caller.
 */
async function consumeColdStart(): Promise<string | null> {
  const response = await _coldStartPromise;
  if (!response || _coldStartConsumed) return null;
  _coldStartConsumed = true;
  const data     = response.notification.request.content.data as NotifData;
  const actionId = response.actionIdentifier;
  if (actionId === 'accept' || actionId === 'decline' || actionId === 'join' || actionId === 'ignore') {
    return handleNotificationAction(data, actionId);
  }
  return resolveRoute(data);
}

/**
 * Returns the route the user should land on if they cold-started the app by
 * tapping a push notification (or an action button on it), or null otherwise.
 */
export async function getColdStartNotificationRoute(): Promise<string | null> {
  const route = await consumeColdStart();
  console.log('[push-nav] cold-start notification check → route:', route ?? 'none');
  return route;
}

// ── Active screen + account state ────────────────────────────────────────────
// Module-level mutable ref so the notification handler (called outside React)
// can read the current state without a closure/stale reference.

const activeScreen = {
  dmId:      null as string | null,
  eventId:   null as string | null,
  accountId: null as string | null, // current logged-in user - used to reject own-sender pushes
};

// ── Foreground display strategy ───────────────────────────────────────────────
// Suppress alert + sound when the user is already viewing the relevant screen.
// Always update the badge so the count stays accurate.

type NotifData = {
  type?:            string;
  conversationId?:  string;
  eventId?:         string;
  topicId?:         string;
  channelId?:       string;
  senderName?:      string;
  senderUserId?:    string; // set by backend for dm_message - used to reject own-sender pushes
  accepterUserId?:  string; // friend_request_accepted - the user who tapped Accept
  accepterName?:    string;
  requestId?:       string; // friend_request_received - id of the FriendRequest row
  viewerId?:        string;
  actorId?:         string;
  actorName?:       string;
  vibeId?:          number;
  challengeId?:     string; // challenge_invitation / takeon_request
  invitationId?:    string; // challenge_invitation - id of the invitation row
  inviterName?:     string;
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

// Handle an action button tapped on a push notification. Performs the side-effect
// (API call) and returns the route to navigate to afterwards, or null to stay put.
// Best-effort - API failures are logged, never thrown.
function handleNotificationAction(data: NotifData, action: string): string | null {
  console.log('[push-action]', action, '| type:', data.type ?? '(none)');
  track('notification_action', { type: data.type ?? 'unknown', action });

  // "Join" on a new-event push → open the event and auto-join there (the event
  // screen owns the join logic, so the button just deep-links with autojoin=1).
  if (action === 'join') {
    return data.type === 'new_event' && data.eventId ? `/event/${data.eventId}?autojoin=1` : null;
  }

  if (data.type === 'friend_request_received' && data.requestId) {
    const p = action === 'accept' ? acceptFriendRequest(data.requestId) : declineFriendRequest(data.requestId);
    p.catch(err => console.warn('[push-action] friend request failed:', String(err)));
    return null; // friend request resolves in-place; no navigation
  }

  if (data.type === 'join_request' && data.topicId && data.requestId) {
    resolveHangoutJoinRequest(data.topicId, data.requestId, action === 'accept' ? 'accept' : 'reject')
      .catch(err => console.warn('[push-action] join request failed:', String(err)));
    // After accepting, open the hangout so the host sees it actually worked.
    return action === 'accept' ? `/topic/${data.topicId}` : null;
  }

  // Personal challenge invitation. Accept runs the take-on path server-side
  // and we deep-link to the challenge so the invitee sees their pending review.
  // Ignore is silent.
  if (data.type === 'challenge_invitation' && data.invitationId) {
    if (action === 'accept') {
      acceptInvitation(data.invitationId)
        .catch(err => console.warn('[push-action] invitation accept failed:', String(err)));
      return data.challengeId ? `/challenge/${data.challengeId}` : null;
    }
    if (action === 'ignore') {
      ignoreInvitation(data.invitationId)
        .catch(err => console.warn('[push-action] invitation ignore failed:', String(err)));
      return null;
    }
  }

  return null;
}

function resolveRoute(data: NotifData): string | null {
  switch (data.type) {
    case 'dm_message':
      if (data.conversationId) {
        // conv param tells DM screen to open by conversationId directly (skip findOrCreateDM).
        // id segment is also the conversationId - only used as a URL segment / display key.
        const namePart = data.senderName ? `&name=${encodeURIComponent(data.senderName)}` : '';
        console.log('[push-nav] tapped DM notification with conversationId=', data.conversationId);
        return `/dm/${data.conversationId}?conv=${encodeURIComponent(data.conversationId)}${namePart}`;
      }
      return '/messages';

    case 'event_message':
    case 'event_join':
      if (data.eventId) return `/event/${data.eventId}`;
      return '/(tabs)/events';

    case 'new_event':
      if (data.eventId) return `/event/${data.eventId}`;
      return '/(tabs)/events';

    case 'mention':
      // Route to the message's context: event chat, pulse, or city chat.
      if (data.eventId) return `/event/${data.eventId}`;
      if (data.topicId) return `/topic/${data.topicId}`;
      return '/(tabs)/chat';

    case 'topic_message':
    case 'new_topic':
      if (data.topicId) return `/topic/${data.topicId}`;
      return '/(tabs)/events';

    case 'join_request':
      // Tapping the body (not an Accept/Decline action) opens the hangout, where
      // the request shows inline with Accept/Reject. Action buttons are handled
      // separately in handleNotificationAction.
      if (data.topicId) return `/topic/${data.topicId}`;
      return null;

    case 'channel_message':
    case 'city_join':
      // Deep link to the city chat tab - the user's current city channel.
      return '/(tabs)/chat';

    case 'vibe_received':
      // Open own profile on the Vibes tab - that's where the new vibe is visible.
      return '/(tabs)/me?tab=vibes';

    case 'profile_view':
      // Navigate to the viewer's profile so the recipient can see who visited.
      if (data.viewerId) return `/user/${data.viewerId}`;
      return null;

    case 'friend_request_received':
      // Open the inbox so the user can accept/decline.
      return '/friend-requests';

    case 'friend_request_accepted':
      // Open the accepter's profile - the recipient just gained a friend.
      if (data.accepterUserId) return `/user/${data.accepterUserId}`;
      return '/(tabs)/me?tab=friends';

    case 'friend_added':
      // Legacy notification rows from before the request flow shipped.
      // Keep deep-linking to the adder's profile so old pushes still work.
      if (data.senderUserId) return `/user/${data.senderUserId}`;
      return null;

    case 'challenge_invitation':
      // Tap on the body (no action button) → open the challenge page; user can
      // take it on there with the standard CTA. Action buttons (Accept / Ignore)
      // are handled separately in handleNotificationAction.
      if (data.challengeId) return `/challenge/${data.challengeId}`;
      return null;

    case 'challenge_message':
      // New message in a challenge channel - deep link to that channel's
      // chat. The per-channel ChallengeNotificationPill controls who gets
      // the push in the first place, so by definition the recipient opted
      // into being pulled back here.
      if (data.challengeId) return `/challenge/${data.challengeId}`;
      return null;

    case 'rating_received':
      // FIRST rating from the counterparty just landed. The
      // RatePromptLaunchGate, mounted globally, refetches its prompts on
      // app foreground (AppState 'active'), and surfaces the RateSheet
      // automatically. Tap deep-links to the challenge as the visible
      // context - the sheet appears over whatever screen renders.
      if (data.challengeId) return `/challenge/${data.challengeId}`;
      return null;

    case 'challenge_rated_complete':
      // SECOND rating landed → ScoreCelebrationLaunchGate surfaces the
      // "+points" popin via the mutual_rating_complete WS event /
      // /me/score-celebration refetch on foreground. Tap deep-links to
      // the challenge so the popin renders on a coherent context.
      if (data.challengeId) return `/challenge/${data.challengeId}`;
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
  // (runs on every render, which is intentional - no useEffect needed)
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
    setupNotificationCategories();

    consumeColdStart().then(route => {
      if (route) {
        console.log('[push-nav] cold-start route stored in pendingRoute:', route);
        pendingRoute.current = route;
      }
    });

    // Foreground received listener - logs incoming notifications while app is open
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

      // Action button tapped (Join / Accept / Decline) → run its side-effect,
      // then navigate to the route it returns (Join → event, Accept → hangout).
      const actionId = response.actionIdentifier;
      if (actionId === 'accept' || actionId === 'decline' || actionId === 'join' || actionId === 'ignore') {
        const actionRoute = handleNotificationAction(data, actionId);
        if (actionRoute) {
          if (bootingRef.current) pendingRoute.current = actionRoute;
          else router.push(actionRoute as Parameters<typeof router.push>[0]);
        }
        return;
      }

      console.log('[push-nav] notification tapped | type:', data.type ?? '(none)',
        '| conversationId:', data.conversationId ?? '-',
        '| eventId:', data.eventId ?? '-');
      const route = resolveRoute(data);
      console.log('[push-nav] resolved route:', route ?? 'none - ignoring');
      if (!route) return;
      track('notification_opened', { type: data.type ?? 'unknown' });
      if (bootingRef.current) {
        console.log('[push-nav] app still booting - storing route for deferred navigation:', route);
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
