import { useState, useEffect, useRef, useCallback } from 'react';
import { socket } from '@/lib/socket';
import { uploadFile } from '@/api/uploads';
import { useApp } from '@/context/AppContext';
import type { Message } from '@/types';

interface Params {
  channelId:   string;
  loadFn:      () => Promise<Message[]>;
  postTextFn:  (content: string) => Promise<Message>;
  postImageFn: (imageUrl: string) => Promise<Message>;
}

interface Result {
  messages:   Message[];   // newest first (for inverted FlatList)
  loading:    boolean;
  sending:    boolean;     // true only during image upload
  error:      string | null;
  clearError: () => void;
  sendText:   (content: string) => Promise<void>;
  sendImage:  (localUri: string) => Promise<void>;
  reload:     () => void;
}

function makeLocalId(prefix = 'local'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function useMessages({ channelId, loadFn, postTextFn, postImageFn }: Params): Result {
  const { identity, account } = useApp();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [sending,  setSending]  = useState(false);  // image upload only
  const [error,    setError]    = useState<string | null>(null);

  // Track seen IDs to deduplicate WS + initial load + send
  const seenIds = useRef(new Set<string>());

  // Stable timestamp → ms. API sends createdAt as unix seconds (number) or ISO string.
  function toMs(ts: number | string | undefined): number {
    if (!ts) return 0;
    if (typeof ts === 'number') return ts < 1e10 ? ts * 1000 : ts;
    return new Date(ts).getTime();
  }

  // Stable dedup key — system messages may lack id, fall back to guestId+createdAt
  function msgKey(m: Message): string {
    return m.id ?? `${m.guestId ?? ''}:${m.createdAt}`;
  }

  // Add new messages (newest first order for inverted FlatList).
  // Skips local optimistic placeholders (those start with 'local-').
  const addNew = useCallback((incoming: Message[]) => {
    const fresh = incoming.filter(m => {
      const key = msgKey(m);
      if (seenIds.current.has(key)) return false;
      // Never overwrite a still-pending optimistic placeholder via WS/poll
      // (the replacement happens in sendText/sendImage reconciliation instead)
      return true;
    });
    if (fresh.length === 0) return;
    fresh.forEach(m => seenIds.current.add(msgKey(m)));
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
    function handler(data: Record<string, unknown>) {
      if ((data.channelId === channelId || data.eventId === channelId) && data.message) {
        addNew([data.message as Message]);
      }
    }
    const off1 = socket.on('newMessage', handler);
    const off2 = socket.on('message', handler);
    return () => { off1(); off2(); };
  }, [channelId, addNew]);

  // New messages arrive via WebSocket (newMessage / message events above).
  // No polling interval — WebSocket is the only real-time source.

  // ── Reconcile optimistic → server message ─────────────────────────────────
  //
  // Two orderings to handle:
  //   A. API response arrives before WS: replace localId placeholder with server msg.
  //   B. WS arrives before API response: server msg already in list via addNew;
  //      when API responds, just remove the placeholder (server msg already there).

  function reconcile(localId: string, serverMsg: Message) {
    seenIds.current.add(msgKey(serverMsg));
    setMessages(prev => {
      // Case B: WS already inserted the server message — just remove placeholder
      if (serverMsg.id && prev.some(m => m.id === serverMsg.id && m.id !== localId)) {
        return prev.filter(m => m.id !== localId);
      }
      // Case A: replace placeholder with confirmed server message
      return prev.map(m => m.id === localId ? serverMsg : m);
    });
  }

  function markFailed(localId: string) {
    setMessages(prev =>
      prev.map(m => m.id === localId ? { ...m, status: 'failed' as const } : m),
    );
  }

  // ── Send text (optimistic) ─────────────────────────────────────────────────

  const sendText = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    const senderNickname = account?.display_name ?? identity?.nickname ?? '';
    const localId = makeLocalId();
    const optimistic: Message = {
      id:        localId,
      type:      'text',
      guestId:   identity?.guestId,
      nickname:  senderNickname,
      content:   trimmed,
      createdAt: Date.now() / 1000,
      localId,
      status:    'sending',
    };

    // Show message instantly
    setMessages(prev => [optimistic, ...prev]);
    setError(null);

    try {
      const msg = await postTextFn(trimmed);
      reconcile(localId, msg);
      // sent_message is tracked server-side — no frontend duplicate
    } catch {
      markFailed(localId);
      setError('Failed to send message');
    }
  }, [postTextFn, identity, account, channelId]);

  // ── Send image (optimistic with local URI preview) ─────────────────────────

  const sendImage = useCallback(async (localUri: string) => {
    console.log('[image-upload] picker result = uri:', localUri);
    const senderNickname = account?.display_name ?? identity?.nickname ?? '';
    const localId = makeLocalId('local-img');
    const optimistic: Message = {
      id:        localId,
      type:      'image',
      guestId:   identity?.guestId,
      nickname:  senderNickname,
      imageUrl:  localUri,     // local file URI for immediate preview
      createdAt: Date.now() / 1000,
      localId,
      status:    'sending',
    };

    // Show image preview instantly (local URI is valid for <Image> display)
    setMessages(prev => [optimistic, ...prev]);
    setSending(true);          // blocks ChatInput while uploading
    setError(null);

    try {
      const imageUrl = await uploadFile(localUri);
      const msg = await postImageFn(imageUrl);
      reconcile(localId, msg);
    } catch (e) {
      markFailed(localId);
      setError(e instanceof Error ? e.message : 'Failed to send image');
    } finally {
      setSending(false);
    }
  }, [postImageFn, identity, account]);

  return {
    messages, loading, sending, error,
    clearError: () => setError(null),
    sendText, sendImage, reload: load,
  };
}
