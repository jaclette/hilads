import { countryToFlag } from '../lib/countryFlag'

/**
 * Circle avatar with an optional country-flag badge in the bottom-right.
 * Web mirror of apps/mobile/src/components/AvatarWithFlag.tsx. Sized via
 * props so the same component renders 72px versus avatars and could
 * later cover smaller surfaces (leaderboard rows, profile headers).
 *
 * - photoUrl present  → render the image, no fallback
 * - photoUrl missing  → flat-color disc + first initial of displayName
 *                       (fallbackBg defaults to a brand-orange tint so
 *                       the component looks intentional even without a
 *                       deterministic-color helper on web)
 * - countryCode valid → small flag overlay at ~36% size, white-ringed
 *                       so it visually detaches from the avatar behind
 *
 * Pass null/undefined for countryCode to suppress the flag (local
 * challenges, non-international surfaces).
 */
export default function AvatarWithFlag({
  userId,        // unused on web for now — kept for API symmetry with mobile
  displayName,
  photoUrl,
  countryCode,
  size = 72,
}) {
  const flag       = countryCode ? countryToFlag(countryCode) : ''
  const initial    = (displayName ?? '?').slice(0, 1).toUpperCase()
  const flagSize   = Math.round(size * 0.36)
  const flagOffset = -Math.round(flagSize * 0.18)

  const wrapStyle = {
    position: 'relative',
    width:    size,
    height:   size,
    flexShrink: 0,
  }
  const avatarStyle = {
    width:        size,
    height:       size,
    borderRadius: size / 2,
    overflow:     'hidden',
    display:      'flex',
    alignItems:   'center',
    justifyContent: 'center',
    background:   'linear-gradient(135deg, #C24A38, #B87228)',
    color:        '#fff',
    fontWeight:   700,
    fontSize:     Math.round(size * 0.4),
  }
  const flagRingStyle = {
    position:     'absolute',
    right:        flagOffset,
    bottom:       flagOffset,
    width:        flagSize,
    height:       flagSize,
    borderRadius: flagSize / 2,
    overflow:     'hidden',
    background:   'var(--surface, #161210)',
    border:       '2px solid var(--surface, #161210)',
    display:      'flex',
    alignItems:   'center',
    justifyContent: 'center',
    fontSize:     Math.round(flagSize * 0.78),
    lineHeight:   1,
  }

  return (
    <span style={wrapStyle}>
      <span style={avatarStyle}>
        {photoUrl ? (
          <img
            src={photoUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : initial}
      </span>
      {flag && (
        <span style={flagRingStyle} aria-hidden="true">{flag}</span>
      )}
    </span>
  )
}
