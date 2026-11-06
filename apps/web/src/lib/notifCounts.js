import { useEffect, useSyncExternalStore } from 'react'
import { fetchNotifCounts, fetchUnreadCount } from '../api'

/**
 * Unread notification counts (V6), one shared store, like the app's: the bell,
 * the "While you were away" card, the tab badges and the inbox chips read it.
 * Refreshed when the page shows, every minute while it's visible, and soon after
 * a live notification. An API without /notifications/counts: the total only.
 */
export const CATEGORIES = ['social', 'game', 'plans', 'city', 'hilads']
const zero = () => Object.fromEntries(CATEGORIES.map(c => [c, 0]))
export const EMPTY_COUNTS = { total: 0, unread: zero(), unseen: zero(), badges: { chat: 0, passport: 0, ranks: 0 } }

let counts = EMPTY_COUNTS
const listeners = new Set()
const set = (c) => { counts = c; listeners.forEach(l => l()) }

let inflight = null
export function refreshNotifCounts() {
  inflight ??= fetchNotifCounts()
    .catch(() => fetchUnreadCount().then(d => ({ ...EMPTY_COUNTS, total: d?.count ?? 0 })))
    .then(c => { set({ ...EMPTY_COUNTS, ...c }); return c })
    .catch(() => counts)
    .finally(() => { inflight = null })
  return inflight
}

/** Optimistic local change (read, seen, delete) until the next refresh. */
export function patchNotifCounts(fn) { set(fn(counts)) }

export function useNotifCounts() {
  return useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => counts)
}

/** Mounted once in App for members; `bump` refreshes soon (a live notification arrived). */
let soon = null
export function bumpNotifCounts() {
  if (soon) clearTimeout(soon)
  soon = setTimeout(refreshNotifCounts, 800)
}

export function useNotifCountsSync(enabled) {
  useEffect(() => {
    if (!enabled) { set(EMPTY_COUNTS); return undefined }
    const first = setTimeout(refreshNotifCounts, 2000)   // after join + messages (the critical path)
    let timer = setInterval(() => { if (document.visibilityState === 'visible') refreshNotifCounts() }, 60_000)
    const onVis = () => { if (document.visibilityState === 'visible') refreshNotifCounts() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearTimeout(first); clearInterval(timer); document.removeEventListener('visibilitychange', onVis) }
  }, [enabled])
}
