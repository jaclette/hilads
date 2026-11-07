import { useSyncExternalStore } from 'react'

/**
 * Whether Today's "While you were away" card is showing yesterday's results: then it carries
 * them and the separate results card stays hidden (one results block, never two).
 */
let showing = false
const listeners = new Set()

export function setAwayShowsResults(v) {
  if (v === showing) return
  showing = v
  listeners.forEach(l => l())
}

export function useAwayShowsResults() {
  return useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => showing, () => showing)
}
