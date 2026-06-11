/**
 * useEventChatNotifications - always-on global unread badge for event chats.
 *
 * Mounted in RootLayoutInner so it stays active across all screens.
 *
 * How it works (since Jun 2026 redesign):
 *   The WS server enforces a SINGLE event room per socket (the join handler
 *   defensively evicts the socket from any other event room). Trying to
 *   join all subscribed events in a loop never worked - the user only ever
 *   ended up in the last event's room, and each loop iteration broadcast a
 *   participants_update cascade to whichever room got evicted. Net result:
 *   background-event unread badges silently did not work, and a WS storm
 *   fired on every screen transition (city switch, returning from event,
 *   etc).
 *
 *   Replaced with a per-user push: the PHP API now broadcasts
 *   'newEventMessage' to each participant's user channel directly when an
 *   event-chat message lands (see broadcastEventMessageToParticipants in
 *   backend/api/routes/api.php). The user channel supports multi-socket
 *   fan-out and doesn't conflict with the single-room event chat. This
 *   hook subscribes to that single WS event - one listener, no joins, no
 *   forEach loop, no participants_update broadcasts.
 *
 *   The active-event chat is handled separately by event/[id].tsx +
 *   useMessages; that path still uses joinEvent for the single screen the
 *   user is on.
 *
 * On 'newEventMessage' for an event:
 *   - Own messages: server-side filter excludes the sender already
 *   - Active event screen open: ignored (useMessages handles live append)
 *   - Otherwise: increments per-event unread count + global DM badge
 */

import { useEffect, useRef } from 'react';
import { socket } from '@/lib/socket';
import { useApp } from '@/context/AppContext';

export function useEventChatNotifications() {
  const {
    identity,
    setUnreadDMs,
    setEventChatPreview,
    eventChatPreviews,
    activeEventId,
  } = useApp();

  const guestId = identity?.guestId;

  // Stable refs - avoid stale closures in the WS handler
  const guestIdRef           = useRef<string | undefined>(guestId);
  const activeEventIdRef     = useRef<string | null>(activeEventId);
  const eventChatPreviewsRef = useRef(eventChatPreviews);

  guestIdRef.current           = guestId;
  activeEventIdRef.current     = activeEventId;
  eventChatPreviewsRef.current = eventChatPreviews;

  // Single global listener. Server pushes 'newEventMessage' to this user's
  // per-user channel for every event-chat message they're a participant of.
  useEffect(() => {
    const handler = (data: Record<string, unknown>) => {
      const channelId = typeof data.channelId === 'string' ? data.channelId : undefined;
      const msg = data.message as { guestId?: string; content?: string } | undefined;
      if (!channelId) return;

      // Belt-and-suspenders own-message guard. The server already excludes
      // the sender, but if the client's userId-matching missed an alias
      // (e.g. guest-id-only payload), still drop self echoes.
      if (msg?.guestId && msg.guestId === guestIdRef.current) {
        if (__DEV__) console.log('[eventChat] skipping own message for', channelId.slice(0, 8));
        return;
      }

      // Ignore if the user is actively viewing this event right now -
      // useMessages on that screen handles the live append.
      if (activeEventIdRef.current === channelId) {
        if (__DEV__) console.log('[eventChat] skipping - event screen is active for', channelId.slice(0, 8));
        return;
      }

      const preview   = msg?.content ?? '';
      const previewAt = new Date().toISOString();
      const current   = eventChatPreviewsRef.current[channelId];
      const newCount  = (current?.count ?? 0) + 1;

      if (__DEV__) {
        console.log('[eventChat] unread++', {
          eventId: channelId.slice(0, 8),
          preview: preview.slice(0, 40),
          count: newCount,
        });
      }

      setEventChatPreview(channelId, { count: newCount, preview, previewAt });
      // Bump the global DM badge so the header icon lights up
      setUnreadDMs(prev => prev + 1);
    };

    const off = socket.on('newEventMessage', handler);
    return off;
  }, [setEventChatPreview, setUnreadDMs]);
}
