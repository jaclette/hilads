import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchContest } from '../../api'
import HalongArt from './HalongArt'
import AvatarWithFlag from '../AvatarWithFlag'
import { mediumUrl } from '../../lib/imageThumb'
import { contestGoal, countdownTarget, shortLeft, useNow } from './ContestScreen'

/**
 * The campaign on Today, a postcard (the app's LaunchSeasonCard; docs/mockups/hilads_campaign_banner_mockup.html,
 * variant A): the prize photo full-bleed under a left-to-right shade, the campaign's name on a tilted yellow sticker,
 * the countdown by phase, the prize big, the latest players + "13 on board" (hidden under the campaign's threshold)
 * and a white pill (a guest "Grab my seat →", a member not in the race "Enter the race →", in it "You're 12th · See
 * the race →") that pulses until the first tap. The whole card opens the Trip tab. Never dismissed; after the 3rd
 * Trip tab open it shows below the feed (placement). Fixed colors: it sits on a photo in every theme.
 */
const OPENS = 'hilads_trip_opens'          // `${seasonId}:${count}`, counted by the Trip screen
const TAPPED = 'hilads_trip_banner_tapped'  // seasonId
const read = k => { try { return localStorage.getItem(k) } catch { return null } }

/** The Trip screen counts its opens (the banner moves below the feed after the 3rd). */
export function countTripOpen(seasonId) {
  const m = /^(\d+):(\d+)$/.exec(read(OPENS) ?? '')
  const n = (m && Number(m[1]) === seasonId ? Number(m[2]) : 0) + 1
  try { localStorage.setItem(OPENS, `${seasonId}:${n}`) } catch { /* storage off */ }
}
function opensFor(seasonId) {
  const m = /^(\d+):(\d+)$/.exec(read(OPENS) ?? '')
  return m && Number(m[1]) === seasonId ? Number(m[2]) : 0
}

// One GET /contest for both Today slots (top / below the feed), kept 30 s.
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

export default function LaunchSeasonCard({ onOpen, account, placement }) {
  const { t, i18n } = useTranslation('profile', { keyPrefix: 'pp' })
  const [data, setData] = useState(null)
  const [tapped, setTapped] = useState(false)
  useEffect(() => { loadContest(i18n.language).then(setData).catch(() => {}) }, [i18n.language])
  const now = useNow(60000)
  const s = data?.season
  if (!s || !['upcoming', 'season', 'final', 'over', 'ended'].includes(s.phase)) return null
  if (placement && placement !== (opensFor(s.id) >= 3 ? 'bottom' : 'top')) return null

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
  const label = [s.name, prize, when, board.showCount ? t('trip.banner.onBoard', { count: data.counter.players }) : null, cta, s.isTest ? t('contest.test') : null]
    .filter(Boolean).join('. ')
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
