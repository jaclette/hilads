import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { fetchDmMessages, sendDmMessage, sendDmImageMessage, markDmRead, editDmMessage as apiEditDmMessage, deleteDmMessage as apiDeleteDmMessage } from '@/api/conversations';
import { uploadFile } from '@/api/uploads';
import { socket } from '@/lib/socket';
import { reactionEmitter } from '@/lib/reactionEmitter';
import type { ReactionType } from '@/lib/reactionEmitter';
import { useApp } from '@/context/AppContext';
import { filterBlocked } from '@/lib/blockFilter';
import { track } from '@/services/analytics';
import type { DmMessage, Reaction, ReplyRef } from '@/types';

interface Result {
  messages:            DmMessage[];  // newest first (inverted FlatList)
  loading:             boolean;
  loadingOlder:        boolean;      // true while fetching an older page
  hasMore:             boolean;      // true when older messages exist to load
  sending:             boolean;      // kept for interface compat - always false (optimistic)
  error:               string | null;
  clearError:          () => void;
  sendText:            (content: string, replyTo?: ReplyRef | null) => Promise<void>;
  sendImage:           (localUri: string) => Promise<void>;
  loadOlder:           () => Promise<void>;
  setMessageReactions: (messageId: string, reactions: Reaction[]) => void;
  editMessage:         (messageId: string, content: string) => Promise<void>;
  deleteMessage:       (messageId: string) => Promise<void>;
}

