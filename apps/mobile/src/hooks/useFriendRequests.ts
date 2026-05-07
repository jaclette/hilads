import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import {
  fetchIncomingFriendRequests, fetchOutgoingFriendRequests,
  acceptFriendRequest, declineFriendRequest, cancelFriendRequest,
} from '@/api/friendRequests';
import { socket } from '@/lib/socket';
import type { FriendRequest } from '@/types';

/**
 * Manages incoming + outgoing pending friend requests.
 *
 * - Loads both lists on mount.
 * - Subscribes to per-user WS events so the UI mirrors changes happening on
 *   other devices / from other users (e.g. someone B accepted my request →
 *   my outgoing list removes the row instantly).
 * - Mutation helpers do optimistic updates with rollback on server error.
 */
interface Result {
  incoming:      FriendRequest[];
  outgoing:      FriendRequest[];
  incomingCount: number;
  loading:       boolean;
  refresh:       () => Promise<void>;
  accept:        (id: string) => Promise<void>;
  decline:       (id: string) => Promise<void>;
  cancel:        (id: string) => Promise<void>;
}

export function useFriendRequests(): Result {
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [loading,  setLoading]  = useState(true);

  // Track latest state for handlers without re-binding on every change.
  const incomingRef = useRef(incoming);
  const outgoingRef = useRef(outgoing);
  incomingRef.current = incoming;
  outgoingRef.current = outgoing;

  const refresh = useCallback(async () => {
    try {
      const [inc, out] = await Promise.all([
        fetchIncomingFriendRequests(),
        fetchOutgoingFriendRequests(),
      ]);
      setIncoming(inc);
      setOutgoing(out);
    } catch (e) {
      console.warn('[friend-requests] refresh failed:', String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refresh();
      if (cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  // ── WS subscriptions ────────────────────────────────────────────────────────
  useEffect(() => {
    const offReceived = socket.on('friendRequestReceived', (data) => {
      const req = data.request as FriendRequest | undefined;
      if (!req) return;
      setIncoming(prev => prev.some(r => r.id === req.id) ? prev : [req, ...prev]);
    });
    const offAccepted = socket.on('friendRequestAccepted', (data) => {
      const id = data.requestId as string | undefined;
      if (!id) return;
      // I'm the SENDER; remove from outgoing — the relationship is now in
      // user_friends. Profile screens watching this event flip to "Friend".
      setOutgoing(prev => prev.filter(r => r.id !== id));
    });
    const offDeclined = socket.on('friendRequestDeclined', (data) => {
      const id = data.requestId as string | undefined;
      if (!id) return;
      setOutgoing(prev => prev.filter(r => r.id !== id));
    });
    const offCancelled = socket.on('friendRequestCancelled', (data) => {
      const id = data.requestId as string | undefined;
      if (!id) return;
      setIncoming(prev => prev.filter(r => r.id !== id));
    });
    return () => { offReceived(); offAccepted(); offDeclined(); offCancelled(); };
  }, []);

  // ── Mutations (optimistic) ─────────────────────────────────────────────────

  const accept = useCallback(async (id: string) => {
    const prev = incomingRef.current;
    setIncoming(prev.filter(r => r.id !== id));
    try {
      await acceptFriendRequest(id);
    } catch (e) {
      console.warn('[friend-requests] accept failed, rolling back:', String(e));
      setIncoming(prev);
      Alert.alert('Could not accept', 'Please check your connection and try again.');
    }
  }, []);

  const decline = useCallback(async (id: string) => {
    const prev = incomingRef.current;
    setIncoming(prev.filter(r => r.id !== id));
    try {
      await declineFriendRequest(id);
    } catch (e) {
      console.warn('[friend-requests] decline failed, rolling back:', String(e));
      setIncoming(prev);
      Alert.alert('Could not decline', 'Please check your connection and try again.');
    }
  }, []);

  const cancel = useCallback(async (id: string) => {
    const prev = outgoingRef.current;
    setOutgoing(prev.filter(r => r.id !== id));
    try {
      await cancelFriendRequest(id);
    } catch (e) {
      console.warn('[friend-requests] cancel failed, rolling back:', String(e));
      setOutgoing(prev);
      Alert.alert('Could not cancel', 'Please check your connection and try again.');
    }
  }, []);

  return {
    incoming,
    outgoing,
    incomingCount: incoming.length,
    loading,
    refresh,
    accept,
    decline,
    cancel,
  };
}
