import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchContest } from '../../api'
import HalongArt from './HalongArt'
import AvatarWithFlag from '../AvatarWithFlag'
import { mediumUrl } from '../../lib/imageThumb'
import { contestGoal, countdownTarget, shortLeft, useNow } from './ContestScreen'
import Icon from '../Icon'
import { bannerSize, countTodayVisit, noteRank, useRaceSignals } from './raceSignals'

/**
 * The campaign on Today (the app's LaunchSeasonCard), always in the same slot under the challenge card,
 * in two sizes: the full postcard (docs/mockups/hilads_campaign_banner_mockup.html, variant A) for the
 * first N Today visits of the campaign and for H hours at each key moment (race start, final week, the
 * last H hours, my rank changed; N and H from Admin › Launch Season › Prize), else the slim strip (56 px,
 * the same yellow: the prize thumbnail, one line, a chevron). The change of size animates (CSS, none with
 * reduced motion). The whole banner opens the Trip tab. Fixed colors in every theme.
 */
const TAPPED = 'hilads_trip_banner_tapped'  // seasonId
const read = k => { try { return localStorage.getItem(k) } catch { return null } }

// One GET /contest shared by the Today slot's remounts, kept 30 s.
let cache = null
function loadContest(locale) {
  if (cache && cache.locale === locale && Date.now() - cache.at < 30000) return cache.promise
  const promise = fetchContest(locale)
  cache = { locale, at: Date.now(), promise }
  promise.catch(() => { cache = null })
  return promise
}

function boarding(counter) {
  if (!counter) return { showCount: false }
  const goal = contestGoal(counter)
  const reached = goal === null || (counter.reached ?? counter.players >= goal)
  return { showCount: counter.players > 0 && (counter.players >= (counter.showFrom ?? 0) || (goal !== null && reached)) }
}

export default function LaunchSeasonCard({ onOpen, account }) {
  const { t, i18n } = useTranslation('profile', { keyPrefix: 'pp' })
  const [data, setData] = useState(null)
  const [tapped, setTapped] = useState(false)
  const [visit, setVisit] = useState(0)
  useEffect(() => { loadContest(i18n.language).then(d => { setData(d); noteRank(d) }).catch(() => {}) }, [i18n.language])
  const now = useNow(60000)
  const s = data?.season
  const { change } = useRaceSignals(s?.id ?? null)
  // One Today visit per mount of Today, once the campaign is known.
  useEffect(() => { if (s?.id && !visit) setVisit(countTodayVisit(s.id)) }, [s?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!s || !['upcoming', 'season', 'final', 'over', 'ended'].includes(s.phase)) return null
  const size = visit > 0 ? bannerSize(s, visit, change?.at ?? null, now) : 'full'

  const prize = s.prize?.title || s.name
  const target = countdownTarget(s)
  const left = target ? shortLeft(target.at - now, t) : null
  const over = s.phase === 'over' || s.phase === 'ended'
  const when = over ? t('trip.chip.over')
    : s.phase === 'upcoming' ? (left ? t('trip.banner.starts', { time: left }) : null)
    : s.phase === 'season' ? (left ? t('trip.banner.finalIn', { time: left }) : null)
    : left ? t('trip.banner.endsIn', { time: left }) : null
  const race = data.me?.joined ? data.me.race : null
  const cta = over ? t('trip.banner.overCta')
    : !account ? t('trip.banner.grab')
    : race?.rank && race.points > 0 ? t('trip.banner.rankSee', { rank: race.rank })
    : s.phase === 'upcoming' && data.me?.joined ? t('trip.banner.see')
    : t('trip.banner.enter')
  const board = boarding(data.counter)
  const faces = board.showCount ? (data.counter?.recent ?? []).slice(0, 3) : []
  const pulse = !tapped && read(TAPPED) !== String(s.id)
  const cover = s.photos?.[0]
  const open = () => {
    try { localStorage.setItem(TAPPED, String(s.id)) } catch { /* storage off */ }
    setTapped(true)
    onOpen()
  }
  const ranked = !!race?.rank && race.points > 0
  const slimLine = ranked ? `${t('trip.me.rank', { rank: race.rank })}${when ? ` · ${when}` : ''}`
    : `${prize} · ${data.me?.joined && s.phase === 'upcoming' && when ? when : cta.replace(/\s*[→←]\s*$/u, '')}`
  const label = size === 'slim' ? [s.name, slimLine, s.isTest ? t('contest.test') : null].filter(Boolean).join('. ')
    : [s.name, prize, when, board.showCount ? t('trip.banner.onBoard', { count: data.counter.players }) : null, cta, s.isTest ? t('contest.test') : null]
      .filter(Boolean).join('. ')
  if (size === 'slim') {
    return (
      <button type="button" className="ls-slim" onClick={open} aria-label={label}>
        <span className="ls-slim-thumb" aria-hidden="true">{cover ? <img src={mediumUrl(cover.url) ?? cover.url} alt="" /> : <HalongArt />}</span>
        <b className="ls-slim-text">{slimLine}</b>
        {s.isTest && <span className="ls-test">{t('contest.test')}</span>}
        <Icon name="chevron-forward" size={18} />
      </button>
    )
  }
  return (
    <button type="button" className="ls-card2" onClick={open} aria-label={label}>
      <span className="ls-card2-art" aria-hidden="true">{cover ? <img src={mediumUrl(cover.url) ?? cover.url} alt="" /> : <HalongArt />}</span>
      <span className="ls-card2-shade" aria-hidden="true" />
      <span className="ls-card2-top">
        <span className="ls-card2-tags"><span className="ls-card2-tag">{s.name.toUpperCase()}</span>{s.isTest && <span className="ls-test">{t('contest.test')}</span>}</span>
        {when && <span className="ls-card2-when">⏳ {when}</span>}
      </span>
      <b className="ls-card2-title">{prize}{'\u00A0'}✈️</b>
      <span className="ls-card2-bottom">
        {faces.length > 0 && <span className="ls-card2-faces" aria-hidden="true">{faces.map(f => (
          <span key={f.userId}><AvatarWithFlag userId={f.userId} displayName={f.name} photoUrl={f.photoUrl} size={18} /></span>))}</span>}
        {board.showCount && <span className="ls-card2-board">{t('trip.banner.onBoard', { count: data.counter.players })}</span>}
        <span className={`ls-card2-cta${pulse ? ' is-pulse' : ''}`}>{cta}</span>
      </span>
    </button>
  )
}
