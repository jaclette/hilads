/**
 * useGlobalDmNotifications — always-on WS subscriptions for DM conversations.
 *
 * Mounted in RootLayoutInner so it stays active across all screens.
 *
 * On boot: fetches the user's conversations and joins their WS rooms so
 * newConversationMessage events are received globally — not just when the
 * dm/[id] screen is open.
 *
 * On newConversationMessage for a subscribed conversation:
 *   - Own messages:          ignored (no self-unread)
 *   - Active DM thread open: ignored (useDMThread handles live append)
 *   - Otherwise:             increments global unreadDMs badge
 */

import { useEffect, useRef, useCallback } from 'react';
import { socket } from '@/lib/socket';
import { fetchConversations } from '@/api/conversations';
import { useApp } from '@/context/AppContext';

export function useGlobalDmNotifications() {
  const {
    account,
    setUnreadDMs,
    activeDmId,
  } = useApp();

  const accountIdRef      = useRef<string | undefined>(account?.id);
  const activeDmIdRef     = useRef<string | null>(activeDmId);
  const convIdsRef        = useRef<Set<string>>(new Set());

  accountIdRef.current  = account?.id;
  activeDmIdRef.current = activeDmId;

  // Load all conversations and join their WS rooms
  const joinAll = useCallback(async () => {
    const uid = accountIdRef.current;
    if (!uid) {
      // Expected during boot for guests and while auth is still hydrating for
      // registered users. Once setAccount() fires, the effect below re-triggers.
      if (__DEV__) console.log('[dmChat] joinAll skipped — no account (auth not yet hydrated)');
      return;
    }
    if (__DEV__) console.log('[dmChat] joinAll — fetching conversations for userId:', uid.slice(0, 8));
    try {
      const convs = await fetchConversations();
      convIdsRef.current = new Set(convs.map(c => c.id));
      convs.forEach(c => {
        socket.joinDm(c.id, uid);
        if (__DEV__) console.log('[dmChat] joined conversation', c.id.slice(0, 8), c.other_display_name);
      });
      // Override stale bootstrap flag with actual server state
      const unreadCount = convs.filter(c => c.has_unread).length;
      setUnreadDMs(unreadCount);
      if (__DEV__) console.log('[dmChat] subscribed to', convs.length, 'DM rooms, unread:', unreadCount);
    } catch (err) {
      if (__DEV__) console.warn('[dmChat] joinAll failed:', err);
    }
  }, [setUnreadDMs]);

  // Re-join WS rooms using cached IDs only — no HTTP fetch.
  // Used on WS reconnect where the conversation list hasn't changed.
  const rejoinCached = useCallback(() => {
    const uid = accountIdRef.current;
    if (!uid || convIdsRef.current.size === 0) return;
    if (__DEV__) console.log('[dmChat] rejoinCached —', convIdsRef.current.size, 'DM rooms');
    convIdsRef.current.forEach(id => socket.joinDm(id, uid));
  }, []); // stable — uses refs only

  // Join on boot (once account is ready — fires after auth hydration completes)
  useEffect(() => {
    if (account?.id) {
      if (__DEV__) console.log('[dmChat] joinAll triggered — account hydrated (userId:', account.id.slice(0, 8) + ')');
      joinAll();
    }
  }, [account?.id, joinAll]);

  // WS reconnect: re-join rooms from cache — no HTTP fetch needed.
  // The conversation list hasn't changed; the server just needs the joinDm signals again.
  useEffect(() => {
    const off = socket.on('connected', () => {
      if (__DEV__) console.log('[dmChat] WS reconnected — rejoining cached DM rooms');
      rejoinCached();
    });
    return off;
  }, [rejoinCached]);

  // Listen for new DMs in subscribed conversation rooms
  useEffect(() => {
    const handler = (data: Record<string, unknown>) => {
      const conversationId = data.conversationId as string | undefined;
      if (!conversationId) return;

      if (__DEV__) {
        console.log('[dmChat] newConversationMessage received', {
          conversationId: conversationId.slice(0, 8),
          activeDmId: activeDmIdRef.current?.slice(0, 8) ?? null,
        });
      }

      const msg = data.message as { sender_id?: string } | undefined;

      // Ignore own messages
      if (msg?.sender_id === accountIdRef.current) {
        if (__DEV__) console.log('[dmChat] skipping own message for', conversationId.slice(0, 8));
        return;
      }

      // Ignore if user is actively viewing this DM thread right now
      if (activeDmIdRef.current === conversationId) {
        if (__DEV__) console.log('[dmChat] skipping — DM thread active for', conversationId.slice(0, 8));
        return;
      }

      if (__DEV__) console.log('[dmChat] unread++', { conversationId: conversationId.slice(0, 8) });
      setUnreadDMs(prev => prev + 1);
    };

    const off = socket.on('newConversationMessage', handler);
    return off;
  }, [setUnreadDMs]);
}
