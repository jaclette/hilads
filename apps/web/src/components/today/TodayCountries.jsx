import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { fetchDailyProofsByIds, fetchDailyTodayCountries, fetchDailyTour } from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'
import { thumbFallback } from '../../lib/thumbFallback'
import AvatarWithFlag from '../AvatarWithFlag'
import Icon from '../Icon'
import { FlagSticker, themeColor } from '../joy/Joy'
import { answerText } from '../daily/compareShared'
import { rememberCountries } from '../daily/countryOrder'
import { RankMedal, getLastToday, personName, seedProofs, useDaily, useDc, useHere, useVoteCount } from '../daily/dailyShared'
import { hasUnseen, useSeen } from '../daily/seen'
import { useSeasonalLive } from '../event/seasonal'
import { thumbUrl } from '../../lib/imageThumb'
import { placeholderStyle } from '../../lib/thumbhash'

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
  const swiped = useSwipedStack()
  // Nobody played yet: yesterday's best cities teach the idea.
  const [tour, setTour] = useState(null)
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
  // The mosaic: my city first, then the most liked.
  const cards = [...cities].sort((a, b) =>
    Number(isMine(b)) - Number(isMine(a))
    || (b.totalLikes ?? b.top.voteCount) - (a.totalLikes ?? a.top.voteCount)
    || b.count - a.count).slice(0, MOSAIC_MAX)
  const theme = themeColor(challenge.special ? 'special' : challenge.theme?.key)
  // Yesterday's podium first, one card per city.
  const slides = tour?.slides ?? []
  const yesterday = slides.map((s, i) => ({ s, i })).sort((a, b) => (a.s.podium ?? 99) - (b.s.podium ?? 99))
    .filter((x, k, all) => all.findIndex(y => y.s.city.id === x.s.city.id) === k).slice(0, 3)

  const openCity = (g, photo) => {
    track('today_countries_tile', { country: g.city.country, unseen: hasUnseen(g), platform_surface: 'web' })
    openDaily('stories', { city: g.city.id, source: 'today_mosaic', ...(photo ? { photo } : {}) })
  }

  return (
    <div className="tc">
      {(cities.length > 0 || canPlay) && (
        <div className="tc-block">
          <div className="today-card-head">
            <span className="tc-title">{cities.length > 0 ? t(copy?.played ?? 'stories.played', { count: cities.length }) : t('worlds.tagline')}</span>
            {cities.length > 0 && <button type="button" className="dc-link" onClick={() => openDaily('countries', { source: 'today_mosaic' })}>{t('today.seeAll')}</button>}
          </div>
          {cities.length === 0 && yesterday.length > 0 && <p className="dc-muted">{t('mosaic.yesterday')}</p>}
          <div className="tc-grid">
            {cities.length > 0
              ? cards.map(g => <CityCard key={g.city.id} group={g} pileColor={theme.fill} badge={seasonal?.theme.emoji} onOpen={photo => openCity(g, photo)} />)
              : yesterday.map(({ s, i }) => <CityCard key={s.proof.id} faded pileColor={theme.fill} group={{
                  city: { id: s.city.id, name: s.city.name, country: s.city.country ?? '' }, count: s.count ?? 1, authorCount: null,
                  authors: [], totalLikes: null, latestAt: 0, unseen: false, ids: [s.proof.id], top: s.proof,
                }} onOpen={() => openDaily('photos', { list: slides.map(x => x.proof), proofId: slides[i].proof.id, source: 'today_empty' })} />)}
          </div>
          {/* Until the first swipe ever: the piles can be swiped. */}
          {cities.length > 0 && !swiped && cards.some(g => g.count > 1) && <p className="dc-muted tc-hint">{t('mosaic.swipeHint')}</p>}
          {cities.length === 0 && yesterday.length === 0 && <p className="dc-muted">{t('countries.emptyBody')}</p>}
        </div>
      )}
    </div>
  )
}


/**
 * A city's card: its most liked photo (a polaroid pile behind it when the city
 * has several, swipeable, a nudge until the first swipe), its answer large,
 * its players and its likes. `faded`:
 * yesterday's card in the empty state.
 */
