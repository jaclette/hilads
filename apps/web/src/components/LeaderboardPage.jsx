import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchLeaderboard } from '../api'
import { localizeCityName } from '../i18n/cityName'
import { cityDemonym } from '../lib/cityDemonym'
import { countryToFlag } from '../lib/countryFlag'
import LeaderboardCityPickerModal from './LeaderboardCityPickerModal'
import BackButton from './BackButton'

/**
 * PR7 - Leaderboard screen. Reached from the 🏆 chip on the city header.
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

export default function LeaderboardPage({ account, city, cityChannelId, onBack, onOpenProfile, onCreateChallenge, initialScope = 'city' }) {
  const { t } = useTranslation('challenge')

  // PR38 - initialScope lets callers (e.g. the score celebration popin's
  // rank rows) request a starting scope. Default 'city' preserves the
  // existing entry from the trophy chip.
  const [scope,  setScope]  = useState(initialScope === 'world' ? 'world' : 'city')
  const [period, setPeriod] = useState('month')

  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  // PR41 - picker-overridden city for the leaderboard view. Null = use the
  // caller's current city (default behaviour). Setting this DOES NOT change
  // the user's actual current_city anywhere else in the app - same scope as
  // the mobile picker (PR13).
  const [pickedCity,      setPickedCity]      = useState(null) // { channelId, name, country? } | null
  const [cityPickerOpen,  setCityPickerOpen]  = useState(false)

  const fallbackChannelId = cityChannelId ? String(cityChannelId) : null
  const effectiveChannelId   = pickedCity?.channelId ?? fallbackChannelId
  const effectiveCityName    = pickedCity?.name      ?? city?.name ?? city ?? null
  const effectiveCityCountry = pickedCity?.country   ?? city?.country ?? null
  const apiCityId = effectiveChannelId ? `city_${effectiveChannelId}` : undefined

  const load = useCallback(async () => {
    setError(null)
    const res = await fetchLeaderboard({
      scope, period,
      limit:  PAGE_SIZE,
      offset: 0,
      cityId: scope === 'city' ? apiCityId : undefined,
    })
    if (res === null) setError(t('leaderboard.errLoad'))
    else              setData(res)
    setLoading(false)
  }, [scope, period, apiCityId, t])

  useEffect(() => { setLoading(true); load() }, [load])

  const entries = data?.entries ?? []
  const me      = data?.me
  const meInPage = !!me && me.rank !== null && entries.some(e => e.user_id === me.user_id)

  const cityLabel = localizeCityName(effectiveCityName) || t('leaderboard.scope.city')
  const cityFlag  = effectiveCityCountry ? countryToFlag(effectiveCityCountry) : ''

  return (
    <div className="full-page leaderboard-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{(() => {
          const demonym = scope === 'city' ? cityDemonym(effectiveCityName) : null
          return demonym
            ? t('leaderboard.titleCity', { demonym, defaultValue: `🏆 Most ${demonym}` })
            : t('leaderboard.title')
        })()}</span>
      </div>

      <div className="leaderboard-selectors">
        <div className="leaderboard-seg leaderboard-seg--primary">
          <button
            type="button"
            className={`leaderboard-seg-item${scope === 'city' ? ' is-active' : ''}`}
            // PR41 - first click selects the City scope; while the City
            // tab is ALREADY active, the click instead opens the city
            // picker. Mirrors the mobile gesture (tap the city pill →
            // sheet appears) without taking a second slot of chrome.
            onClick={() => {
              if (scope === 'city') setCityPickerOpen(true)
              else                  setScope('city')
            }}
            aria-haspopup={scope === 'city' ? 'dialog' : undefined}
          >
            {cityFlag && <span aria-hidden="true">{cityFlag} </span>}{cityLabel}
            {scope === 'city' && (
              <span className="leaderboard-seg-chevron" aria-hidden="true">▾</span>
            )}
          </button>
          <button
            type="button"
            className={`leaderboard-seg-item${scope === 'cities' ? ' is-active' : ''}`}
            onClick={() => setScope('cities')}
          >
            <span aria-hidden="true">🏙️ </span>{t('leaderboard.scope.cities')}
          </button>
          <button
            type="button"
            className={`leaderboard-seg-item${scope === 'world' ? ' is-active' : ''}`}
            onClick={() => setScope('world')}
          >
            <span aria-hidden="true">🌐 </span>{t('leaderboard.scope.world')}
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
            {entries.map(e => {
              if (scope === 'cities') {
                const myCityId = cityChannelId ? `city_${cityChannelId}` : null
                return (
                  <LeaderboardCityRow
                    key={e.city_id ?? `r${e.rank}`}
                    entry={e}
                    isMe={!!myCityId && e.city_id === myCityId}
                    t={t}
                  />
                )
              }
              return (
                <LeaderboardRow
                  key={e.user_id}
                  entry={e}
                  isMe={e.user_id === me?.user_id}
                  showCity={scope === 'world'}
                  onPress={onOpenProfile ? () => onOpenProfile(e.user_id, e.displayName) : undefined}
                  t={t}
                />
              )
            })}
          </ul>
        )}
      </div>

      {/* Pinned caller row - only when not already in the visible page.
          Cities scope shows the caller's CITY pinned (the city ranking
          the user belongs to), not the caller themselves. */}
      {me && !meInPage && (
        <div className="leaderboard-pinned">
          {me.rank !== null && scope === 'cities' ? (
            <LeaderboardCityRow
              entry={{
                rank:        me.rank,
                city_id:     cityChannelId ? `city_${cityChannelId}` : undefined,
                cityName:    city?.name    ?? null,
                cityCountry: city?.country ?? null,
                points:      me.points,
              }}
              isMe
              t={t}
            />
          ) : me.rank !== null ? (
            <LeaderboardRow
              entry={{
                rank:           me.rank,
                user_id:        me.user_id,
                displayName:    account?.display_name ?? '',
                thumbAvatarUrl: account?.profile_thumb_photo_url
                              ?? account?.profile_photo_url
                              ?? null,
                points:         me.points,
                // PR40 - surface the caller's own city + flag on the pinned
                // row when in world scope, same as the mobile row.
                cityName:       city?.name    ?? null,
                cityCountry:    city?.country ?? null,
              }}
              isMe
              showCity={scope === 'world'}
              onPress={onOpenProfile ? () => onOpenProfile(me.user_id, account?.display_name ?? '') : undefined}
              t={t}
            />
          ) : (
            <button
              type="button"
              className="leaderboard-unranked-cta"
              onClick={onCreateChallenge}
            >
              <span className="leaderboard-unranked-cta-label">
                🔥 {t('leaderboard.me.unranked')}
              </span>
              <span className="leaderboard-unranked-cta-arrow" aria-hidden="true">→</span>
            </button>
          )}
        </div>
      )}

      {/* PR41 - city picker modal. Selecting a row overrides the
          leaderboard's view scope; the user's actual current_city is
          unchanged everywhere else. */}
      <LeaderboardCityPickerModal
        visible={cityPickerOpen}
        selectedChannelId={effectiveChannelId}
        onSelect={(channelId, picked) => {
          setPickedCity({ channelId: String(channelId), name: picked.name, country: picked.country })
          setCityPickerOpen(false)
        }}
        onClose={() => setCityPickerOpen(false)}
      />
    </div>
  )
}

