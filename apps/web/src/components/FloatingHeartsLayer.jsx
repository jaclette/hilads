import { useEffect, useRef } from 'react'

/**
 * FloatingHeartsLayer
 *
 * A fixed full-screen overlay (pointer-events: none) that renders ephemeral
 * floating-heart animations anchored to specific messages.
 *
 * Usage:
 *   <FloatingHeartsLayer bursts={heartBursts} onDone={id => removeBurst(id)} />
 *
 * Each burst: { id, x, y }  — page-relative origin (centre of the message bubble).
 * Hearts are created as raw DOM nodes so the message list never re-renders.
 */

const HEARTS_PER_BURST = 6
const DURATION_MS      = 1200

function spawnHearts(containerEl, x, y) {
  for (let i = 0; i < HEARTS_PER_BURST; i++) {
    const el = document.createElement('div')
    el.textContent = '❤️'
    el.style.cssText = [
      'position:absolute',
      `left:${x}px`,
      `top:${y}px`,
      `font-size:${14 + Math.random() * 10}px`,
      `--dx:${(Math.random() - 0.5) * 60}px`,
      `--dy:${-(40 + Math.random() * 60)}px`,
      `animation-delay:${i * 60}ms`,
      `animation-duration:${DURATION_MS - 100 + Math.random() * 200}ms`,
      'animation-name:fhFloat',
      'animation-timing-function:ease-out',
      'animation-fill-mode:forwards',
      'pointer-events:none',
      'user-select:none',
      'transform-origin:center',
      'will-change:transform,opacity',
    ].join(';')
    containerEl.appendChild(el)
    const totalTime = DURATION_MS + i * 60 + 50
    setTimeout(() => el.remove(), totalTime)
  }
}

export default function FloatingHeartsLayer({ bursts, onDone }) {
  const containerRef = useRef(null)
  const seenRef      = useRef(new Set())

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    bursts.forEach(burst => {
      if (seenRef.current.has(burst.id)) return
      seenRef.current.add(burst.id)
      spawnHearts(container, burst.x, burst.y)
      // notify parent to remove this burst from state after animation ends
      setTimeout(() => {
        onDone(burst.id)
        seenRef.current.delete(burst.id)
      }, DURATION_MS + HEARTS_PER_BURST * 60 + 100)
    })
  }, [bursts, onDone])

  return (
    <div
      ref={containerRef}
      style={{
        position:      'fixed',
        inset:         0,
        pointerEvents: 'none',
        zIndex:        9999,
        overflow:      'hidden',
      }}
    />
  )
}