function CityCard({ group, onOpen, pileColor, badge, faded = false }) {
  const { t, i18n } = useDc()
  const photos = usePilePhotos(group, i18n.language)
  const n = photos.length
  const [front, setFront] = useState(0)
  useEffect(() => { if (front >= n) setFront(0) }, [n, front])
  const at = k => photos[(front + k) % Math.max(1, n)]
  const p = at(0) ?? group.top
  const votes = useVoteCount(p)
  const line = p.answer && !p.backHome ? answerText(p.answer, i18n.language) : p.caption ?? p.spot?.name ?? p.place?.name ?? ''
  const likes = votes
  const comments = p.commentCount ?? 0
  const pile = group.count > 1
  const swipeable = n > 1 && !faded
  const players = group.authorCount ?? 0
  // Where the top photo sits in the pile ("1/3"), the pile's size as soon as its photos are in.
  const total = n > 1 ? n : Math.min(group.count, PILE_MAX)
  const counter = pile && !faded
  const swiped = useSwipedStack()
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  // The top photo follows the finger / mouse sideways (a slight tilt); past a third of the card, or a
  // flick, it flies off and the next photo comes to the front, endlessly; short of it, it springs back.
  // touch-action: pan-y leaves vertical moves to the page; a drag only starts on a clearly horizontal move.
  const topRef = useRef(null)
  const drag = useRef(null)            // { x, y, t, dx, on }
  const dragged = useRef(false)        // swallow the click that ends a drag
  const setTop = (dx, transition) => {
    const el = topRef.current
    if (!el) return
    el.style.transition = transition ?? 'none'
    el.style.transform = dx ? `translateX(${dx}px) rotate(${reduce ? 0 : (dx / (el.offsetWidth || 160)) * 10}deg)` : ''
  }
  const next = () => {
    navigator.vibrate?.(8)
    markSwiped()
    track('today_pile_swipe', { city: group.city.id, photos: n, platform_surface: 'web' })
    setFront(f => (f + 1) % n)
    const el = topRef.current
    if (!el) return
    // The new top photo rises from the pile.
    el.style.transition = 'none'
    el.style.transform = reduce ? '' : 'scale(0.94)'
    el.style.opacity = reduce ? '0' : ''
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = reduce ? 'opacity 150ms ease' : 'transform 320ms cubic-bezier(.34,1.56,.64,1)'
      el.style.transform = ''
      el.style.opacity = ''
    }))
  }
  const onPointerDown = e => {
    if (!swipeable || (e.pointerType === 'mouse' && e.button !== 0)) return
    drag.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, dx: 0, on: false }
    dragged.current = false
  }
  const onPointerMove = e => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag.current = null; return }   // the page scrolls
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.5) return
      d.on = true
      dragged.current = true
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }
    d.dx = dx
    setTop(dx)
  }
  const onPointerUp = e => {
    const d = drag.current
    drag.current = null
    if (!d?.on) return
    const w = topRef.current?.offsetWidth || 160
    const v = Math.abs(d.dx) / Math.max(1, e.timeStamp - d.t)          // px / ms over the whole drag
    if (Math.abs(d.dx) > w * 0.33 || (v > 0.6 && Math.abs(d.dx) > 24)) {
      const dir = d.dx > 0 ? 1 : -1
      const el = topRef.current
      if (reduce && el) { el.style.transition = 'opacity 150ms ease'; el.style.opacity = '0' }
      else setTop(dir * w * 1.4, 'transform 200ms ease-in')
      setTimeout(next, reduce ? 150 : 200)
    } else {
      setTop(0, 'transform 280ms cubic-bezier(.34,1.56,.64,1)')
    }
  }

  // Until the first swipe ever (in this browser): a second after it shows, the first pile of the
  // visit nudges aside and springs back, the next photo's edge in view.
  useEffect(() => {
    if (!swipeable || reduce || swiped || !claimNudge()) return
    let back
    const id = setTimeout(() => {
      setTop(-35, 'transform 300ms ease-out')
      back = setTimeout(() => setTop(0, 'transform 360ms cubic-bezier(.34,1.56,.64,1)'), 320)
    }, 1000)
    return () => { clearTimeout(id); clearTimeout(back) }
  }, [swipeable]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <button type="button" className={`tc-card${faded ? ' tc-card--faded' : ''}${swipeable ? ' tc-card--pile' : ''}`}
            onClick={e => { if (dragged.current) { e.preventDefault(); dragged.current = false; return } onOpen(p.id) }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
            onPointerCancel={() => { drag.current = null; setTop(0, 'transform 200ms ease') }}
            onKeyDown={swipeable ? e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); next() } } : undefined}
            aria-label={[shortCityName(group.city.name), line, pile && players > 0 ? t('mosaic.players', { count: players }) : null,
                         swipeable ? t('stories.of', { index: front + 1, total: n }) : null, likes].filter(x => x !== null && x !== '').join(', ')}>
      {/* The pile: the next photos themselves, offset and tilted, a theme-colored edge; plain sheets until they load. */}
      {pile && !faded && group.count > 2 && <PileSheet proof={n > 2 ? at(2) : null} color={pileColor} back2 />}
      {pile && !faded && <PileSheet proof={n > 1 ? at(1) : null} color={pileColor} />}
      <span className="tc-tile" ref={topRef}>
        <span className="tc-photo-box">
          <img className="tc-photo" src={thumbUrl(p.thumbUrl || p.photoUrl)} style={placeholderStyle(p.thumbHash)} onError={thumbFallback(p.photoUrl)} alt="" loading="lazy" draggable={false} />
          {p.selfieUrl && <img loading="lazy" className="dp-mini" src={thumbUrl(p.selfieThumbUrl ?? p.selfieUrl)} style={placeholderStyle(p.selfieThumbHash)} alt="" draggable={false} />}
          {/* Top-right, clear of the selfie inset (top-left): the count, then the event badge. */}
          {(pile || badge) && (
            <span className="tc-corner">
              {pile && (
                <span className="tc-pill">
                  <Icon name={!counter && players > 0 && players >= group.count ? 'people-outline' : 'camera'} size={12} />
                  <span className="tc-pill-text">{counter ? `${(front % total) + 1}/${total}`
                    : players <= 0 ? group.count
                    : players >= group.count ? t('mosaic.players', { count: players })
                    : `${group.count} · ${t('mosaic.players', { count: players })}`}</span>
                </span>
              )}
              {badge && <span className="seasonal-badge seasonal-badge--inline" aria-hidden="true">{badge}</span>}
            </span>
          )}
          {/* Which photo of the pile is on top. */}
          {swipeable && (
            <span className="tc-dots" aria-hidden="true">
              {photos.slice(0, MAX_SEGMENTS).map((x, i) => <span key={x.id} className={`tc-dot${i === front % MAX_SEGMENTS ? ' tc-dot--on' : ''}`} />)}
            </span>
          )}
        </span>
        <span className="tc-tile-body">
          <span className="tc-city"><FlagSticker country={group.city.country} size={16} />{shortCityName(group.city.name)}</span>
          <span className="tc-answer">{line}</span>
          <span className="tc-foot">
            <span className="tc-avatars">
              {p.user && <span className="tc-avatar"><AvatarWithFlag userId={p.user.id} displayName={personName(p.user)} photoUrl={p.user.photoUrl} size={20} /></span>}
            </span>
            <span className="tc-votes">
              {comments > 0 && <span className="pc-count"><Icon name="chatbubble-outline" size={13} />{comments}</span>}
              <Icon name="heart-outline" size={14} />{likes}
            </span>
          </span>
        </span>
      </span>
    </button>
  )
}

