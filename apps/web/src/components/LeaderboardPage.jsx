import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchLeaderboard } from '../api'
import { localizeCityName } from '../i18n/cityName'
import BackButton from './BackButton'

/**
 * PR7 — Leaderboard screen. Reached from the 🏆 chip on the city header.
 *
 * Selectors:
 *   - scope:  My city (default) | World
 *   - period: This month (default) | All-time
 *
 * The caller's row is pinned at the bottom when they're outside the visible
 * page; when they have no points in the scope/period, the pinned slot becomes
 * a "Take a challenge to get on the board" nudge.
 *
 * Mounted by App.jsx with { account, city, channelId } when showLeaderboard
 * is true. cityChannelId is the integer (matches mobile city?.channelId).
 */

const AVATAR_PALETTES = [
  ['#7c6aff', '#c084fc'], ['#ff6a9f', '#fb7185'], ['#22d3ee', '#38bdf8'],
  ['#4ade80', '#34d399'], ['#fb923c', '#fbbf24'], ['#f472b6', '#e879f9'],
  ['#818cf8', '#60a5fa'], ['#2dd4bf', '#a3e635'],
]
function avatarColors(name = '') {
  const hash = name.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0)
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

const PAGE_SIZE = 50

export default function LeaderboardPage({ account, city, cityChannelId, onBack, initialScope = 'city' }) {
  const { t } = useTranslation('challenge')

  // PR38 — initialScope lets callers (e.g. the score celebration popin's
  // rank rows) request a starting scope. Default 'city' preserves the
  // existing entry from the trophy chip.
  const [scope,  setScope]  = useState(initialScope === 'world' ? 'world' : 'city')
  const [period, setPeriod] = useState('month')

  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const cityId = cityChannelId ? `city_${cityChannelId}` : undefined

  const load = useCallback(async () => {
    setError(null)
    const res = await fetchLeaderboard({
      scope, period,
      limit:  PAGE_SIZE,
      offset: 0,
      cityId: scope === 'city' ? cityId : undefined,
    })
    if (res === null) setError(t('leaderboard.errLoad'))
    else              setData(res)
    setLoading(false)
  }, [scope, period, cityId, t])

  useEffect(() => { setLoading(true); load() }, [load])

  const entries = data?.entries ?? []
  const me      = data?.me
  const meInPage = !!me && me.rank !== null && entries.some(e => e.user_id === me.user_id)

  const cityLabel = localizeCityName(city) || t('leaderboard.scope.city')

  return (
    <div className="full-page leaderboard-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{t('leaderboard.title')}</span>
      </div>

      <div className="leaderboard-selectors">
        <div className="leaderboard-seg leaderboard-seg--primary">
          <button
            type="button"
            className={`leaderboard-seg-item${scope === 'city' ? ' is-active' : ''}`}
            onClick={() => setScope('city')}
          >
            {cityLabel}
          </button>
          <button
            type="button"
            className={`leaderboard-seg-item${scope === 'world' ? ' is-active' : ''}`}
            onClick={() => setScope('world')}
          >
            {t('leaderboard.scope.world')}
          </button>
        </div>
        <div className="leaderboard-seg">
          <button
            type="button"
            className={`leaderboard-seg-item${period === 'month' ? ' is-active' : ''}`}
            onClick={() => setPeriod('month')}
          >
            {t('leaderboard.period.month')}
          </button>
          <button
            type="button"
            className={`leaderboard-seg-item${period === 'alltime' ? ' is-active' : ''}`}
            onClick={() => setPeriod('alltime')}
          >
            {t('leaderboard.period.alltime')}
          </button>
        </div>
      </div>

      <div className="page-body" style={{ padding: 0 }}>
        {loading && !data ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted, #b3b3b3)' }}>…</div>
        ) : error ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 40, gap: 12 }}>
            <span style={{ fontSize: 48 }}>🤷</span>
            <p style={{ color: 'var(--muted, #b3b3b3)', margin: 0 }}>{error}</p>
          </div>
        ) : entries.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 40, gap: 12 }}>
            <span style={{ fontSize: 48 }}>🥇</span>
            <h3 style={{ margin: 0 }}>{t('leaderboard.empty.title')}</h3>
            <p style={{ color: 'var(--muted, #b3b3b3)', margin: 0 }}>{t('leaderboard.empty.body')}</p>
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {entries.map(e => (
              <LeaderboardRow
                key={e.user_id}
                entry={e}
                isMe={e.user_id === me?.user_id}
                t={t}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Pinned caller row — only when not already in the visible page. */}
      {me && !meInPage && (
        <div className="leaderboard-pinned">
          {me.rank !== null ? (
            <LeaderboardRow
              entry={{
                rank:           me.rank,
                user_id:        me.user_id,
                displayName:    account?.display_name ?? '',
                thumbAvatarUrl: account?.profile_thumb_photo_url
                              ?? account?.profile_photo_url
                              ?? null,
                points:         me.points,
              }}
              isMe
              t={t}
            />
          ) : (
            <div className="leaderboard-unranked">
              {t('leaderboard.me.unranked')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LeaderboardRow({ entry, isMe, t }) {
  const [c1, c2] = avatarColors(entry.displayName)
  return (
    <li className={`leaderboard-row${isMe ? ' is-me' : ''}`}>
      <span className="leaderboard-rank">#{entry.rank}</span>
      <span
        className="leaderboard-avatar"
        style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
      >
        {entry.thumbAvatarUrl
          ? <img src={entry.thumbAvatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : (entry.displayName ?? '?')[0].toUpperCase()}
      </span>
      <span className="leaderboard-name">{entry.displayName}</span>
      <span className="leaderboard-points">
        {t('leaderboard.points', { points: entry.points })}
      </span>
    </li>
  )
}
