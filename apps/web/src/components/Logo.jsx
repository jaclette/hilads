// ── Logo ──────────────────────────────────────────────────────────────────────
// Reusable brand mark. Embeds SVG inline for crisp rendering at any size.
//
// variant: 'icon' | 'wordmark'  (default: 'wordmark')
// size:    'sm' | 'md' | 'lg'   (default: 'md')

const SIZES = {
  sm: { icon: 22, fontSize: '0.85rem', gap: 6 },
  md: { icon: 32, fontSize: '1.1rem',  gap: 8 },
  lg: { icon: 46, fontSize: '1.5rem',  gap: 11 },
}

export default function Logo({ variant = 'wordmark', size = 'md' }) {
  const s = SIZES[size] || SIZES.md
  return (
    <span className="logo" style={{ gap: s.gap }}>
      <svg
        width={s.icon}
        height={s.icon}
        viewBox="0 0 56 56"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ flexShrink: 0, display: 'block' }}
        aria-hidden="true"
      >
        <rect width="56" height="56" rx="10" fill="#0a0a0f" />
        {/* › chevron prompt */}
        <line x1="10" y1="18" x2="19" y2="28" stroke="#8b5cf6" strokeWidth="3" strokeLinecap="round" />
        <line x1="19" y1="28" x2="10" y2="38" stroke="#8b5cf6" strokeWidth="3" strokeLinecap="round" />
        {/* H — left stem */}
        <rect x="24" y="16" width="5" height="24" rx="1" fill="#f8f8fc" />
        {/* H — right stem */}
        <rect x="37" y="16" width="5" height="24" rx="1" fill="#f8f8fc" />
        {/* H — crossbar */}
        <rect x="29" y="26" width="8" height="3.5" rx="1" fill="#f8f8fc" />
        {/* cursor */}
        <rect x="45" y="16" width="5" height="24" rx="1" fill="#06b6d4" opacity="0.9" />
      </svg>

      {variant === 'wordmark' && (
        <span className="logo-wordmark" style={{ fontSize: s.fontSize }}>
          hilads
        </span>
      )}
    </span>
  )
}
