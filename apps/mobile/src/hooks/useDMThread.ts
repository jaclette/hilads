import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchDmMessages, sendDmMessage, markDmRead } from '@/api/conversations';
import { socket } from '@/lib/socket';
import { useApp } from '@/context/AppContext';
import { track } from '@/services/analytics';
import type { DmMessage } from '@/types';

interface Result {
  messages: DmMessage[];   // newest first (inverted FlatList)
  loading:  boolean;
  sending:  boolean;
  error:    string | null;
  clearError: () => void;
  sendText: (content: string) => Promise<void>;
}

export function useDMThread(conversationId: string): Result {
  const { account, setActiveDmId } = useApp();
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [sending,  setSending]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const seenIds = useRef(new Set<string>());

  const addNew = useCallback((incoming: DmMessage[]) => {
    const fresh = incoming.filter(m => !seenIds.current.has(m.id));
    if (fresh.length === 0) return;
    fresh.forEach(m => seenIds.current.add(m.id));
    const sorted = [...fresh].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    ).reverse();
    setMessages(prev => [...sorted, ...prev]);
  }, []);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const msgs = await fetchDmMessages(conversationId);
        if (cancelled) return;
        seenIds.current = new Set(msgs.map(m => m.id));
        setMessages([...msgs].reverse());
        markDmRead(conversationId);
      } catch {
        if (!cancelled) setError('Failed to load messages');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [conversationId]);

  // WS — track active thread + live append
  // setActiveDmId tells the global DM hook to skip unread increments for this thread.
  // joinDm re-asserts membership (global hook also joins, but re-joining is harmless).
  // Do NOT leaveDm on unmount — the global hook owns the WS room subscription.
  useEffect(() => {
    setActiveDmId(conversationId);
    if (account) socket.joinDm(conversationId, account.id);
    const off = socket.on('newConversationMessage', (data) => {
      if (data.conversationId === conversationId && data.message) {
        addNew([data.message as DmMessage]);
        markDmRead(conversationId);
      }
    });
    return () => {
      off();
      setActiveDmId(null);
    };
  }, [conversationId, account, addNew, setActiveDmId]);

  // Polling fallback
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const msgs = await fetchDmMessages(conversationId);
        addNew(msgs);
      } catch { /* silent */ }
    }, 8_000);
    return () => clearInterval(id);
  }, [conversationId, addNew]);

  const sendText = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const msg = await sendDmMessage(conversationId, trimmed);
      addNew([msg]);
      track('dm_sent', { conversationId });
    } catch {
      setError('Failed to send message');
    } finally {
      setSending(false);
    }
  }, [conversationId, sending, addNew]);

  return { messages, loading, sending, error, clearError: () => setError(null), sendText };
}
