import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchContest, notifyContest } from '../../api'
import Icon from '../Icon'
import HalongArt from './HalongArt'
import { mediumUrl } from '../../lib/imageThumb'
import { CountdownBoard, countdownTarget, shortLeft, useNow } from './ContestScreen'

const shortDate = (date, locale) => new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })

// A little confetti on the banner (fixed event colors, on a photo).
const CONFETTI = [
  { top: 14, right: 96, w: 6, h: 12, rot: 24, c: '#FFB627' }, { top: 40, right: 70, w: 5, h: 10, rot: -32, c: '#FFFFFF' },
  { top: 22, right: 48, w: 7, h: 7, rot: 45, c: '#D7263D' }, { top: 58, right: 26, w: 6, h: 12, rot: 12, c: '#FFE29A' },
  { top: 76, right: 82, w: 5, h: 9, rot: 60, c: '#0F7B74' }, { top: 92, right: 40, w: 6, h: 6, rot: 20, c: '#FFB627' },
]

/**
 * The Launch Season on Today and Passport (the app's LaunchSeasonCard), a festive banner that says
 * there is a real trip to win: the first photo full-bleed (else the illustration), a gold ribbon, the
 * prize and "be #1 in the final week", the deadline, my points and rank or Join. Before the start
 * (Upcoming): "the Launch Season is coming", a compact live countdown, the warm-up line and Notify me.
 * Only while a season is visible to me (a test season: its testers only).
 */
export default function LaunchSeasonCard({ onOpen }) {
  const { t, i18n } = useTranslation('profile', { keyPrefix: 'pp' })
  const [data, setData] = useState(null)
  useEffect(() => { fetchContest(i18n.language).then(setData).catch(() => {}) }, [i18n.language])
  const now = useNow(30000)

  const s = data?.season
  if (!s) return null
  const prize = s.prize?.title || s.name
  const joined = data.me?.joined ? data.me : null
  const upcoming = s.phase === 'upcoming'
  const notified = !!joined || !!data.me?.notified
  const final = ['final', 'over'].includes(s.phase)
  const rank = final ? joined?.finalRank : joined?.seasonRank
  const points = final ? joined?.points?.final : joined?.points?.season
  const target = countdownTarget(s)
  const when = target && target.label === 'cdEnds' ? t('contest.endsIn', { time: shortLeft(target.at - now, t) })
    : t('contest.endsOn', { date: shortDate(s.endDate, i18n.language) })
  const status = joined?.points ? `${t('contest.cardJoined', { points: points ?? 0 })}${rank ? ` · ${t('contest.cardRank', { rank })}` : ''}` : null
  const notify = (e) => {
    e.stopPropagation()
    if (!data.me) { onOpen('contest-prize'); return }
    if (!notified) notifyContest(s.id, i18n.language).then(setData).catch(() => {})
  }
  const cover = s.photos?.[0]

  return (
    <div role="button" tabIndex={0} className="ls-banner tappable" onClick={() => onOpen(joined && !upcoming ? 'contest' : 'contest-prize')}
         onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(joined && !upcoming ? 'contest' : 'contest-prize') } }}>
      <span className="ls-banner-art">{cover ? <img src={mediumUrl(cover.url) ?? cover.url} alt="" /> : <HalongArt />}</span>
      <span className="ls-banner-shade" aria-hidden="true" />
      {CONFETTI.map((p, i) => <i key={i} className="ls-confetti" aria-hidden="true" style={{ top: p.top, right: p.right, width: p.w, height: p.h, background: p.c, transform: `rotate(${p.rot}deg)` }} />)}
      <span className="ls-banner-top">
        <span className="ls-ribbon"><Icon name={upcoming ? 'rocket' : 'trophy'} size={14} />{t(upcoming ? 'contest.teaserKicker' : 'contest.todayKicker')}</span>
        {s.isTest && <span className="ls-test">{t('contest.test')}</span>}
      </span>
      {upcoming ? (
        <span className="ls-banner-bottom">
          <strong className="ls-banner-title">{t('contest.teaserTitle')}</strong>
          <span className="ls-banner-win">{prize} ✈️</span>
          {target && <CountdownBoard target={target} compact />}
          <span className="ls-banner-warm">{t('contest.teaserWarm')}</span>
          <button type="button" className={`ls-banner-cta${notified ? ' is-in' : ''}`} onClick={notify} disabled={notified && !!data.me}>
            <Icon name={notified ? 'checkmark-circle' : 'notifications'} size={18} />{t(notified ? 'contest.notifyOn' : 'contest.notifyMe')}
          </button>
        </span>
      ) : (
        <span className="ls-banner-bottom">
          <strong className="ls-banner-title">{prize} ✈️</strong>
          <span className="ls-banner-win">{t('contest.todayWin')}</span>
          <span className="ls-banner-row">
            <span className="ls-banner-when"><Icon name="time-outline" size={14} />{when}</span>
            <span className={`ls-banner-cta${status ? ' is-in' : ''}`}>{status ?? t('contest.todayJoin')}<Icon name="chevron-forward" size={16} /></span>
          </span>
        </span>
      )}
    </div>
  )
}
