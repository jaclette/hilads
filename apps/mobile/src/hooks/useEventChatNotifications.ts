/**
 * useEventChatNotifications — always-on WS subscriptions for event chats.
 *
 * Mounted in RootLayoutInner so it stays active across all screens.
 *
 * On boot: fetches the user's events (created + participated) and joins their
 * WS rooms so newMessage events are received globally — not just when the
 * event/[id] screen is open.
 *
 * On newMessage for a subscribed event:
 *   - Own messages: ignored (no self-unread)
 *   - Active event screen open: ignored (useMessages handles live append)
 *   - Otherwise: increments per-event unread count + global DM badge
 */

import { useEffect, useRef, useCallback } from 'react';
import { socket } from '@/lib/socket';
import { fetchMyEvents } from '@/api/events';
import { useApp } from '@/context/AppContext';

export function useEventChatNotifications() {
  const {
    identity,
    sessionId,
    setUnreadDMs,
    setEventChatPreview,
    eventChatPreviews,
    activeEventId,
  } = useApp();

  const guestId  = identity?.guestId;
  const nickname = identity?.nickname ?? '';

  // Stable refs — avoid stale closures in WS handlers
  const myEventIdsRef        = useRef<Set<string>>(new Set());
  const guestIdRef           = useRef<string | undefined>(guestId);
  const sessionIdRef         = useRef<string | null>(sessionId);
  const nicknameRef          = useRef(nickname);
  const activeEventIdRef     = useRef<string | null>(activeEventId);
  const eventChatPreviewsRef = useRef(eventChatPreviews);

  guestIdRef.current           = guestId;
  sessionIdRef.current         = sessionId;
  nicknameRef.current          = nickname;
  activeEventIdRef.current     = activeEventId;
  eventChatPreviewsRef.current = eventChatPreviews;

  // Load all participating events and join their WS rooms
  const joinAll = useCallback(async () => {
    const sid = sessionIdRef.current;
    const gid = guestIdRef.current;
    if (!gid || !sid) {
      if (__DEV__) console.log('[eventChat] joinAll skipped — no guestId or sessionId');
      return;
    }
    if (__DEV__) console.log('[eventChat] joinAll — fetching events for guestId:', gid.slice(0, 8));
    try {
      const events = await fetchMyEvents(gid);
      myEventIdsRef.current = new Set(events.map(e => e.id));
      events.forEach(e => {
        socket.joinEvent(e.id, sid, nicknameRef.current);
        if (__DEV__) console.log('[eventChat] joined event room', e.id.slice(0, 8), e.title);
      });
      if (__DEV__) console.log('[eventChat] subscribed to', events.length, 'event rooms total');
    } catch (err) {
      if (__DEV__) console.warn('[eventChat] joinAll failed:', err);
    }
  }, []); // stable — uses refs only

  // Join on boot (once identity + sessionId are ready)
  useEffect(() => {
    if (guestId && sessionId) {
      if (__DEV__) console.log('[eventChat] joinAll triggered — identity ready (guestId:', guestId.slice(0, 8) + ')');
      joinAll();
    }
  }, [guestId, sessionId, joinAll]);

  // Re-join all rooms after WS reconnects
  useEffect(() => {
    const off = socket.on('connected', () => {
      if (__DEV__) console.log('[eventChat] joinAll triggered — WS connected');
      joinAll();
    });
    return off;
  }, [joinAll]);

  // Also re-subscribe when the event rooms set might have changed (e.g. user joins a new event)
  // The event/[id].tsx calls toggleParticipation which changes participation state.
  // We refresh our room list whenever activeEventId becomes null (user left an event screen).
  useEffect(() => {
    if (activeEventId === null && guestId && sessionId) joinAll();
  }, [activeEventId, guestId, sessionId, joinAll]);

  // Listen for new messages in subscribed event rooms
  useEffect(() => {
    const handler = (data: Record<string, unknown>) => {
      // Backend sends { channelId: eventId, message } via broadcastMessageToWs.
      // The WS server re-emits it as { event: 'newMessage', channelId, message }.
      // City channels have integer channelIds; event channels are hex strings.
      // data.eventId is not set — we must read data.channelId.
      const rawId   = data.channelId ?? data.eventId;
      const channelId = typeof rawId === 'string' ? rawId : undefined;

      if (__DEV__) {
        console.log('[eventChat] newMessage received', {
          channelId,
          inMyEvents: channelId ? myEventIdsRef.current.has(channelId) : false,
          activeEventId: activeEventIdRef.current,
          myEventIds: [...myEventIdsRef.current].map(id => id.slice(0, 8)),
        });
      }

      if (!channelId || !myEventIdsRef.current.has(channelId)) return;

      const msg = data.message as { guestId?: string; content?: string } | undefined;

      // Ignore own messages
      if (msg?.guestId === guestIdRef.current) {
        if (__DEV__) console.log('[eventChat] skipping own message for', channelId.slice(0, 8));
        return;
      }

      // Ignore if user is actively viewing this event right now
      if (activeEventIdRef.current === channelId) {
        if (__DEV__) console.log('[eventChat] skipping — event screen is active for', channelId.slice(0, 8));
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

    const off1 = socket.on('newMessage', handler);
    const off2 = socket.on('message',    handler);
    return () => { off1(); off2(); };
  }, [setEventChatPreview, setUnreadDMs]);
}
