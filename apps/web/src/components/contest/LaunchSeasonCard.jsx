import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from '../Icon'
import { fetchContest } from '../../api'

/**
 * The Launch Season's entry (Today, Passport): only while a season is visible to me (a test
 * season: its testers only). Join, or my points and rank; opens the contest screen.
 */
export default function LaunchSeasonCard({ onOpen }) {
  const { t, i18n } = useTranslation('profile', { keyPrefix: 'pp' })
  const [data, setData] = useState(null)
  useEffect(() => { fetchContest().then(setData).catch(() => {}) }, [])

  const s = data?.season
  if (!s) return null
  const joined = data.me?.joined ? data.me : null
  const final = ['final', 'over'].includes(s.phase)
  const rank = final ? joined?.finalRank : joined?.seasonRank
  const points = final ? joined?.points?.final : joined?.points?.season
  const date = new Date(`${s.phase === 'upcoming' ? s.startDate : s.endDate}T12:00:00Z`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })
  const counter = data.counter ? t('contest.counter', { count: data.counter.players, max: data.counter.threshold }) : ''

  return (
    <button type="button" className="ls-card tappable" onClick={onOpen}>
      <span className="ls-card-emoji" aria-hidden="true">🚀</span>
      <span className="ls-card-body">
        <strong>{s.name}{s.isTest && <span className="ls-test">{t('contest.test')}</span>}</strong>
        <span>{joined?.points ? t('contest.cardJoined', { points: points ?? 0 }) : t('contest.cardText')}{rank ? ` · ${t('contest.cardRank', { rank })}` : ''}</span>
        <span className="dc-muted">{t(`contest.phase.${s.phase}`, { date })}{counter ? ` · ${counter}` : ''}</span>
      </span>
      {joined ? <Icon name="chevron-forward" size={18} /> : <span className="ls-card-cta">{t('contest.cardJoin')}</span>}
    </button>
  )
}
