import BackButton from './BackButton'

// ── Avatar palette — mirrors App.jsx / PublicProfileScreen ────────────────────

const AVATAR_PALETTES = [
  ['#7c6aff', '#c084fc'], ['#ff6a9f', '#fb7185'], ['#22d3ee', '#38bdf8'],
  ['#4ade80', '#34d399'], ['#fb923c', '#fbbf24'], ['#f472b6', '#e879f9'],
  ['#818cf8', '#60a5fa'], ['#2dd4bf', '#a3e635'],
]

function avatarColors(name) {
  const hash = (name || '?').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GuestProfileCard({ guestId, nickname, cityName, onBack }) {
  const name    = nickname || 'Ghost'
  const initial = name[0].toUpperCase()
  const [c1, c2] = avatarColors(name)

  return (
    <div className="full-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">Profile</span>
      </div>

      <div className="pub-profile-body">
        <div className="pub-profile-hero">
          <span
            className="msg-avatar pub-profile-avatar"
            style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
          >
            {initial}
          </span>
          <div className="pub-profile-name">{name}</div>
          <div className="guest-profile-badge">👻 Ghost</div>
          {cityName && (
            <div className="guest-profile-city">Visiting {cityName}</div>
          )}
        </div>

        <p className="guest-profile-note">
          Floating around as a ghost 👻
        </p>
      </div>
    </div>
  )
}
