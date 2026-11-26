import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchContest } from '../../api'
import Icon from '../Icon'
import HalongArt from './HalongArt'
import { mediumUrl } from '../../lib/imageThumb'
import { countdownTarget, shortLeft, useNow } from './ContestScreen'

/**
 * The campaign on Today (the app's LaunchSeasonCard): a compact banner (the prize photo, the prize,
 * my rank or what to do, the time left) that switches to the Trip tab. Only while the tab is shown.
 */
export default function LaunchSeasonCard({ onOpen }) {
  const { t, i18n } = useTranslation('profile', { keyPrefix: 'pp' })
  const [data, setData] = useState(null)
  useEffect(() => { fetchContest(i18n.language).then(setData).catch(() => {}) }, [i18n.language])
  const now = useNow(60000)
  const s = data?.season
  if (!s || !['upcoming', 'season', 'final', 'over', 'ended'].includes(s.phase)) return null
  const prize = s.prize?.title || s.name
  const race = data.me?.joined ? data.me.race : null
  const target = countdownTarget(s)
  const left = target ? shortLeft(target.at - now, t) : null
  const line = s.phase === 'over' || s.phase === 'ended' ? t('trip.banner.over')
    : s.phase === 'upcoming' ? t('trip.banner.starts', { time: left ?? '' })
    : race?.rank && race.points > 0 ? t('trip.banner.rank', { rank: race.rank, count: race.points })
    : data.me?.joined ? t('trip.banner.play') : t('trip.banner.join')
  const when = s.phase === 'season' && left ? t('trip.banner.toFinal', { time: left }) : s.phase === 'final' && left ? t('trip.banner.ends', { time: left }) : null
  const cover = s.photos?.[0]
  return (
    <button type="button" className="ls-mini tappable" onClick={() => onOpen()}
            aria-label={`${s.name}. ${prize}. ${line}${when ? `. ${when}` : ''}${s.isTest ? `. ${t('contest.test')}` : ''}`}>
      <span className="ls-mini-thumb">{cover ? <img src={mediumUrl(cover.url) ?? cover.url} alt="" /> : <HalongArt />}</span>
      <span className="ls-mini-body">
        <span className="ls-mini-top"><span className="tr-tag tr-tag--small">{s.name.toUpperCase()}</span>{s.isTest && <span className="ls-test">{t('contest.test')}</span>}</span>
        <b className="ls-mini-title">{prize}{' '}✈️</b>
        <span className="ls-mini-line">{line}{when ? ` · ${when}` : ''}</span>
      </span>
      <Icon name="chevron-forward" size={20} />
    </button>
  )
}
