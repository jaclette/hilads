import { useId } from 'react'

/**
 * The Launch Season's art (the app's HalongArt): a Ha Long Bay sunset, limestone peaks, a junk
 * boat, a plane on a dotted route, confetti. Fixed event colors in every theme; covers its box.
 */
export default function HalongArt() {
  const id = useId().replace(/:/g, '')
  return (
    <svg className="ls-art" viewBox="0 0 390 196" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#D7263D" /><stop offset=".45" stopColor="#FF7A3C" /><stop offset=".85" stopColor="#FFB627" />
        </linearGradient>
        <linearGradient id={`${id}sea`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0F7B74" /><stop offset="1" stopColor="#0B4F4C" /></linearGradient>
      </defs>
      <rect width="390" height="196" fill={`url(#${id}sky)`} />
      <circle cx="262" cy="112" r="38" fill="#FFE29A" />
      <g opacity=".9">
        <rect x="40" y="26" width="6" height="12" rx="2" fill="#FFE29A" transform="rotate(25 43 32)" />
        <rect x="118" y="18" width="6" height="12" rx="2" fill="#fff" transform="rotate(-30 121 24)" />
        <circle cx="330" cy="30" r="4" fill="#FFE29A" />
        <rect x="188" y="40" width="6" height="12" rx="2" fill="#0F7B74" transform="rotate(50 191 46)" />
        <circle cx="76" cy="70" r="3.5" fill="#fff" />
        <rect x="356" y="64" width="6" height="12" rx="2" fill="#fff" transform="rotate(-20 359 70)" />
      </g>
      <path d="M20 96 Q 130 20 230 52" fill="none" stroke="#fff" strokeWidth="2.5" strokeDasharray="2 7" strokeLinecap="round" opacity=".9" />
      <g transform="translate(232 50) rotate(18)">
        <path d="M0 0 L-16 -4 L-20 0 L-16 4 Z" fill="#fff" />
        <path d="M-9 0 L-14 -11 L-10 -11 L-3 0 L-10 11 L-14 11 Z" fill="#fff" />
      </g>
      <path d="M0 150 C 20 70, 44 70, 58 150 Z" fill="#0B4F4C" />
      <path d="M40 150 C 62 96, 84 92, 104 150 Z" fill="#0F7B74" />
      <path d="M300 150 C 318 60, 350 58, 372 150 Z" fill="#0B4F4C" />
      <path d="M350 150 C 366 104, 384 104, 398 150 Z" fill="#0F7B74" />
      <path d="M150 150 C 166 118, 184 116, 196 150 Z" fill="#0B4F4C" opacity=".85" />
      <rect y="148" width="390" height="48" fill={`url(#${id}sea)`} />
      <g stroke="#FFE29A" strokeWidth="2" strokeLinecap="round" opacity=".7"><path d="M236 162 h52" /><path d="M246 172 h32" /><path d="M254 182 h16" /></g>
      <g transform="translate(110 150)">
        <path d="M-22 0 H22 L16 8 H-16 Z" fill="#21160F" />
        <path d="M-2 0 V-30 L14 -8 Z" fill="#D7263D" />
        <path d="M-6 0 V-22 L-18 -4 Z" fill="#D7263D" />
      </g>
    </svg>
  )
}