function LeaderboardRow({ entry, isMe, showCity = false, onPress, t }) {
  const [c1, c2] = avatarColors(entry.displayName)
  // PR40 - world-scope rows show a "🇫🇷 Paris" chip under the name so the
  // user can see where each scorer is from. Matches the native row layout
  // (apps/mobile/app/leaderboard.tsx) - uses countryToFlag + the same
  // city-name localization helper.
  const flag      = showCity && entry.cityCountry ? countryToFlag(entry.cityCountry) : ''
  const cityLabel = showCity && entry.cityName    ? localizeCityName(entry.cityName) : null
  const hasCityChip = !!(flag || cityLabel)
  return (
    <li
      className={`leaderboard-row${isMe ? ' is-me' : ''}${onPress ? ' leaderboard-row--tappable' : ''}`}
      onClick={onPress}
      role={onPress ? 'button' : undefined}
      tabIndex={onPress ? 0 : undefined}
      onKeyDown={onPress ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPress() } } : undefined}
    >
      <span className="leaderboard-rank">#{entry.rank}</span>
      <span
        className="leaderboard-avatar"
        style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
      >
        {entry.thumbAvatarUrl
          ? <img src={entry.thumbAvatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : (entry.displayName ?? '?')[0].toUpperCase()}
      </span>
      <span className="leaderboard-name-block">
        <span className="leaderboard-name">{entry.displayName}</span>
        {hasCityChip && (
          <span className="leaderboard-city">
            {flag && <span aria-hidden="true">{flag}</span>}
            {cityLabel && <span className="leaderboard-city-name">{cityLabel}</span>}
          </span>
        )}
      </span>
      <span className="leaderboard-points">
        {t('leaderboard.points', { points: entry.points })}
      </span>
    </li>
  )
}

// Cities-scope row - flag + city name + sum of every member's points.
// No avatar (cities don't have one); the flag fills the avatar slot at
// the same 40px footprint so the row geometry matches the user rows.
function LeaderboardCityRow({ entry, isMe, t }) {
  const flag      = entry.cityCountry ? countryToFlag(entry.cityCountry) : ''
  const cityLabel = entry.cityName ? localizeCityName(entry.cityName) : '-'
  return (
    <li className={`leaderboard-row${isMe ? ' is-me' : ''}`}>
      <span className="leaderboard-rank">#{entry.rank}</span>
      <span className="leaderboard-city-flag" aria-hidden="true">{flag || '🏳️'}</span>
      <span className="leaderboard-name-block">
        <span className="leaderboard-name">{cityLabel}</span>
      </span>
      <span className="leaderboard-points">
        {t('leaderboard.points', { points: entry.points })}
      </span>
    </li>
  )
}