/** A photo under the top one: the real next photo, edge visible, theme-colored border. */
function PileSheet({ proof, color, back2 = false }) {
  return (
    <span className={`tc-layer ${back2 ? 'tc-layer--back2' : 'tc-layer--back'}${proof ? ' tc-layer--photo' : ''}`}
          style={proof ? { borderColor: color } : { background: color }} aria-hidden="true">
      {proof && <img className="tc-photo" src={thumbUrl(proof.thumbUrl || proof.photoUrl)} style={placeholderStyle(proof.thumbHash)} alt="" loading="lazy" draggable={false} />}
    </span>
  )
}

// The city's photos for its pile (best first, the top one already there), fetched once per city and
// kept for the session: the card's back photos and what a swipe brings to the front.
const pileCache = new Map()
const pileAsked = new Set()
const PILE_MAX = 8
function usePilePhotos(group, locale) {
  const ids = group.ids.slice(0, PILE_MAX)
  const [, bump] = useState(0)
  const key = ids.join(',')
  useEffect(() => {
    const missing = ids.filter(id => id !== group.top.id && !pileCache.has(id) && !pileAsked.has(id))
    if (!missing.length) return
    missing.forEach(id => pileAsked.add(id))
    let live = true
    fetchDailyProofsByIds(missing, locale)
      .then(list => { seedProofs(list, getLastToday()?.challenge?.isActive ?? true); list.forEach(x => pileCache.set(x.id, x)); if (live) bump(v => v + 1) })
      .catch(() => missing.forEach(id => pileAsked.delete(id)))
    return () => { live = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return ids.map(id => (id === group.top.id ? group.top : pileCache.get(id))).filter(Boolean)
}

// Has this browser ever swiped a pile? Until then, the nudge and the hint show the swipe.
const SWIPED_KEY = 'has_swiped_stack'
let swipedStack = (() => { try { return localStorage.getItem(SWIPED_KEY) === '1' } catch { return false } })()
const swipedListeners = new Set()
const subscribeSwiped = l => { swipedListeners.add(l); return () => { swipedListeners.delete(l) } }
function useSwipedStack() {
  return useSyncExternalStore(subscribeSwiped, () => swipedStack, () => true)
}
function markSwiped() {
  if (swipedStack) return
  swipedStack = true
  try { localStorage.setItem(SWIPED_KEY, '1') } catch { /* private mode */ }
  swipedListeners.forEach(l => l())
}
// One nudge a visit: the first swipeable pile shown.
let nudged = false
function claimNudge() {
  if (nudged) return false
  nudged = true
  return true
}
