import { useState, useEffect, useRef, useCallback } from 'react';
import { socket } from '@/lib/socket';
import { uploadFile } from '@/api/uploads';
import { useApp } from '@/context/AppContext';
import type { Message } from '@/types';

interface Params {
  channelId:   string;
  loadFn:      (opts?: { beforeId?: string }) => Promise<{ messages: Message[]; hasMore: boolean }>;
  postTextFn:  (content: string) => Promise<Message>;
  postImageFn: (imageUrl: string) => Promise<Message>;
}

interface Result {
  messages:     Message[];   // newest first (for inverted FlatList)
  loading:      boolean;
  loadingOlder: boolean;     // true while fetching an older page
  hasMore:      boolean;     // true when older messages exist to load
  sending:      boolean;     // true only during image upload
  error:        string | null;
  clearError:   () => void;
  sendText:     (content: string) => Promise<void>;
  sendImage:    (localUri: string) => Promise<void>;
  loadOlder:    () => Promise<void>;
  reload:       () => void;
}

function makeLocalId(prefix = 'local'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function useMessages({ channelId, loadFn, postTextFn, postImageFn }: Params): Result {
  const { identity, account } = useApp();

  const [messages,     setMessages]     = useState<Message[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore,      setHasMore]      = useState(false);
  const [sending,      setSending]      = useState(false);  // image upload only
  const [error,        setError]        = useState<string | null>(null);

  // Track seen IDs to deduplicate WS + initial load + send
  const seenIds        = useRef(new Set<string>());
  const oldestIdRef    = useRef<string | null>(null); // cursor for loading older pages
  const loadingOlderRef = useRef(false);              // guards against concurrent loadOlder calls

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
      const { messages: msgs, hasMore: more } = await loadFn();
      if (__DEV__) {
        console.log('[messages] count:', msgs.length, 'hasMore:', more);
        if (msgs.length > 0) console.log('[messages] sample:', JSON.stringify(msgs[msgs.length - 1]));
      }
      seenIds.current  = new Set(msgs.map(m => msgKey(m)));
      oldestIdRef.current = msgs.length > 0 ? msgs[0]?.id ?? null : null; // msgs[0] = oldest (ASC from backend)
      setMessages([...msgs].reverse()); // newest first for inverted FlatList
      setHasMore(more);
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

  // ── Load older messages (pagination) ──────────────────────────────────────
  // Fetches the page before the current oldest message and prepends it.
  // In an inverted FlatList, this extends the visual top (high index).

  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasMore || !oldestIdRef.current) return;

    loadingOlderRef.current = true;
    setLoadingOlder(true);

    try {
      const { messages: older, hasMore: moreLeft } = await loadFn({ beforeId: oldestIdRef.current });
      const fresh = older.filter(m => {
        const key = msgKey(m);
        if (seenIds.current.has(key)) return false;
        seenIds.current.add(key);
        return true;
      });

      if (fresh.length > 0) {
        oldestIdRef.current = older[0]?.id ?? null; // older[0] is the oldest of the new batch (ASC)
        // Sort newest-first within the batch, then append to end of array
        // (end = visual top in inverted FlatList)
        const sorted = [...fresh].sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
        setMessages(prev => [...prev, ...sorted]);
      }

      setHasMore(moreLeft);
    } catch {
      // silent — user can scroll up again to retry
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [hasMore, loadFn]);

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
    messages, loading, loadingOlder, hasMore, sending, error,
    clearError: () => setError(null),
    sendText, sendImage, loadOlder, reload: load,
  };
}
