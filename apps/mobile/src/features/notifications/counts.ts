import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { fetchNotifCounts, fetchUnreadCount, NOTIF_CATEGORIES, type NotifCategory, type NotifCounts } from '@/api/notifications';
import { socket } from '@/lib/socket';
import { useApp } from '@/context/AppContext';

/**
 * Unread notification counts (V6), one shared store: the bell, the "While you
 * were away" card, the tab badges and the inbox filters read it. Refreshed on
 * launch, when the app comes back, every minute while it's open, and soon after
 * a notification arrives over the socket (most types don't send one: the poll
 * covers them). An API without /notifications/counts: the total only.
 */

const zero = (): Record<NotifCategory, number> => Object.fromEntries(NOTIF_CATEGORIES.map(c => [c, 0])) as Record<NotifCategory, number>;
export const EMPTY_COUNTS: NotifCounts = { total: 0, unread: zero(), unseen: zero(), badges: { chat: 0, passport: 0, ranks: 0 } };

let counts: NotifCounts = EMPTY_COUNTS;
const listeners = new Set<() => void>();
const set = (c: NotifCounts) => { counts = c; listeners.forEach(l => l()); };

let inflight: Promise<NotifCounts> | null = null;
/** Fetch the counts now (one request at a time). */
export function refreshNotifCounts(): Promise<NotifCounts> {
  inflight ??= fetchNotifCounts()
    .catch(() => fetchUnreadCount().then(total => ({ ...EMPTY_COUNTS, total })))
    .then(c => { set(c); return c; })
    .catch(() => counts)
    .finally(() => { inflight = null; });
  return inflight;
}

/** Optimistic local change (mark read, seen, delete) until the next refresh. */
export function patchNotifCounts(fn: (c: NotifCounts) => NotifCounts): void {
  set(fn(counts));
}

export function useNotifCounts(): NotifCounts {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => counts);
}

const POLL_MS = 60_000;

/** Mounted once at the root, for members: keeps the counts fresh and the legacy bell total in sync. */
export function useNotifCountsSync(enabled: boolean): void {
  const { setUnreadNotifications } = useApp();
  const c = useNotifCounts();
  useEffect(() => { if (enabled) setUnreadNotifications(c.total); }, [c.total, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!enabled) { set(EMPTY_COUNTS); return; }
    refreshNotifCounts();
    let timer: ReturnType<typeof setInterval> | null = setInterval(refreshNotifCounts, POLL_MS);
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') {
        refreshNotifCounts();
        timer ??= setInterval(refreshNotifCounts, POLL_MS);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });
    let soon: ReturnType<typeof setTimeout> | null = null;
    const onNew = () => { if (soon) clearTimeout(soon); soon = setTimeout(refreshNotifCounts, 800); };
    const off1 = socket.on('notification', onNew);
    const off2 = socket.on('newNotification', onNew);
    return () => { sub.remove(); if (timer) clearInterval(timer); if (soon) clearTimeout(soon); off1(); off2(); };
  }, [enabled]);
}
