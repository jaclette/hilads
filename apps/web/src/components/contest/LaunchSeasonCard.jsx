import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchContest } from '../../api'
import HalongArt from './HalongArt'

const shortDate = (date, locale) => new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })

/**
 * The Launch Season on Today and Passport, a small boarding pass (the app's LaunchSeasonCard):
 * the art, a tear line, the prize (Admin › Launch Season), the deadline, my points and rank or
 * Join. Only while a season is visible to me (a test season: its testers only).
 */
export default function LaunchSeasonCard({ onOpen }) {
  const { t, i18n } = useTranslation('profile', { keyPrefix: 'pp' })
  const [data, setData] = useState(null)
  useEffect(() => { fetchContest(i18n.language).then(setData).catch(() => {}) }, [i18n.language])

  const s = data?.season
  if (!s) return null
  const prize = s.prize?.title || s.name
  const joined = data.me?.joined ? data.me : null
  const final = ['final', 'over'].includes(s.phase)
  const rank = final ? joined?.finalRank : joined?.seasonRank
  const points = final ? joined?.points?.final : joined?.points?.season
  const when = s.phase === 'upcoming'
    ? t('contest.phase.upcoming', { date: shortDate(s.startDate, i18n.language) })
    : t('contest.endsOn', { date: shortDate(s.endDate, i18n.language) })

  return (
    <button type="button" className="ls-mini tappable" onClick={() => onOpen(joined ? 'contest' : 'contest-prize')}>
      <span className="ls-mini-art">{s.photos?.[0] ? <img src={s.photos[0].url} alt="" /> : <HalongArt />}</span>
      <span className="ls-mini-body">
        <span className="ls-mini-top">
          <strong>{prize} ✈️</strong>
          {s.isTest && <span className="ls-test">{t('contest.test')}</span>}
        </span>
        <span className="ls-when">{when}</span>
        {joined?.points
          ? <span className="ls-chip">{t('contest.cardJoined', { points: points ?? 0 })}{rank ? ` · ${t('contest.cardRank', { rank })}` : ''}</span>
          : <span className="ls-chip ls-chip--cta">{t('contest.join')}</span>}
      </span>
    </button>
  )
}
