/**
 * usePresence — global hook that keeps AppContext.onlineUsers in sync.
 *
 * Must be mounted once at the root layout level so the list is always up to date
 * regardless of which tab is currently visible.
 *
 * Server events (mirroring web socket.js):
 *   presenceSnapshot  { cityId, users: [{sessionId, nickname, userId}], count }
 *   userJoined        { cityId, user: { sessionId, nickname, userId } }
 *   userLeft          { cityId, sessionId }  (some servers send user: { sessionId })
 */

import { useEffect, useRef } from 'react';
import { socket } from '@/lib/socket';
import { useApp } from '@/context/AppContext';
import { isBlocked } from '@/lib/blockFilter';
import type { OnlineUser } from '@/types';

type RawUser = { sessionId: string; nickname: string; userId?: string | null; guestId?: string | null; mode?: string | null };

function toOnlineUser(u: RawUser): OnlineUser {
  return {
    sessionId:        u.sessionId,
    // Stable per-device guest id from the WS presence payload (the client sends
    // it on joinCity). Anchors guest @mentions; falls back to sessionId only if
    // an older client didn't broadcast it.
    guestId:          u.guestId ?? u.sessionId,
    userId:           u.userId ?? undefined,
    nickname:         u.nickname ?? '',
    isRegistered:     Boolean(u.userId),
    mode:             u.mode ?? undefined,
  };
}

export function usePresence(): void {
  const { city, setOnlineUsers, blockedSet } = useApp();
  // Ref so incremental updates (join/leave) can read current list without stale closure
  const usersRef = useRef<OnlineUser[]>([]);
  // Mirror blockedSet into a ref so the WS handlers below don't need to be
  // re-registered every time the set changes (avoids a churn of off()/on()).
  const blockedRef = useRef(blockedSet);
  useEffect(() => { blockedRef.current = blockedSet; }, [blockedSet]);

  // Apply the current block set to the rendered list. Runs whenever the set
  // changes so a fresh block immediately drops the user from the Here screen.
  useEffect(() => {
    const filtered = usersRef.current.filter(
      u => !isBlocked(u.userId ?? null, u.guestId ?? null, blockedSet),
    );
    if (filtered.length !== usersRef.current.length) {
      setOnlineUsers(filtered);
      // intentionally do NOT update usersRef — it's the source of truth for
      // the live list; if the user later unblocks, a presenceSnapshot will
      // restore them.
    }
  }, [blockedSet, setOnlineUsers]);

  useEffect(() => {
    if (!city) return;

    const channelId = city.channelId;

    // Server echoes back cityId as integer (e.g. 1), native stores as string ("1").
    // Use string coercion so "1" matches 1.
    const matchesCity = (data: Record<string, unknown>) =>
      String(data.cityId) === channelId || String(data.channelId) === channelId;

    // presenceSnapshot — full list sent on joinRoom or re-join
    const offSnapshot = socket.on('presenceSnapshot', (data) => {
      if (!matchesCity(data)) return;
      const raw = Array.isArray(data.users) ? (data.users as RawUser[]) : [];
      console.log('[presence] snapshot users:', raw.length, '| channelId:', channelId);
      if (__DEV__) {
        raw.forEach((u, i) => console.log(`  [${i}] sessionId=${u.sessionId} nickname=${u.nickname}`));
      }

      const mapped = raw.map(toOnlineUser);

      // Deduplicate by sessionId — guards against double-delivery or server races.
      // Also filters out entries with no sessionId (would cause duplicate FlatList keys).
      const seen = new Set<string>();
      const deduped = mapped.filter(u => {
        if (!u.sessionId) {
          console.warn('[presence] user missing sessionId, skipping:', u.nickname);
          return false;
        }
        if (seen.has(u.sessionId)) {
          console.warn('[presence] duplicate sessionId in snapshot, skipping:', u.sessionId);
          return false;
        }
        seen.add(u.sessionId);
        return true;
      });

      usersRef.current = deduped;
      // Apply the current block filter before publishing.
      const visible = deduped.filter(u => !isBlocked(u.userId ?? null, u.guestId ?? null, blockedRef.current));
      setOnlineUsers(visible);
    });

    // userJoined — single user entered the city
    const offJoined = socket.on('userJoined', (data) => {
      if (!matchesCity(data)) return;
      const u = data.user as RawUser | undefined;
      if (!u?.sessionId) {
        console.warn('[presence] userJoined missing sessionId:', JSON.stringify(data));
        return;
      }
      console.log('[presence] userJoined:', u.nickname, '| sessionId:', u.sessionId.slice(0, 8));
      if (usersRef.current.some(p => p.sessionId === u.sessionId)) return;
      const mapped = toOnlineUser(u);
      const next = [...usersRef.current, mapped];
      usersRef.current = next;
      // Suppress publishing if the joining user is in the viewer's block set.
      if (isBlocked(mapped.userId ?? null, mapped.guestId ?? null, blockedRef.current)) return;
      setOnlineUsers(next.filter(p => !isBlocked(p.userId ?? null, p.guestId ?? null, blockedRef.current)));
    });

    // userLeft — single user left
    const offLeft = socket.on('userLeft', (data) => {
      if (!matchesCity(data)) return;
      // Some servers nest sessionId inside user object, others at top level
      const sid = (data.sessionId ?? (data.user as RawUser | undefined)?.sessionId) as string | undefined;
      if (!sid) return;
      console.log('[presence] userLeft:', sid);
      const next = usersRef.current.filter(p => p.sessionId !== sid);
      usersRef.current = next;
      setOnlineUsers(next.filter(p => !isBlocked(p.userId ?? null, p.guestId ?? null, blockedRef.current)));
    });

    // Debug: log ALL WS messages to diagnose presence issues in DEV
    let offAll: (() => void) | undefined;
    if (__DEV__) {
      offAll = socket.on('*', (data) => {
        const evt = data.event ?? data.type;
        if (['presenceSnapshot', 'userJoined', 'userLeft', 'onlineCountUpdated'].includes(evt as string)) {
          console.log('[presence][raw]', JSON.stringify(data));
        }
      });
    }

    return () => {
      offSnapshot();
      offJoined();
      offLeft();
      offAll?.();
      // Clear list when city changes so we don't show stale users
      usersRef.current = [];
      setOnlineUsers([]);
    };
  }, [city?.channelId]);
}
