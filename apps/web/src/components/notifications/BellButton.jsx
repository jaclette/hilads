import { useEffect, useRef, useState } from 'react'
import { useNotifCounts } from '../../lib/notifCounts'

/**
 * The header bell (V6): neutral when everything is read; with something new it
 * turns orange, shows the count ("3", "9+") and rings (a short wiggle, none with
 * reduced motion) on load and each time the count goes up. `variant`: the mobile
 * header's round button ('round') or the desktop header's ('desktop').
 */
export default function BellButton({ onClick, label, variant = 'round' }) {
  const { total } = useNotifCounts()
  const prev = useRef(0)
  const [ring, setRing] = useState(0)
  useEffect(() => {
    if (total > prev.current) setRing(r => r + 1)
    prev.current = total
  }, [total])
  const on = total > 0
  const size = variant === 'desktop' ? 24 : 21
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
            className={`${variant === 'desktop' ? 'header-icon-btn' : 'v3-round'} n6-bell${on ? ' n6-bell--on' : ''}`}>
      <span key={ring} className={`n6-bell-icon${ring ? ' n6-bell-icon--ring' : ''}`}>
        <svg width={size} height={size} viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      </span>
      {on && <span className="n6-bell-badge">{total > 9 ? '9+' : total}</span>}
    </button>
  )
}
