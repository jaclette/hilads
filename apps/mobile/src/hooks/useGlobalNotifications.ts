/**
 * useGlobalNotifications — always-on WS listeners for unread counts.
 *
 * Mounted in RootLayoutInner so it stays active regardless of which tab/screen
 * is visible.
 *
 * Event routing:
 *   notification { type: 'dm_message' }   → unreadDMs     (global DM alert from server)
 *   notification { type: * (non-DM) }     → unreadNotifications
 *   newNotification                        → unreadNotifications
 *
 * DM unread from newConversationMessage is handled by useGlobalDmNotifications
 * (with own-message and active-thread guards).
 */

import { useEffect } from 'react';
import { socket } from '@/lib/socket';
import { useApp } from '@/context/AppContext';

export function useGlobalNotifications() {
  const { setUnreadDMs, setUnreadNotifications } = useApp();

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
