// ── Logo ──────────────────────────────────────────────────────────────────────
// Reusable brand mark. Embeds SVG inline for crisp rendering at any size.
//
// variant: 'icon' | 'wordmark'  (default: 'wordmark')
// size:    'sm' | 'md' | 'lg'   (default: 'md')
//
// Each instance generates a unique gradient ID via useId() to prevent
// cross-SVG gradient resolution issues when multiple Logo instances are in
// the DOM simultaneously (e.g. desktop hidden + mobile visible in chat header).

import { useId } from 'react'

const SIZES = {
  sm: { icon: 22, fontSize: '0.85rem', gap: 6 },
  md: { icon: 32, fontSize: '1.1rem',  gap: 8 },
  lg: { icon: 46, fontSize: '1.5rem',  gap: 11 },
}

export default function Logo({ variant = 'wordmark', size = 'md' }) {
  const uid = useId()
  const gid = `hi-g-${uid.replace(/:/g, '')}`
  const s = SIZES[size] || SIZES.md
  return (
    <span className="logo" style={{ gap: s.gap }}>
      <svg
        width={s.icon}
        height={s.icon}
        viewBox="0 0 64 64"
        xmlns="http://www.w3.org/2000/svg"
        style={{ flexShrink: 0, display: 'block' }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gid} x1="5%" y1="0%" x2="95%" y2="100%">
            <stop offset="0%"   stopColor="#C24A38" />
            <stop offset="44%"  stopColor="#B85530" />
            <stop offset="100%" stopColor="#B87228" />
          </linearGradient>
        </defs>
        {/* Background */}
        <rect width="64" height="64" rx="15" fill={`url(#${gid})`} />
        {/* H */}
        <rect x="9"  y="13" width="8" height="38" rx="2.5" fill="white" />
        <rect x="26" y="13" width="8" height="38" rx="2.5" fill="white" />
        <rect x="17" y="28" width="9" height="6"  rx="2"   fill="white" />
        {/* ¡ */}
        <rect x="43" y="25" width="8" height="26" rx="2.5" fill="white" />
        <circle className="hi-dot" cx="47" cy="15" r="5.5" fill="white" />
      </svg>

      {variant === 'wordmark' && (
        <span className="logo-wordmark" style={{ fontSize: s.fontSize }}>
          hilads
        </span>
      )}
    </span>
  )
}
