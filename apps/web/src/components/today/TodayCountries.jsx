import { useEffect, useState } from 'react'
import { fetchDailyTodayCountries, fetchDailyTour } from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'
import { useBackLayer } from '../../lib/backLayers'
import { thumbFallback } from '../../lib/thumbFallback'
import { openAppModal } from '../AppModal'
import AvatarWithFlag from '../AvatarWithFlag'
import Icon from '../Icon'
import { FlagSticker, themeColor } from '../joy/Joy'
import { answerText } from '../daily/compareShared'
import { compareCountryProofs, rememberCountries } from '../daily/countryOrder'
import { RankMedal, personName, seedProofs, useDaily, useDc, useHere, useVoteCount } from '../daily/dailyShared'
import { hasUnseen, isSeen, useSeen } from '../daily/seen'
import WorldTourViewer from '../daily/WorldTour'
import { isEventDay, useSeasonal, useSeasonalLive } from '../event/seasonal'

const CIRCLE = 64
const RING = 3
const MAX_SEGMENTS = 8
const MOSAIC_MAX = 6

/**
 * Today's photos by city and by country (GET /daily/today/countries), loaded
 * once for the whole tab (the app's useTodayCountries): the hero's live strip
 * and the compare section read the same list, so they never disagree.
 */
export function useTodayCountries(today) {
  const here = useHere()
  const [data, setData] = useState(null)
  const challenge = today?.challenge ?? null
  // My city first: where I am, else the city I'm browsing.
  const cityId = here?.id ?? today?.city?.id ?? null

  useEffect(() => {
    if (!challenge) return
    let alive = true
    fetchDailyTodayCountries({ cityId }).then(d => {
      if (!alive) return
      seedProofs([...d.items.map(i => i.top), ...(d.cities ?? []).map(c => c.top)], !!challenge.isActive)
      rememberCountries(d)
      setData(d)
    }).catch(() => {})
    return () => { alive = false }
  }, [challenge?.id, cityId]) // eslint-disable-line react-hooks/exhaustive-deps
  return challenge ? data : null
}

/**
 * Today's cities (one per city that played): the server's `cities` when it
 * sends them, else one per country from an older server (its top photo's city).
 */
export function todayCities(data) {
  if (!data) return []
  if (data.cities) return data.cities
  return data.items.map(i => ({
    city: i.city, count: i.count, authorCount: null, authors: [], totalLikes: null,
    latestAt: i.latestAt, unseen: i.unseen, ids: i.ids, top: i.top,
  }))
}

/**
 * Yesterday's tour, fetched once for Today: the recap card and the empty
 * mosaic (yesterday's top cities) read the same request.
 */
let tourLoad = null
function loadTour(cityId, locale, day) {
  const key = `${day}:${cityId}:${locale}`
  if (tourLoad?.key !== key) {
    const promise = fetchDailyTour(cityId, locale).catch(err => { if (tourLoad?.promise === promise) tourLoad = null; throw err })
    tourLoad = { key, promise }
  }
  return tourLoad.promise
}

/**
 * "Same challenge. Different worlds." (the app's TodayCountries, V3 polish 2):
 * today's photos by city, right under the hero, from the hero's own list
 * (`data`: useTodayCountries).
 * - The stories row, "[n] cities played today": one bubble per city (flag,
 *   name), its ring cut in one segment per photo (8 at most), in today's theme
 *   color while unseen, grey once seen, a count badge past one photo; my city,
 *   before I play, as a dashed "Saigon?" bubble (the app, photos are posted
 *   there). A bubble opens the story viewer at that city, the next cities following.
 * - The mosaic: one card per city (its most liked photo), a polaroid pile
 *   behind it when the city has several photos ("2 · 2 players"), its answer
 *   large, its players' avatars and its likes; cards lean a little, each its
 *   own way. My city's empty slot comes first until I play.
 * - Nobody played yet: yesterday's top 3 cities, greyed ("Yesterday the world
 *   said…"), and my city's slot to be the first.
 * Players' photos only (never a Hilads pick).
 */
