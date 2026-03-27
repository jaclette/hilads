import { useState, useEffect, useRef, useCallback } from 'react';
import { socket } from '@/lib/socket';
import { uploadFile } from '@/api/uploads';
import { track } from '@/services/analytics';
import type { Message } from '@/types';

interface Params {
  channelId:    string;
  loadFn:       () => Promise<Message[]>;
  postTextFn:   (content: string) => Promise<Message>;
  postImageFn:  (imageUrl: string) => Promise<Message>;
}

interface Result {
  messages:  Message[];   // newest first (for inverted FlatList)
  loading:   boolean;
  sending:   boolean;
  error:     string | null;
  clearError: () => void;
  sendText:  (content: string) => Promise<void>;
  sendImage: (localUri: string) => Promise<void>;
  reload:    () => void;
}

export function useMessages({ channelId, loadFn, postTextFn, postImageFn }: Params): Result {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [sending,  setSending]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // Track seen IDs to deduplicate WS + poll + send
  const seenIds = useRef(new Set<string>());

  // Stable timestamp → ms. API sends createdAt as unix seconds (number) or ISO string.
  function toMs(ts: number | string | undefined): number {
    if (!ts) return 0;
    if (typeof ts === 'number') return ts < 1e10 ? ts * 1000 : ts;  // seconds → ms
    return new Date(ts).getTime();
  }

  // Stable dedup key — system messages may lack id, fall back to guestId+createdAt
  function msgKey(m: Message): string {
    return m.id ?? `${m.guestId ?? ''}:${m.createdAt}`;
  }

  // Add new messages (newest first order for inverted FlatList)
  const addNew = useCallback((incoming: Message[]) => {
    const fresh = incoming.filter(m => !seenIds.current.has(msgKey(m)));
    if (fresh.length === 0) return;
    fresh.forEach(m => seenIds.current.add(msgKey(m)));
    // Sort ascending then reverse → newest at index 0
    const sorted = [...fresh].sort(
      (a, b) => toMs(a.createdAt) - toMs(b.createdAt),
    ).reverse();
    setMessages(prev => [...sorted, ...prev]);
  }, []);

  // Initial load
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const msgs = await loadFn();
      if (__DEV__) {
        console.log('[messages] count:', msgs.length);
        if (msgs.length > 0) console.log('[messages] sample:', JSON.stringify(msgs[msgs.length - 1]));
      }
      seenIds.current = new Set(msgs.map(m => msgKey(m)));
      // API returns ascending (oldest first) → reverse for inverted list
      setMessages([...msgs].reverse());
    } catch {
      setError('Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [loadFn]);

  useEffect(() => { load(); }, [channelId]);

  // WebSocket — live new messages
  useEffect(() => {
    const off = socket.on('message', (data) => {
      if (data.channelId === channelId && data.message) {
        addNew([data.message as Message]);
      }
    });
    return off;
  }, [channelId, addNew]);

  // Polling fallback — catches messages when WS is down
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const msgs = await loadFn();
        addNew(msgs);
      } catch { /* silent */ }
    }, 8_000);
    return () => clearInterval(id);
  }, [channelId, loadFn, addNew]);

  // Send text
  const sendText = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const msg = await postTextFn(trimmed);
      addNew([msg]);
      track('message_sent', { channelId });
    } catch {
      setError('Failed to send message');
    } finally {
      setSending(false);
    }
  }, [sending, postTextFn, addNew, channelId]);

  // Send image — upload first, then post message
  const sendImage = useCallback(async (localUri: string) => {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const imageUrl = await uploadFile(localUri);
      const msg = await postImageFn(imageUrl);
      addNew([msg]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send image');
    } finally {
      setSending(false);
    }
  }, [sending, postImageFn, addNew]);

  return {
    messages, loading, sending, error,
    clearError: () => setError(null),
    sendText, sendImage, reload: load,
  };
}
