import { useSyncExternalStore } from 'react';
import type { OnlineUser } from '@/types';

/**
 * Who's online in the current city (usePresence keeps it in sync with the realtime server).
 * Kept outside AppContext: presence changes all the time (someone arrives, leaves, the
 * snapshot every few seconds), and in the context each change re-rendered every screen and
 * component reading it (~90 of them, every tab mounted so far). Only the two places that
 * show or use the list read it here.
 */
let users: OnlineUser[] = [];
const listeners = new Set<() => void>();

export function setOnlineUsers(next: OnlineUser[]) {
  users = next;
  listeners.forEach(l => l());
}

export function getOnlineUsers(): OnlineUser[] { return users; }

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** The live list, re-rendering the caller when it changes. */
export function useOnlineUsers(): OnlineUser[] {
  return useSyncExternalStore(subscribe, getOnlineUsers, getOnlineUsers);
}
