// PostHog loads after the first screen (main.jsx: its ~60 KB stay out of the main
// bundle); calls made before that wait here, in order, then run once it's ready.
let ph = null
let off = false
const queue = []

/** Runs fn(posthog) now, or once PostHog is loaded (dropped when it's off: bots, no key, failed load). */
export function withPosthog(fn) {
  if (off) return
  if (ph) { try { fn(ph) } catch { /* analytics never breaks the app */ } return }
  if (queue.length < 300) queue.push(fn)
}

export function posthogReady(instance) {
  ph = instance
  for (const fn of queue.splice(0)) { try { fn(instance) } catch { /* idem */ } }
}

export function posthogOff() {
  off = true
  queue.length = 0
}
