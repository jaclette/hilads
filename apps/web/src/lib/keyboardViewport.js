// The keyboard rule on the web (same as the app): fixed bars and the focused
// field are never hidden by the on-screen keyboard.
//
// Android Chrome resizes the layout with the keyboard (interactive-widget=
// resizes-content in index.html), so nothing is covered there. iOS Safari only
// shrinks the visual viewport: --kb is the keyboard's overlap on the layout
// viewport, and html.kb-open lets the CSS end every full-screen layer and
// bottom bar at the keyboard's top (index.css, "The keyboard rule"). A focused
// field that still ends up under the keyboard is scrolled into view.

const OPEN_AT = 80   // px of overlap before we call it a keyboard (not a toolbar change)
const MARGIN = 16    // px kept between the focused field and the keyboard

function overlap() {
  const vv = window.visualViewport
  if (!vv) return 0
  return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
}

function update() {
  const kb = overlap()
  const root = document.documentElement
  root.style.setProperty('--kb', `${kb}px`)
  root.classList.toggle('kb-open', kb > OPEN_AT)
}

function reveal(el) {
  const vv = window.visualViewport
  if (!el || !el.getBoundingClientRect || !vv) return
  const r = el.getBoundingClientRect()
  const bottom = vv.offsetTop + vv.height - MARGIN
  if (r.bottom > bottom || r.top < vv.offsetTop) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

function isField(el) {
  return el instanceof HTMLElement && (el.matches('input, textarea, select') || el.isContentEditable)
}

export function installKeyboardViewport() {
  if (typeof window === 'undefined' || !window.visualViewport) return
  window.visualViewport.addEventListener('resize', update)
  window.visualViewport.addEventListener('scroll', update)
  // Once the keyboard is up (the viewport has shrunk), bring the field into view.
  document.addEventListener('focusin', (e) => {
    if (!isField(e.target)) return
    setTimeout(() => { update(); reveal(e.target) }, 350)
  })
  update()
}
