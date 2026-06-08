import { avatarColors } from '../lib/avatarColors'

const MAX_SHOWN = 5

// Horizontal row of overlapping circular attendee avatars for event cards.
// Lazy-loaded photo when available, else a deterministic initial on a gradient.
// Renders nothing when nobody has joined. Sits inside the clickable card, so it
// has no own click handler - tapping the card opens the going list.
export default function AttendeeAvatars({ preview = [], total = 0, onClick }) {
  const shown = preview.slice(0, MAX_SHOWN)
  if (total <= 0 || shown.length === 0) return null

  const overflow = total - shown.length

  // When onClick is set, the row opens the members list and stops the tap from
  // bubbling to the parent card.
  const handleClick = onClick ? (e) => { e.stopPropagation(); onClick() } : undefined

  return (
    <div
      className={`attendee-avatars${onClick ? ' attendee-avatars--tappable' : ''}`}
      aria-hidden={onClick ? undefined : 'true'}
      role={onClick ? 'button' : undefined}
      onClick={handleClick}
    >
      {shown.map(p => {
        const [c1, c2] = avatarColors(p.id)
        return (
          <span
            key={p.id}
            className="attendee-avatar"
            style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
          >
            {p.thumbAvatarUrl
              ? <img className="attendee-avatar-img" src={p.thumbAvatarUrl} alt="" loading="lazy" />
              : (p.displayName?.[0] ?? '?').toUpperCase()}
          </span>
        )
      })}
      {overflow > 0 && (
        <span className="attendee-avatar attendee-overflow">+{overflow}</span>
      )}
    </div>
  )
}
