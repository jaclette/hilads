import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BackButton from './BackButton'
import ShowcaseCard from './ShowcaseCard'
import LeaderboardCityPickerModal from './LeaderboardCityPickerModal'
import { fetchChallengeShowcase } from '../api'

const PAGE = 30

/**
 * Public "Success challenges" showcase (web). Full-page overlay: completed,
 * well-rated challenges for discovery - global by default with an optional city
 * filter. Open to guests. Mirrors the mobile app/challenge/showcase screen.
 */
export default function SuccessfulChallengesScreen({ onBack, onOpenChallenge, onOpenProfile }) {
  const { t } = useTranslation('challenge')

  const [items,       setItems]       = useState([])
  const [loading,     setLoading]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore,     setHasMore]     = useState(false)
  const [cityId,      setCityId]      = useState(null)
  const [cityName,    setCityName]    = useState(null)
  const [pickerOpen,  setPickerOpen]  = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetchChallengeShowcase({ cityId, limit: PAGE })
    setItems(res.items ?? [])
    setHasMore(!!res.hasMore)
    setLoading(false)
  }, [cityId])

  useEffect(() => { load() }, [load])

  const loadMore = async () => {
    if (loadingMore || !hasMore || items.length === 0) return
    setLoadingMore(true)
    const before = items[items.length - 1]?.completed_at
    const res = await fetchChallengeShowcase({ cityId, limit: PAGE, before })
    setItems(prev => [...prev, ...(res.items ?? [])])
    setHasMore(!!res.hasMore)
    setLoadingMore(false)
  }

  return (
    <div className="full-page full-page--tab">
      <div className="page-header showcase-header">
        <BackButton onClick={onBack} />
        <span className="showcase-page-title">{t('showcase.title')}</span>
      </div>

      <div className="page-body showcase-body-scroll">
        <div className="showcase-filter">
          <button
            type="button"
            className={`showcase-city-pill${cityId ? ' showcase-city-pill--active' : ''}`}
            onClick={() => setPickerOpen(true)}
          >
            🌍 {cityName ?? t('showcase.allCities')} ▾
          </button>
          {cityId && (
            <button type="button" className="showcase-clear" onClick={() => { setCityId(null); setCityName(null) }}>
              {t('showcase.clearCity')}
            </button>
          )}
        </div>

        {loading ? (
          <div className="showcase-empty"><div className="showcase-empty-emoji">✨</div></div>
        ) : items.length === 0 ? (
          <div className="showcase-empty">
            <div className="showcase-empty-emoji">✨</div>
            <div className="showcase-empty-title">{t('showcase.empty.title')}</div>
            <div className="showcase-empty-body">{t('showcase.empty.body')}</div>
          </div>
        ) : (
          <>
            {items.map(it => (
              <ShowcaseCard
                key={it.id}
                item={it}
                onOpen={() => onOpenChallenge(it.id)}
                onAvatar={onOpenProfile}
              />
            ))}
            {hasMore && (
              <button type="button" className="showcase-loadmore" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? '…' : t('showcase.loadMore', { defaultValue: 'Load more' })}
              </button>
            )}
          </>
        )}
      </div>

      <LeaderboardCityPickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(channelId, city) => {
          const m = /^city_(\d+)$/.exec(channelId)
          setCityId(m ? Number(m[1]) : null)
          setCityName(city?.name ?? null)
          setPickerOpen(false)
        }}
      />
    </div>
  )
}
