import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchLeaderboard } from '../api'

// Mirrors LeaderboardPage's avatar palette so the podium matches the full screen.
const AVATAR_PALETTES = [
  ['#7c6aff', '#c084fc'], ['#ff6a9f', '#fb7185'], ['#22d3ee', '#38bdf8'],
  ['#4ade80', '#34d399'], ['#fb923c', '#fbbf24'], ['#f472b6', '#e879f9'],
  ['#818cf8', '#60a5fa'], ['#2dd4bf', '#a3e635'],
]
function avatarColors(name = '') {
  const hash = name.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0)
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

function PodiumSlot({ entry, first }) {
  const name = entry.displayName ?? '?'
  const [c1, c2] = avatarColors(entry.user_id ?? name)
  return (
    <div className={`mlp-slot${first ? ' mlp-slot--first' : ''}`}>
      {first && <span className="mlp-crown" aria-hidden="true">👑</span>}
      <span className="mlp-avatar" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
        {entry.thumbAvatarUrl ? <img src={entry.thumbAvatarUrl} alt="" /> : name[0].toUpperCase()}
      </span>
      <span className="mlp-meta"><strong>{entry.rank}</strong> · {name}</span>
    </div>
  )
}

/**
 * "Most Local" podium teaser — top 3 of the city (all-time) leaderboard.
 * Reuses fetchLeaderboard (no new query). Rank 1 centered + crowned; 2 left,
 * 3 right. Hidden when nobody is ranked yet; degrades cleanly with < 3.
 */
export default function MostLocalCard({ channelId, onSeeAll }) {
  const { t } = useTranslation('challenge')
  const [entries, setEntries] = useState(null) // null = loading, [] = loaded/empty

  useEffect(() => {
    let alive = true
    setEntries(null)
    if (!channelId) { setEntries([]); return }
    fetchLeaderboard({ scope: 'city', period: 'alltime', limit: 3, offset: 0, cityId: `city_${channelId}` })
      .then(res => { if (alive) setEntries(res?.entries ?? []) })
      .catch(() => { if (alive) setEntries([]) })
    return () => { alive = false }
  }, [channelId])

  // Nobody ranked yet → don't render the card at all (keeps the tab clean).
  if (entries && entries.length === 0) return null

  const byRank = r => (entries ?? []).find(e => e.rank === r)
  const first = byRank(1), second = byRank(2), third = byRank(3)

  return (
    <div className="most-local-card">
      <div className="most-local-head">
        <span className="most-local-title">🏆 {t('mostLocal')}</span>
        <button type="button" className="most-local-seeall" onClick={onSeeAll}>{t('seeAll')} ›</button>
      </div>

      {entries === null ? (
        <div className="most-local-podium">
          <div className="mlp-slot"><span className="mlp-avatar mlp-avatar--skel" /></div>
          <div className="mlp-slot mlp-slot--first"><span className="mlp-avatar mlp-avatar--skel" /></div>
          <div className="mlp-slot"><span className="mlp-avatar mlp-avatar--skel" /></div>
        </div>
      ) : (
        <div className="most-local-podium">
          {second ? <PodiumSlot entry={second} /> : <div className="mlp-slot" aria-hidden="true" />}
          {first  ? <PodiumSlot entry={first} first /> : <div className="mlp-slot mlp-slot--first" aria-hidden="true" />}
          {third  ? <PodiumSlot entry={third} /> : <div className="mlp-slot" aria-hidden="true" />}
        </div>
      )}
    </div>
  )
}