function makeLocalId(): string {
  return `local-dm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function useDMThread(conversationId: string): Result {
  const { account, setActiveDmId, blockedSet } = useApp();
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore,  setHasMore]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const seenIds = useRef(new Set<string>());
  const oldestIdRef     = useRef<string | null>(null);  // cursor for loadOlder
  const loadingOlderRef = useRef(false);                 // guards concurrent loadOlder

  const addNew = useCallback((incoming: DmMessage[]) => {
    const fresh = incoming.filter(m => !seenIds.current.has(m.id));
    if (fresh.length === 0) return;
    fresh.forEach(m => seenIds.current.add(m.id));
    const sorted = [...fresh].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    ).reverse();
    setMessages(prev => {
      // Own-message echo detection: if WS delivers our own message while an optimistic
      // placeholder is still pending, skip the append - sendText reconcile() handles it.
      const toInsert = sorted.filter(serverMsg => {
        const hasPendingFromSender = prev.some(pending =>
          pending.localId != null && pending.sender_id === serverMsg.sender_id,
        );
        return !hasPendingFromSender;
      });
      if (toInsert.length === 0) return prev;
      return [...toInsert, ...prev];
    });
  }, []);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { messages: msgs, hasMore: more } = await fetchDmMessages(conversationId);
        if (cancelled) return;
        seenIds.current = new Set(msgs.map(m => m.id));
        oldestIdRef.current = msgs.length > 0 ? msgs[0]?.id ?? null : null; // msgs ASC → [0] oldest
        setMessages([...msgs].reverse());
        setHasMore(more);
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

  // WS - track active thread + live append
  useEffect(() => {
    setActiveDmId(conversationId);
    if (account) socket.joinDm(conversationId, account.id);
    const off = socket.on('newConversationMessage', (data) => {
      if (data.conversationId === conversationId && data.message) {
        addNew([data.message as DmMessage]);
        markDmRead(conversationId);
      }
    });

    // Incoming reaction animation - server relays { event: 'reaction', type, messageId }
    // for both channel and DM reactions so burst particles play for the other person's tap.
    const offReaction = socket.on('reaction', (data) => {
      const type = data.type as string;
      const msgId = data.messageId as string;
      if (!type || !msgId) return;
      reactionEmitter.emit(msgId, type as ReactionType);
    });

    // Edit / delete broadcasts for this DM thread - patch in place.
    const offEdited = socket.on('dmMessageEdited', (data) => {
      if (data.conversationId !== conversationId || !data.messageId) return;
      setMessages(prev => prev.map(m =>
        m.id === String(data.messageId)
          ? { ...m, content: (data.content as string | undefined) ?? m.content, edited_at: (data.editedAt as string | undefined) ?? new Date().toISOString() }
          : m,
      ));
    });
    const offDeleted = socket.on('dmMessageDeleted', (data) => {
      if (data.conversationId !== conversationId || !data.messageId) return;
      setMessages(prev => prev.map(m =>
        m.id === String(data.messageId)
          ? { ...m, content: '', image_url: undefined, deleted_at: (data.deletedAt as string | undefined) ?? new Date().toISOString() }
          : m,
      ));
    });

    return () => {
      off();
      offReaction();
      offEdited();
      offDeleted();
      setActiveDmId(null);
    };
  }, [conversationId, account, addNew, setActiveDmId]);

  // Live DM messages arrive via WS newConversationMessage - no polling needed.

  // ── Send text (optimistic) ─────────────────────────────────────────────────

  const sendText = useCallback(async (content: string, replyTo?: ReplyRef | null) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    const localId = makeLocalId();
    const optimistic: DmMessage = {
      id:              localId,
      conversation_id: conversationId,
      sender_id:       account?.id ?? '',
      content:         trimmed,
      type:            'text',
      created_at:      new Date().toISOString(),
      sender_name:     account?.display_name ?? '',
      localId,
      status:          'sending',
      replyTo:         replyTo ?? undefined,
    };

    setMessages(prev => [optimistic, ...prev]);
    setError(null);

    try {
      const msg = await sendDmMessage(conversationId, trimmed, replyTo?.id ?? null);
      seenIds.current.add(msg.id);
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id && m.id !== localId)) {
          return prev.filter(m => m.id !== localId);
        }
        return prev.map(m => m.id === localId ? msg : m);
      });
      track('dm_sent', { conversationId });
    } catch {
      setMessages(prev =>
        prev.map(m => m.id === localId ? { ...m, status: 'failed' as const } : m),
      );
      setError('Failed to send message');
    }
  }, [conversationId, account]);

  // ── Send image (optimistic - local URI shown while uploading) ──────────────

  const sendImage = useCallback(async (localUri: string) => {
    const localId = makeLocalId();
    const optimistic: DmMessage = {
      id:              localId,
      conversation_id: conversationId,
      sender_id:       account?.id ?? '',
      content:         '',
      type:            'image',
      image_url:       localUri,  // local URI for immediate preview
      created_at:      new Date().toISOString(),
      sender_name:     account?.display_name ?? '',
      localId,
      status:          'sending',
    };

    setMessages(prev => [optimistic, ...prev]);
    setError(null);
    console.log('[dm-image] optimistic created localId=', localId, 'localUri=', localUri);

    try {
      const { url: remoteUrl } = await uploadFile(localUri);
      console.log('[dm-image] upload ok - remoteUrl=', remoteUrl);
      const msg = await sendDmImageMessage(conversationId, remoteUrl);
      console.log('[dm-image] server msg id=', msg.id, 'image_url=', msg.image_url);
      seenIds.current.add(msg.id);
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id && m.id !== localId)) {
          return prev.filter(m => m.id !== localId);
        }
        return prev.map(m => m.id === localId ? msg : m);
      });
      track('dm_image_sent', { conversationId });
    } catch (err) {
      console.warn('[dm-image] send failed -', err instanceof Error ? err.message : String(err));
      setMessages(prev =>
        prev.map(m => m.id === localId ? { ...m, status: 'failed' as const } : m),
      );
      setError('Failed to send image');
    }
  }, [conversationId, account]);

  // ── Load older messages (pagination) ──────────────────────────────────────
  // Fetch the page before the oldest loaded message and prepend. In an inverted
  // FlatList this extends the visual top (array end) → no scroll jump.
  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasMore || !oldestIdRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const { messages: older, hasMore: moreLeft } = await fetchDmMessages(conversationId, { beforeId: oldestIdRef.current });
      const fresh = older.filter(m => {
        if (seenIds.current.has(m.id)) return false;
        seenIds.current.add(m.id);
        return true;
      });
      if (fresh.length > 0) {
        oldestIdRef.current = older[0]?.id ?? null; // older ASC → [0] oldest of batch
        const sorted = [...fresh].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
        setMessages(prev => [...prev, ...sorted]); // append = visual top (inverted)
      }
      setHasMore(moreLeft);
    } catch {
      // silent - user can scroll up again to retry
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [conversationId, hasMore]);

  function setMessageReactions(messageId: string, reactions: Reaction[]) {
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
  }

  // ── Edit / delete (optimistic, with rollback) ──────────────────────────────
  const editMessage = useCallback(async (messageId: string, content: string) => {
    let prevSnapshot: { content?: string; edited_at?: string | null } | null = null;
    setMessages(prev => prev.map(m => {
      if (m.id !== messageId) return m;
      prevSnapshot = { content: m.content, edited_at: m.edited_at };
      return { ...m, content, edited_at: new Date().toISOString() };
    }));
    try {
      await apiEditDmMessage(messageId, content);
    } catch (e) {
      if (prevSnapshot) {
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, content: prevSnapshot!.content ?? '', edited_at: prevSnapshot!.edited_at ?? null } : m));
      }
      throw e;
    }
  }, []);

  const deleteMessage = useCallback(async (messageId: string) => {
    let prevSnapshot: { content?: string; image_url?: string; deleted_at?: string | null } | null = null;
    setMessages(prev => prev.map(m => {
      if (m.id !== messageId) return m;
      prevSnapshot = { content: m.content, image_url: m.image_url, deleted_at: m.deleted_at };
      return { ...m, content: '', image_url: undefined, deleted_at: new Date().toISOString() };
    }));
    try {
      await apiDeleteDmMessage(messageId);
    } catch (e) {
      if (prevSnapshot) {
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, content: prevSnapshot!.content ?? '', image_url: prevSnapshot!.image_url, deleted_at: prevSnapshot!.deleted_at ?? null } : m));
      }
      throw e;
    }
  }, []);

  // Block filter (Apple G1.2). DM messages only have a sender_id (registered
  // users - no guests in DMs), so we map it onto the userId slot.
  const visibleMessages = useMemo(
    () => filterBlocked(
      messages,
      m => ({ userId: m.sender_id ?? null, guestId: null }),
      blockedSet,
    ),
    [messages, blockedSet],
  );

  return {
    messages: visibleMessages, loading, loadingOlder, hasMore, sending: false, error,
    clearError: () => setError(null),
    sendText,
    sendImage,
    loadOlder,
    setMessageReactions,
    editMessage,
    deleteMessage,
  };
}
