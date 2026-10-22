import { useSyncExternalStore } from 'react'
import { markDailyProofsSeen } from '../../api'

/**
 * The photos I've viewed (Today's stories: a country's ring is colored while
 * one of its photos is unseen), like the app: kept in this browser for
 * everyone, and sent to the server in small batches when signed in.
 */
const KEY = 'hilads_seen_proofs_v1'
const MAX = 600
const BATCH = 8
const FLUSH_MS = 4000

let seen = null
let version = 0
const listeners = new Set()
let queue = []
let timer = null

const emit = () => { version++; listeners.forEach(l => l()) }

function load() {
  if (seen) return seen
  try { seen = new Set(JSON.parse(localStorage.getItem(KEY) || '[]')) } catch { seen = new Set() }
  return seen
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify([...seen].slice(-MAX))) } catch { /* private mode: this visit only */ }
}

function flush() {
  if (timer) { clearTimeout(timer); timer = null }
  if (queue.length === 0) return
  markDailyProofsSeen(queue.splice(0, 100)).catch(() => {})
}

/** One photo viewed; `signedIn` also tells the server (batched). */
export function markSeen(id, signedIn) {
  load()
  if (seen.has(id)) return
  seen.add(id)
  persist()
  emit()
  if (!signedIn) return
  queue.push(id)
  if (queue.length >= BATCH) flush()
  else if (!timer) timer = setTimeout(flush, FLUSH_MS)
}

/** Send what's waiting now (the viewer closes). */
export const flushSeen = flush

/** A country still has a photo I haven't viewed: the server's flag (signed in) and this browser's. */
export function hasUnseen(group) {
  load()
  return (group.unseen ?? true) && group.ids.some(id => !seen.has(id))
}

/** Re-render when what I've seen changes. */
export function useSeen() {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => version)
}
