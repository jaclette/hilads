import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { markDailyProofsSeen } from '@/api/daily';

/**
 * The photos I've viewed (Today's stories: a country's ring is colored while
 * one of its photos is unseen). Kept on the device for everyone (the ring
 * turns neutral at once), and sent to the server in small batches when signed
 * in (POST /daily/proofs/seen), so it follows the account.
 */
const KEY = 'hilads_seen_proofs_v1';
const MAX = 600;          // the most recent ids kept on the device
const BATCH = 8;
const FLUSH_MS = 4000;

let seen = new Set<string>();
let loaded = false;
let version = 0;
const listeners = new Set<() => void>();
let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

const emit = () => { version++; listeners.forEach(l => l()); };

function load() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(KEY).then(raw => {
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    seen = new Set([...ids, ...seen]);
    emit();
  }).catch(() => {});
}

function persist() {
  const ids = [...seen].slice(-MAX);
  AsyncStorage.setItem(KEY, JSON.stringify(ids)).catch(() => {});
}

function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (queue.length === 0) return;
  const ids = queue.splice(0, 100);
  markDailyProofsSeen(ids).catch(() => {});
}

/** One photo viewed; `signedIn` also tells the server (batched). */
export function markSeen(id: string, signedIn: boolean) {
  load();
  if (seen.has(id)) return;
  seen.add(id);
  persist();
  emit();
  if (!signedIn) return;
  queue.push(id);
  if (queue.length >= BATCH) flush();
  else if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

/** Send what's waiting now (the viewer closes). */
export const flushSeen = flush;

/** A country (or a city) still has a photo I haven't viewed: the server's flag (signed in) and the device's. */
export function hasUnseen(group: { unseen: boolean | null; ids: string[] }): boolean {
  return (group.unseen ?? true) && group.ids.some(id => !seen.has(id));
}

/** One photo already viewed on this device (a story ring's segment). */
export function isSeen(id: string): boolean {
  load();
  return seen.has(id);
}

/** Re-render when what I've seen changes. */
export function useSeen(): number {
  load();
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => version);
}
