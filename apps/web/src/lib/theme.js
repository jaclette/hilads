// ── Theme (light / dark) ─────────────────────────────────────────────────────
// Phase-2 plumbing for the dark/light toggle. Applies `data-theme` to <html>,
// which re-colors everything routed through the CSS custom-property tokens
// (see :root and [data-theme="light"] in index.css).
//
// DEFAULT is 'light' — the app shell is fully token-routed (phase 3), so a new
// visitor gets the warm daylight theme. Users who prefer the original night look
// flip it from the Me screen (setTheme('dark')), which persists their choice.

const KEY = 'hilads_theme'
const DEFAULT = 'light'

export function getStoredTheme() {
  try { return localStorage.getItem(KEY) } catch { return null }
}

/** Set `data-theme` on <html> + sync the browser-chrome color. Returns the applied value. */
export function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark'
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', t)
    const m = document.querySelector('meta[name="theme-color"]')
    if (m) m.setAttribute('content', t === 'dark' ? '#0d0b09' : '#FBF6F0')
  }
  return t
}

/** Persist + apply. Call from the Me-screen toggle (phase 3). */
export function setTheme(theme) {
  try { localStorage.setItem(KEY, theme) } catch { /* private mode — apply anyway */ }
  return applyTheme(theme)
}

/** Read the stored preference (else DEFAULT) and apply it. Call once at boot.
 *  Honors a ?theme=light|dark URL override (and persists it) so the in-progress
 *  light app can be previewed during the phase-3 migration without a user-facing
 *  toggle. Drop the param / use ?theme=dark to reset. */
export function initTheme() {
  let pref = getStoredTheme()
  // Dev-only: honor ?theme=light|dark so the in-progress light app can be
  // previewed during the phase-3 migration. Ignored in production builds so a
  // stray link can't show live visitors the half-migrated shell.
  if (import.meta.env.DEV) {
    try {
      const q = new URLSearchParams(window.location.search).get('theme')
      if (q === 'light' || q === 'dark') {
        pref = q
        try { localStorage.setItem(KEY, q) } catch { /* private mode */ }
      }
    } catch { /* no URL / SSR */ }
  }
  return applyTheme(pref === 'light' || pref === 'dark' ? pref : DEFAULT)
}
