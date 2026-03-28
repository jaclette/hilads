import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchConversations, markDmRead } from '@/api/conversations';
import { socket } from '@/lib/socket';
import { useApp } from '@/context/AppContext';
import type { Conversation } from '@/types';

interface Result {
  conversations: Conversation[];
  loading:        boolean;
  error:          string | null;
  reload:         () => void;
  markAllRead:    () => void;
}

export function useConversations(): Result {
  const { setUnreadDMs, unreadDMs } = useApp();
  const unreadRef = useRef(unreadDMs);
  unreadRef.current = unreadDMs;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchConversations();
      setConversations(data);
      setUnreadDMs(data.filter(c => c.has_unread).length);
    } catch {
      setError('Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [setUnreadDMs]);

  useEffect(() => { load(); }, [load]);

  // Live updates: mark conversation as having unread when a new DM arrives
  useEffect(() => {
    const off = socket.on('newConversationMessage', (data) => {
      const conversationId = data.conversationId as string | undefined;
      if (!conversationId) return;
      setConversations(prev =>
        prev.map(c =>
          c.id === conversationId
            ? {
                ...c,
                has_unread:      true,
                last_message:    (data.message as { content?: string } | undefined)?.content,
                last_message_at: new Date().toISOString(),
              }
            : c,
        ),
      );
      setUnreadDMs(unreadRef.current + 1);
    });
    return off;
  }, [setUnreadDMs]);

  const markAllRead = useCallback(() => {
    setConversations(prev => {
      const unread = prev.filter(c => c.has_unread);
      unread.forEach(c => markDmRead(c.id)); // fire-and-forget
      return prev.map(c => c.has_unread ? { ...c, has_unread: false } : c);
    });
    setUnreadDMs(0);
  }, [setUnreadDMs]);

  return { conversations, loading, error, reload: load, markAllRead };
}
