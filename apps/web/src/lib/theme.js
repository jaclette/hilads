// ── Theme (light / dark) ─────────────────────────────────────────────────────
// Phase-2 plumbing for the dark/light toggle. Applies `data-theme` to <html>,
// which re-colors everything routed through the CSS custom-property tokens
// (see :root and [data-theme="light"] in index.css).
//
// DEFAULT IS 'dark' until the in-app shell is migrated onto the token system
// (phase 3). Flipping to 'light' before then would render the app's still-dark-
// assuming surfaces on a light ground. setTheme() exists now so the Me-screen
// toggle is a drop-in once phase 3 lands; it is intentionally not surfaced yet.

const KEY = 'hilads_theme'
const DEFAULT = 'dark'

export function getStoredTheme() {
  try { return localStorage.getItem(KEY) } catch { return null }
}

/** Set `data-theme` on <html>. Returns the applied value. */
export function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark'
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', t)
  }
  return t
}

/** Persist + apply. Call from the Me-screen toggle (phase 3). */
export function setTheme(theme) {
  try { localStorage.setItem(KEY, theme) } catch { /* private mode — apply anyway */ }
  return applyTheme(theme)
}

/** Read the stored preference (else DEFAULT) and apply it. Call once at boot. */
export function initTheme() {
  const stored = getStoredTheme()
  return applyTheme(stored === 'light' || stored === 'dark' ? stored : DEFAULT)
}
