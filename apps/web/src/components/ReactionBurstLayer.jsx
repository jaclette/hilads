import { useEffect, useRef } from 'react'

/**
 * ReactionBurstLayer
 *
 * Fixed full-screen overlay (pointer-events: none) that renders ephemeral
 * reaction animations anchored to message bubbles.
 *
 * Each burst: { id, type, x, y }
 *   - type: 'heart' | 'like' | 'laugh' | 'wow' | 'fire'
 *   - x/y:  page-relative origin (centre of the message element)
 *
 * All animation nodes are raw DOM — the message list never re-renders.
 */

// ── Per-type config ───────────────────────────────────────────────────────────

const CONFIGS = {
  heart: {
    emoji:    '❤️',
    count:    6,
    duration: 1200,
    anim:     'raBurstHeart',
    stagger:  60,
    size:     [14, 24],
    dx:       [-30, 30],
    dy:       [-100, -40],
  },
  like: {
    emoji:    '👍',
    count:    5,
    duration: 900,
    anim:     'raBurstLike',
    stagger:  50,
    size:     [16, 26],
    dx:       [-25, 25],
    dy:       [-80, -30],
  },
  laugh: {
    emoji:    '😂',
    count:    5,
    duration: 1100,
    anim:     'raBurstLaugh',
    stagger:  70,
    size:     [16, 26],
    dx:       [-35, 35],
    dy:       [-90, -40],
  },
  wow: {
    emoji:    '😮',
    count:    4,
    duration: 1000,
    anim:     'raBurstWow',
    stagger:  80,
    size:     [18, 30],
    dx:       [-20, 20],
    dy:       [-70, -30],
  },
  fire: {
    emoji:    '🔥',
    count:    7,
    duration: 1300,
    anim:     'raBurstFire',
    stagger:  45,
    size:     [14, 22],
    dx:       [-20, 20],
    dy:       [-110, -50],
  },
}

// ── Spawn ─────────────────────────────────────────────────────────────────────

function rand(min, max) { return min + Math.random() * (max - min) }

function spawnBurst(containerEl, type, x, y) {
  const cfg = CONFIGS[type] ?? CONFIGS.heart
  const { emoji, count, duration, anim, stagger, size, dx, dy } = cfg

  for (let i = 0; i < count; i++) {
    const el = document.createElement('div')
    el.textContent = emoji
    const delay = i * stagger
    const dur   = duration - 100 + Math.random() * 200
    el.style.cssText = [
      'position:absolute',
      `left:${x}px`,
      `top:${y}px`,
      `font-size:${rand(...size)}px`,
      `--dx:${rand(...dx)}px`,
      `--dy:${rand(...dy)}px`,
      `--rot:${rand(-25, 25)}deg`,
      `animation-delay:${delay}ms`,
      `animation-duration:${dur}ms`,
      `animation-name:${anim}`,
      'animation-timing-function:ease-out',
      'animation-fill-mode:forwards',
      'pointer-events:none',
      'user-select:none',
      'transform-origin:center',
      'will-change:transform,opacity',
    ].join(';')
    containerEl.appendChild(el)
    setTimeout(() => el.remove(), dur + delay + 50)
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ReactionBurstLayer({ bursts, onDone }) {
  const containerRef = useRef(null)
  const seenRef      = useRef(new Set())

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    bursts.forEach(burst => {
      if (seenRef.current.has(burst.id)) return
      seenRef.current.add(burst.id)

      spawnBurst(container, burst.type, burst.x, burst.y)

      const cfg      = CONFIGS[burst.type] ?? CONFIGS.heart
      const lifetime = cfg.duration + cfg.count * cfg.stagger + 100
      setTimeout(() => {
        onDone(burst.id)
        seenRef.current.delete(burst.id)
      }, lifetime)
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
