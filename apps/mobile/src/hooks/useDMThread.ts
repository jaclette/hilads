import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchDmMessages, sendDmMessage, sendDmImageMessage, markDmRead } from '@/api/conversations';
import { uploadFile } from '@/api/uploads';
import { socket } from '@/lib/socket';
import { reactionEmitter } from '@/lib/reactionEmitter';
import type { ReactionType } from '@/lib/reactionEmitter';
import { useApp } from '@/context/AppContext';
import { track } from '@/services/analytics';
import type { DmMessage, Reaction, ReplyRef } from '@/types';

interface Result {
  messages:            DmMessage[];  // newest first (inverted FlatList)
  loading:             boolean;
  sending:             boolean;      // kept for interface compat — always false (optimistic)
  error:               string | null;
  clearError:          () => void;
  sendText:            (content: string, replyTo?: ReplyRef | null) => Promise<void>;
  sendImage:           (localUri: string) => Promise<void>;
  setMessageReactions: (messageId: string, reactions: Reaction[]) => void;
}

function makeLocalId(): string {
  return `local-dm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function useDMThread(conversationId: string): Result {
  const { account, setActiveDmId } = useApp();
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const seenIds = useRef(new Set<string>());

  const addNew = useCallback((incoming: DmMessage[]) => {
    const fresh = incoming.filter(m => !seenIds.current.has(m.id));
    if (fresh.length === 0) return;
    fresh.forEach(m => seenIds.current.add(m.id));
    const sorted = [...fresh].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    ).reverse();
    setMessages(prev => {
      // Own-message echo detection: if WS delivers our own message while an optimistic
      // placeholder is still pending, skip the append — sendText reconcile() handles it.
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
  useEffect(() => {
    setActiveDmId(conversationId);
    if (account) socket.joinDm(conversationId, account.id);
    const off = socket.on('newConversationMessage', (data) => {
      if (data.conversationId === conversationId && data.message) {
        addNew([data.message as DmMessage]);
        markDmRead(conversationId);
      }
    });

    // Incoming reaction animation — server relays { event: 'reaction', type, messageId }
    // for both channel and DM reactions so burst particles play for the other person's tap.
    const offReaction = socket.on('reaction', (data) => {
      const type = data.type as string;
      const msgId = data.messageId as string;
      if (!type || !msgId) return;
      reactionEmitter.emit(msgId, type as ReactionType);
    });

    return () => {
      off();
      offReaction();
      setActiveDmId(null);
    };
  }, [conversationId, account, addNew, setActiveDmId]);

  // Live DM messages arrive via WS newConversationMessage — no polling needed.

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

  // ── Send image (optimistic — local URI shown while uploading) ──────────────

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

    try {
      const { url: remoteUrl } = await uploadFile(localUri);
      const msg = await sendDmImageMessage(conversationId, remoteUrl);
      seenIds.current.add(msg.id);
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id && m.id !== localId)) {
          return prev.filter(m => m.id !== localId);
        }
        return prev.map(m => m.id === localId ? msg : m);
      });
      track('dm_image_sent', { conversationId });
    } catch {
      setMessages(prev =>
        prev.map(m => m.id === localId ? { ...m, status: 'failed' as const } : m),
      );
      setError('Failed to send image');
    }
  }, [conversationId, account]);

  function setMessageReactions(messageId: string, reactions: Reaction[]) {
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
  }

  return {
    messages, loading, sending: false, error,
    clearError: () => setError(null),
    sendText,
    sendImage,
    setMessageReactions,
  };
}
