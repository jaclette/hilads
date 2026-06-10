import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchChannels } from '../api'
import { countryToFlag } from '../lib/countryFlag'
import { localizeCityName } from '../i18n/cityName'

const RESULT_CAP = 10

/**
 * Web parity for the mobile LeaderboardCityPickerSheet (PR13). A bottom-
 * sheet modal listing up to 10 cities, filterable by a search input.
 * Selecting a city flips the leaderboard view to that city via the
 * existing ?city_id= query param - does NOT touch the user's actual
 * current_city anywhere else in the app.
 *
 * Props:
 *   visible            - controls whether the modal renders
 *   selectedChannelId  - channel id of the currently-selected city ("city_<int>"
 *                        is the leaderboard API shape; this picker stores
 *                        just the numeric/string channel id), used to render
 *                        a check on the matching row
 *   onSelect(channelId, city)  - called with the picked city's channelId
 *                                + the full row from /channels. Caller
 *                                wraps it into "city_<id>" before passing
 *                                to the leaderboard API.
 *   onClose            - close without picking
 */
export default function LeaderboardCityPickerModal({
  visible,
  selectedChannelId,
  onSelect,
  onClose,
}) {
  const { t } = useTranslation('challenge')

  const [cities,  setCities]  = useState([])
  const [loading, setLoading] = useState(false)
  const [query,   setQuery]   = useState('')

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        // Web's fetchChannels returns the raw envelope `{ channels: [...] }`,
        // NOT a bare array. Unwrap so `.slice()` in the useMemo below sees an
        // array (same lesson CreateChallengePage learned - "o.slice is not a
        // function the moment the picker opened").
        const list = await fetchChannels()
        if (!cancelled) setCities(Array.isArray(list?.channels) ? list.channels : [])
      } catch {
        if (!cancelled) setCities([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [visible])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return cities.slice(0, RESULT_CAP)
    return cities
      .filter(c => (c.name ?? '').toLowerCase().includes(q) || (c.country ?? '').toLowerCase().includes(q))
      .slice(0, RESULT_CAP)
  }, [cities, query])

  // Reset the search every time the modal opens so users don't see a
  // stale filter from a previous session.
  useEffect(() => { if (visible) setQuery('') }, [visible])

  if (!visible) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel leaderboard-city-picker" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            {t('leaderboard.cityPicker.title', { defaultValue: 'Pick a city' })}
          </span>
          <button className="going-modal-close" onClick={onClose} aria-label={t('cancel', { ns: 'common', defaultValue: 'Close' })}>✕</button>
        </div>

        <div className="leaderboard-city-picker-search">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('leaderboard.cityPicker.searchPlaceholder', { defaultValue: 'Search cities…' })}
            autoFocus
          />
        </div>

        <div className="leaderboard-city-picker-list">
          {loading ? (
            <div className="leaderboard-city-picker-empty">…</div>
          ) : filtered.length === 0 ? (
            <div className="leaderboard-city-picker-empty">
              {t('leaderboard.cityPicker.empty', { defaultValue: 'No cities match.' })}
            </div>
          ) : (
            filtered.map(item => {
              const isSelected = String(item.channelId) === String(selectedChannelId)
              const flag = countryToFlag(item.country) || '🌍'
              return (
                <button
                  key={item.channelId}
                  type="button"
                  className={`leaderboard-city-picker-row${isSelected ? ' is-selected' : ''}`}
                  onClick={() => onSelect(item.channelId, item)}
                >
                  <span className="leaderboard-city-picker-flag" aria-hidden="true">{flag}</span>
                  <span className="leaderboard-city-picker-name">{localizeCityName(item.name)}</span>
                  {isSelected && <span className="leaderboard-city-picker-check" aria-hidden="true">✓</span>}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
