import { useSyncExternalStore } from 'react'

/**
 * Whether Today's "While you were away" card is showing: one card at a time above the hero, so
 * the results card waits until it's gone (the away card often carries the results itself).
 */
let showing = false
const listeners = new Set()

export function setAwayCardShowing(v) {
  if (v === showing) return
  showing = v
  listeners.forEach(l => l())
}

export function useAwayCardShowing() {
  return useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => showing, () => showing)
}