export default function TodayCountries({ today, data }) {
  const { t, i18n } = useDc()
  const { openDaily } = useDaily()
  const here = useHere()
  useSeen()
  // A seasonal event's live day: its copy ("3 cities are haunted 🎃") and a badge on each card.
  const seasonal = useSeasonalLive()
  const copy = seasonal?.theme.copy
  const challenge = today?.challenge ?? null
  const cities = todayCities(data)
  // Nobody played yet: yesterday's best cities teach the idea (the tour the recap card loads too).
  const [tour, setTour] = useState(null)
  const [touring, setTouring] = useState(null)
  useBackLayer(touring !== null, () => setTouring(null))
  const empty = !!data && cities.length === 0
  const tourCity = today?.city?.id ?? null
  useEffect(() => {
    if (!challenge || !empty) return
    let alive = true
    loadTour(tourCity, i18n.language, challenge.date).then(r => { if (alive) setTour(r) }).catch(() => {})
    return () => { alive = false }
  }, [challenge?.id, empty, tourCity, i18n.language]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!challenge || !data) return null
  const isMine = (g) => !!here && String(g.city.id) === String(here.id)
  const myProof = today?.myProof ?? null
  const canPlay = challenge.isActive && !myProof
  const myCity = here?.name ? shortCityName(here.name) : null
  const mineIn = cities.some(isMine)
  // The server's order, kept fresh as photos get seen here: my city, then unseen, then the most recent.
  const stories = [...cities].sort((a, b) =>
    Number(isMine(b)) - Number(isMine(a)) || Number(hasUnseen(b)) - Number(hasUnseen(a)) || b.latestAt - a.latestAt)
  // The mosaic: my city first, then the most liked.
  const cards = [...cities].sort((a, b) =>
    Number(isMine(b)) - Number(isMine(a))
    || (b.totalLikes ?? b.top.voteCount) - (a.totalLikes ?? a.top.voteCount)
    || b.count - a.count).slice(0, MOSAIC_MAX)
  const theme = themeColor(challenge.special ? 'special' : challenge.theme?.key)
  const ring = theme.line ?? theme.fill
  const slot = canPlay && !mineIn
  // Yesterday's podium first, one card per city.
  const slides = tour?.slides ?? []
  const yesterday = slides.map((s, i) => ({ s, i })).sort((a, b) => (a.s.podium ?? 99) - (b.s.podium ?? 99))
    .filter((x, k, all) => all.findIndex(y => y.s.city.id === x.s.city.id) === k).slice(0, 3)

  const play = () => { track('today_countries_play', { has_photos: cities.length > 0, platform_surface: 'web' }); openAppModal({ action: 'play', surface: 'today_countries' }) }
  const openCity = (g, source) => {
    track(source === 'today_stories' ? 'today_countries_story' : 'today_countries_tile', { country: g.city.country, unseen: hasUnseen(g), platform_surface: 'web' })
    openDaily('stories', { city: g.city.id, source })
  }

  return (
    <div className="tc">
      {(cities.length > 0 || canPlay) && (
        <div className="tc-block">
          {cities.length > 0 && <p className="tc-title">{t(copy?.played ?? 'stories.played', { count: cities.length })}</p>}
          <div className="tc-stories">
            {/* My city, before I play: "Saigon?" to the app's camera. */}
            {slot && (
              <button type="button" className="tc-story" onClick={play} aria-label={t(copy?.represent ?? 'countries.represent')}>
                <span className="tc-ring tc-ring--mine"><Icon name="add" size={26} /></span>
                <span className="tc-story-name">{myCity ? t('stories.yourCity', { city: myCity }) : t('countries.yourCity')}</span>
              </button>
            )}
            {stories.map(g => (
              <button key={g.city.id} type="button" className="tc-story" aria-label={t('countries.openCountry', { city: shortCityName(g.city.name) })}
                      onClick={() => openCity(g, 'today_stories')}>
                <span className="tc-ring-box">
                  <SegmentRing ids={g.ids} color={ring} />
                  <span className="tc-inner"><FlagSticker country={g.city.country} size={42} /></span>
                  {g.count > 1 && <span className="tc-count" style={{ background: theme.fill, color: theme.onFill }}>{g.count}</span>}
                </span>
                <span className={`tc-story-name${hasUnseen(g) ? '' : ' tc-story-name--seen'}`}>{shortCityName(g.city.name)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {(cities.length > 0 || canPlay) && (
        <div className="tc-block">
          <div className="today-card-head">
            <span className="tc-title">{t('worlds.tagline')}</span>
            {cities.length > 0 && <button type="button" className="dc-link" onClick={() => openDaily('countries', { source: 'today_mosaic' })}>{t('today.seeAll')}</button>}
          </div>
          {cities.length === 0 && yesterday.length > 0 && <p className="dc-muted">{t('mosaic.yesterday')}</p>}
          <div className="tc-grid">
            {slot && <SlotCard city={myCity} first={cities.length === 0} label={copy?.represent} onOpen={play} />}
            {cities.length > 0
              ? cards.map(g => <CityCard key={g.city.id} group={g} pileColor={theme.fill} badge={seasonal?.theme.emoji} onOpen={() => openCity(g, 'today_mosaic')} />)
              : yesterday.map(({ s, i }) => <CityCard key={s.city.id} faded pileColor={theme.fill} group={{
                  city: { id: s.city.id, name: s.city.name, country: s.city.country ?? '' }, count: s.count ?? 1, authorCount: null,
                  authors: [], totalLikes: null, latestAt: 0, unseen: false, ids: [s.proof.id], top: s.proof,
                }} onOpen={() => setTouring(i)} />)}
          </div>
          {cities.length === 0 && yesterday.length === 0 && !slot && <p className="dc-muted">{t('countries.emptyBody')}</p>}
        </div>
      )}
      {touring !== null && tour && <WorldTourViewer tour={tour} start={touring} source="today_empty" onClose={() => setTouring(null)} />}
    </div>
  )
}

/** A story ring cut in one segment per photo: theme color while unseen, grey once seen. */
function SegmentRing({ ids, color }) {
  const n = Math.min(ids.length, MAX_SEGMENTS)
  if (n <= 1) return <span className="tc-ring tc-ring--seg" style={{ borderColor: isSeen(ids[0] ?? '') ? 'var(--line)' : color }} />
  const r = (CIRCLE - RING) / 2
  const c = CIRCLE / 2
  const gap = 10   // degrees between segments
  const p = (deg) => {
    const rad = ((deg - 90) * Math.PI) / 180
    return `${c + r * Math.cos(rad)} ${c + r * Math.sin(rad)}`
  }
  const arc = (from, to) => `M ${p(from)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${p(to)}`
  const step = 360 / n
  return (
    <svg className="tc-ring-svg" width={CIRCLE} height={CIRCLE} viewBox={`0 0 ${CIRCLE} ${CIRCLE}`} aria-hidden="true">
      {ids.slice(0, n).map((id, i) => (
        <path key={id} d={arc(i * step + gap / 2, (i + 1) * step - gap / 2)} stroke={isSeen(id) ? 'var(--line)' : color}
              strokeWidth={RING} strokeLinecap="round" fill="none" />
      ))}
    </svg>
  )
}

/** A small, steady lean per city (±1.5°), never changing between renders (the app's formula). */
function lean(id) {
  const x = Math.sin(Number(id) * 12.9898) * 43758.5453
  return (x - Math.floor(x)) * 3 - 1.5
}

/**
 * A city's card: its most liked photo (a polaroid pile behind it when the city
 * has several), its answer large, its players and its likes. `faded`:
 * yesterday's card in the empty state.
 */
function CityCard({ group, onOpen, pileColor, badge, faded = false }) {
  const { t, i18n } = useDc()
  const p = group.top
  const votes = useVoteCount(p)
  const line = p.answer && !p.backHome ? answerText(p.answer, i18n.language) : p.caption ?? p.spot?.name ?? p.place?.name ?? ''
  const likes = group.totalLikes ?? votes
  const pile = group.count > 1
  const players = group.authorCount ?? 0
  const more = players - group.authors.length
  return (
    <button type="button" className={`tc-card${faded ? ' tc-card--faded' : ''}`} style={{ transform: `rotate(${lean(group.city.id)}deg)` }} onClick={onOpen}
            aria-label={[shortCityName(group.city.name), line, pile && players > 0 ? t('mosaic.players', { count: players }) : null, likes].filter(x => x !== null && x !== '').join(', ')}>
      {pile && <span className="tc-layer tc-layer--back" style={{ background: pileColor }} aria-hidden="true" />}
      {pile && group.count > 2 && <span className="tc-layer tc-layer--back2" style={{ background: pileColor }} aria-hidden="true" />}
      <span className="tc-tile">
        <span className="tc-photo-box">
          <img className="tc-photo" src={p.thumbUrl || p.photoUrl} onError={thumbFallback(p.photoUrl)} alt="" loading="lazy" />
          {p.selfieUrl && <img className="dp-mini" src={p.selfieThumbUrl ?? p.selfieUrl} alt="" />}
          {/* Top-right, clear of the selfie inset (top-left): the count, then the event badge. */}
          {(pile || badge) && (
            <span className="tc-corner">
              {pile && (
                <span className="tc-pill">
                  <Icon name={players > 0 && players >= group.count ? 'people-outline' : 'camera'} size={12} />
                  <span className="tc-pill-text">{players <= 0 ? group.count
                    : players >= group.count ? t('mosaic.players', { count: players })
                    : `${group.count} · ${t('mosaic.players', { count: players })}`}</span>
                </span>
              )}
              {badge && <span className="seasonal-badge seasonal-badge--inline" aria-hidden="true">{badge}</span>}
            </span>
          )}
        </span>
        <span className="tc-tile-body">
          <span className="tc-city"><FlagSticker country={group.city.country} size={16} />{shortCityName(group.city.name)}</span>
          <span className="tc-answer">{line}</span>
          <span className="tc-foot">
            <span className="tc-avatars">
              {group.authors.map(a => (
                <span key={a.id} className="tc-avatar"><AvatarWithFlag userId={a.id} displayName={personName(a)} photoUrl={a.photoUrl} size={20} /></span>
              ))}
              {more > 0 && <span className="tc-more">+{more}</span>}
            </span>
            <span className="tc-votes">
              {group.totalComments > 0 && <span className="pc-count"><Icon name="chatbubble-outline" size={13} />{group.totalComments}</span>}
              <Icon name="heart-outline" size={14} />{likes}
            </span>
          </span>
        </span>
      </span>
    </button>
  )
}

/** My city's empty slot: "Saigon is missing! Represent your city" (or, first of all, "Represent Saigon"). */
function SlotCard({ city, first, label, onOpen }) {
  const { t } = useDc()
  const title = first ? (city ? t('mosaic.beFirst', { city }) : t(label ?? 'countries.represent'))
    : city ? t('mosaic.missing', { city }) : t(label ?? 'countries.represent')
  // Under the title: the call when the title names the city, else nothing to repeat.
  const sub = first ? t('mosaic.beFirstSub') : city ? t(label ?? 'countries.represent') : null
  return (
    <button type="button" className="tc-tile tc-represent" onClick={onOpen}>
      <span className="tc-camera"><Icon name="camera-outline" size={24} /></span>
      <span className="tc-represent-text">{title}</span>
      {sub && <span className="tc-represent-sub">{sub}</span>}
    </button>
  )
}

/**
 * Yesterday's recap, one card (the app's TodayTour): the winning photo
 * (yesterday's #1, else the best: compareCountryProofs), "Yesterday", the question, the
 * winner's flag, city and answer, how many cities played; "Watch" and the
 * card open yesterday's tour at the winner. Its footer opens every past
 * challenge (V3 polish 3.2); without a photo yesterday, that link stays on its own.
 */
export function YesterdayRecap({ today }) {
  const { t, i18n } = useDc()
  const { openDaily } = useDaily()
  // undefined while loading, null when it failed.
  const [tour, setTour] = useState(undefined)
  const [open, setOpen] = useState(null)
  // Yesterday was a seasonal event's day (Halloween's recap): the label keeps its emoji.
  const seasonal = useSeasonal()
  useBackLayer(open !== null, () => setOpen(null))
  const cityId = today?.city?.id ?? null
  const loaded = !!today
  const day = today?.challenge?.date ?? null
  useEffect(() => {
    if (!loaded) return
    let alive = true
    loadTour(cityId, i18n.language, day).then(r => { if (alive) setTour(r) }).catch(() => { if (alive) setTour(null) })
    return () => { alive = false }
  }, [loaded, cityId, i18n.language, day])
  const archive = (
    <button type="button" className="tc-archive" onClick={() => openDaily('archive', { source: 'today_yesterday' })}>
      <Icon name="calendar-outline" size={16} /><span className="tc-archive-text">{t('today.allPast')}</span><Icon name="chevron-forward" size={15} />
    </button>
  )
  const slides = tour?.slides ?? []
  if (tour === undefined) return null
  if (!tour || slides.length === 0) return <div className="today-card">{archive}</div>
  const recap = seasonal?.event.phase === 'recap' || isEventDay(seasonal, tour.date)
  // The winner: yesterday's #1, else the best photo (the shared rule: most liked, then the earliest posted).
  let at = slides.findIndex(s => s.podium === 1)
  if (at < 0) at = slides.reduce((best, s, i) => (compareCountryProofs(s.proof, slides[best].proof) < 0 ? i : best), 0)
  const cities = new Set(slides.map(s => s.city.id)).size   // a slide per photo: several per city
  const win = slides[at]
  const answer = win.proof.answer && !win.proof.backHome ? answerText(win.proof.answer, i18n.language) : null
  const question = tour.challenge.compare?.question ?? tour.challenge.text
  const watch = () => setOpen(at)
  return (
    <div className="today-card">
      <div className="today-card-head">
        <span className="today-card-title">{recap ? `${t('recap.label')} ${seasonal.theme.emoji}` : t('recap.label')}</span>
        <button type="button" className="dc-link" onClick={watch}>{t('tour.watch')}</button>
      </div>
      <button type="button" className="tc-recap" onClick={watch}>
        <span className="tc-recap-photo">
          <img src={win.proof.thumbUrl || win.proof.photoUrl} onError={thumbFallback(win.proof.photoUrl)} alt="" loading="lazy" />
          {win.podium === 1 && <span className="tc-recap-medal"><RankMedal rank={1} size={22} /></span>}
        </span>
        <span className="tc-recap-body">
          <span className="tc-recap-q">{question}</span>
          <span className="tc-city"><FlagSticker country={win.city.country} size={16} />{shortCityName(win.city.name)}{answer && <span className="tc-recap-answer"> · {answer}</span>}</span>
          <span className="dc-muted">{t('recap.cities', { count: cities })}</span>
        </span>
      </button>
      <div className="tc-archive-footer">{archive}</div>
      {open !== null && <WorldTourViewer tour={tour} start={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
