import { useState, useEffect, useCallback } from 'react';
import { fetchNotifications, markNotificationsRead } from '@/api/notifications';
import { useApp } from '@/context/AppContext';
import type { Notification } from '@/types';

interface Result {
  notifications: Notification[];
  loading:       boolean;
  markAllRead:   () => void;
  reload:        () => void;
}

export function useNotifications(): Result {
  const { setUnreadDMs } = useApp();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading,       setLoading]       = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { notifications: data, unread_count } = await fetchNotifications();
      setNotifications(data);
      // Sync DM unread count from notification response
      const dmUnread = data.filter(n => n.type === 'dm_message' && !n.is_read).length;
      setUnreadDMs(dmUnread);
    } catch { /* silent — notifications are non-critical */ }
    finally { setLoading(false); }
  }, [setUnreadDMs]);

  useEffect(() => { load(); }, [load]);

  const markAllRead = useCallback(async () => {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadDMs(0);
    await markNotificationsRead();
  }, [setUnreadDMs]);

  return { notifications, loading, markAllRead, reload: load };
}
