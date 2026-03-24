import { useState, useEffect } from 'react'
import { fetchPublicProfile } from '../api'
import BackButton from './BackButton'

const AVATAR_PALETTES = [
  ['#7c6aff', '#c084fc'], ['#ff6a9f', '#fb7185'], ['#22d3ee', '#38bdf8'],
  ['#4ade80', '#34d399'], ['#fb923c', '#fbbf24'], ['#f472b6', '#e879f9'],
  ['#818cf8', '#60a5fa'], ['#2dd4bf', '#a3e635'],
]

function avatarColors(name) {
  const hash = (name || '?').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

export default function PublicProfileScreen({ userId, onBack }) {
  const [user, setUser]   = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchPublicProfile(userId)
      .then(data => setUser(data.user))
      .catch(() => setError('Could not load profile.'))
  }, [userId])

  const name = user?.display_name ?? '?'
  const [c1, c2] = avatarColors(name)

  return (
    <div className="full-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">Profile</span>
      </div>

      <div className="page-body pub-profile-body">
        {error && <p className="profile-error">{error}</p>}

        {!user && !error && <p className="pub-profile-loading">Loading…</p>}

        {user && (
          <>
            <div className="pub-profile-hero">
              {user.profile_photo_url
                ? <img className="online-avatar pub-profile-avatar" src={user.profile_photo_url} alt={name} />
                : <span className="online-avatar pub-profile-avatar" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                    {name[0].toUpperCase()}
                  </span>
              }
              <h2 className="pub-profile-name">{name}</h2>
              <span className="pub-profile-member-badge">member</span>
            </div>

            <div className="pub-profile-details">
              {user.home_city && (
                <div className="pub-profile-detail-row">
                  <span className="pub-profile-detail-label">From</span>
                  <span className="pub-profile-detail-value">{user.home_city}</span>
                </div>
              )}
              {user.age != null && (
                <div className="pub-profile-detail-row">
                  <span className="pub-profile-detail-label">Age</span>
                  <span className="pub-profile-detail-value">{user.age}</span>
                </div>
              )}
            </div>

            {user.interests?.length > 0 && (
              <div className="pub-profile-interests">
                {user.interests.map(i => (
                  <span key={i} className="interest-chip interest-chip--on interest-chip--readonly">{i}</span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
