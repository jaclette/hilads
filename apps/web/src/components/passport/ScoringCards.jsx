import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchCrew, fetchDailyPoints } from '../../api'
import { RankMedal } from '../daily/dailyShared'
import { shareLink } from '../../lib/shareLink'
import AvatarWithFlag from '../AvatarWithFlag'
import Icon from '../Icon'
import i18n from '../../i18n'

/**
 * Scoring v2 on the web Passport (as the app's ScoringCards): this week's Perfect week (7 dots
 * and its +30), "Bring your crew" (3 / 5, the invite link, who joined), season medals,
 * "Invited by @minh", and the points sheet from the server's config.
 */
const usePp = () => useTranslation('profile', { keyPrefix: 'pp' })

const seasonName = (key) => {
  const [y, m] = key.split('-').map(Number)
  try { return new Date(Date.UTC(y, (m || 1) - 1, 15)).toLocaleDateString(i18n.language, { month: 'long', year: 'numeric', timeZone: 'UTC' }) } catch { return key }
}

let pointsCache = null
export function useScoringPoints() {
  const [pts, setPts] = useState(pointsCache ?? { proof: 10, top: [30, 20, 10], perfectWeek: 30, friendJoined: 10, crewBonus: 50, crewSize: 5 })
  useEffect(() => {
    let alive = true
    fetchDailyPoints().then(p => { if (p && typeof p.proof === 'number') { pointsCache = { ...pts, ...p }; if (alive) setPts(pointsCache) } }).catch(() => {})
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return pts
}

export function WeekCard({ week }) {
  const { t } = usePp()
  const days = t('week.days').split(',')
  const status = week.earned ? t('week.earned', { points: week.points })
    : week.missed > 0 ? t('week.missed') : t('week.left', { count: week.left, points: week.points })
  return (
    <div className="pp-v2-card">
      <div className="pp-v2-head"><strong>{t('week.title')}</strong><span className={`pp-v2-pill${week.earned ? ' pp-v2-pill--gold' : ''}`}>{t('week.points', { points: week.points })}</span></div>
      <div className="pp-v2-dots" role="img" aria-label={t('week.a11y', { done: week.done, total: week.total })}>
        {week.days.map((d, i) => (
          <span key={i} className="pp-v2-day">
            <span className={`pp-v2-dot pp-v2-dot--${d}`}>{d === 'done' ? <Icon name="checkmark" size={14} /> : d === 'missed' ? <Icon name="close" size={14} /> : null}</span>
            <span className="dc-muted">{days[i] ?? ''}</span>
          </span>
        ))}
      </div>
      <p className="dc-muted">{status}</p>
    </div>
  )
}

export function CrewCard() {
  const { t } = usePp()
  const [crew, setCrew] = useState(null)
  useEffect(() => { let alive = true; fetchCrew().then(c => { if (alive) setCrew(c) }).catch(() => {}); return () => { alive = false } }, [])
  if (!crew) return null
  const invite = () => shareLink({ type: 'invite', path: `/today?ref=${crew.code}`, text: t('crew.shareText', { link: '' }).trim(), source: 'passport_crew' })
  return (
    <div className="pp-v2-card">
      <div className="pp-v2-head"><strong>{t('crew.title')}</strong><span className="pp-v2-count" aria-label={t('crew.a11y', { count: crew.count, max: crew.max })}>{crew.count} / {crew.max}</span></div>
      <p className="dc-muted">{crew.bonus ? t('crew.done', { points: crew.points.crew }) : t('crew.text', { friend: crew.points.friend, crew: crew.points.crew, max: crew.max })}</p>
      <div className="pp-v2-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (crew.count / Math.max(1, crew.max)) * 100)}%` }} className={crew.bonus ? 'gold' : ''} /></div>
      {crew.friends.length > 0 && (
        <div className="pp-v2-friends">
          {crew.friends.slice(0, 8).map(f => (
            <span key={f.id} className={`pp-v2-friend${f.credited ? ' on' : ''}`} title={f.credited ? '' : t('crew.pending')}>
              <AvatarWithFlag userId={f.id} displayName={f.displayName ?? f.username} photoUrl={f.photoUrl} size={40} />
              <span className="pp-ellipsis">{f.username ? '@' + f.username : f.displayName}</span>
            </span>
          ))}
        </div>
      )}
      {crew.friends.some(f => !f.credited) && <p className="dc-muted">{t('crew.pendingHint')}</p>}
      <button type="button" className="today-cta dc-full btn-primary" onClick={invite}><Icon name="person-add-outline" size={18} />{t('crew.invite')}</button>
    </div>
  )
}

export function SeasonMedals({ medals }) {
  const { t } = usePp()
  if (!medals?.length) return null
  return (
    <div className="pp-v2-card">
      <strong>{t('seasons.medals')}</strong>
      <div className="pp-v2-medals">
        {medals.map(m => (
          <span key={m.season} className="pp-v2-medal" aria-label={t('seasons.medalA11y', { rank: m.rank, season: seasonName(m.season), points: m.points })}>
            <RankMedal rank={m.rank} size={32} /><span>{seasonName(m.season)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export function InvitedBy({ by }) {
  const { t } = usePp()
  return <p className="dc-muted pp-v2-invited">{t('crew.invitedBy', { name: by.username ? '@' + by.username : by.displayName ?? '' })}</p>
}
