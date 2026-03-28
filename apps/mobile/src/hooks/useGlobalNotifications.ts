/**
 * useGlobalNotifications — always-on WS listeners for unread counts.
 *
 * Mounted in RootLayoutInner so it stays active regardless of which tab/screen
 * is visible.
 *
 * Event routing:
 *   newConversationMessage → unreadDMs     (when inside a joined DM room)
 *   notification { type: 'dm_message' }   → unreadDMs     (global DM alert from server)
 *   notification { type: * (non-DM) }     → unreadNotifications
 *   newNotification                        → unreadNotifications
 *
 * The server sends `notification` events globally to all connected sockets for
 * DM messages; `newConversationMessage` is only sent to members of the
 * conversation room (joined via joinConversation). We handle both paths so the
 * badge updates regardless of whether the DM screen is open.
 */

import { useEffect } from 'react';
import { socket } from '@/lib/socket';
import { useApp } from '@/context/AppContext';

export function useGlobalNotifications() {
  const { setUnreadDMs, setUnreadNotifications } = useApp();

  // newConversationMessage — fired when inside an active conversation room
  useEffect(() => {
    const off = socket.on('newConversationMessage', () => {
      setUnreadDMs(prev => prev + 1);
    });
    return off;
  }, [setUnreadDMs]);

  // notification / newNotification — global server broadcast
  // Route dm_message type → message badge; everything else → bell badge
  useEffect(() => {
    const handler = (data: Record<string, unknown>) => {
      if (data.type === 'dm_message') {
        setUnreadDMs(prev => prev + 1);
      } else {
        setUnreadNotifications(prev => prev + 1);
      }
    };
    const off1 = socket.on('notification',    handler);
    const off2 = socket.on('newNotification', handler);
    return () => { off1(); off2(); };
  }, [setUnreadDMs, setUnreadNotifications]);
}
