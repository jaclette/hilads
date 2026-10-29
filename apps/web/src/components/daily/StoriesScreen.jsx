import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fetchDailyProofsByIds, fetchDailyTodayCountries } from '../../api'
import { localizeCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'
import AvatarWithFlag from '../AvatarWithFlag'
import Icon from '../Icon'
import { FlagSticker, themeColor } from '../joy/Joy'
import { todayCities } from '../today/TodayCountries'
import { AnswerChip, captionRepeatsAnswer } from './compareShared'
import { lastCountries, rememberCountries } from './countryOrder'
import { LocalPassBadge, getLastToday, personName, seedProofs, useCastVote, useDaily, useDc } from './dailyShared'
import { CommentButton, commentsTargetOf, useCommentsOpen } from './PhotoCommentsSheet'
import { flushSeen, markSeen } from './seen'
import { SeasonalZone } from '../event/seasonal'

/** How long a photo stays before the next one (no auto-advance with reduced motion). */
const PHOTO_MS = 5000
/** Two taps closer than this are a double tap (a vote). */
const DOUBLE_TAP_MS = 280
/** Pressed longer than this: a hold (pause), not a tap. */
const HOLD_MS = 250
/** The API's limit for /daily/proofs?ids=. */
const IDS_MAX = 50

/**
 * Today's stories on the web (the app's /daily/stories, V3 polish 2.1): the
 * compare experience. One city at a time, all its photos (best first) with a
 * segment each at the top; tap the right side for the next photo, the left
 * third to go back, hold to pause, Esc or the close button to close; after a
 * city's last photo the next city follows (Today's order from `city`, the
 * cities before it at the end), auto-advancing every 5 s (never with reduced
 * motion). Each photo: its player (opens the profile), the answer, the caption
 * and a heart (a double tap votes too). Each photo shown counts as seen (the
 * rings). Photos that can't load are skipped. Dark in every theme, like the
 * other photo viewers.
 */
export default function StoriesScreen(props) {
  return <SeasonalZone><Stories {...props} /></SeasonalZone>
}

function Stories({ city: startCity = null, source = 'today', onBack }) {
  const { t, i18n } = useDc()
  const { account, openProfile } = useDaily()
  const [cities, setCities] = useState(() => {
    const list = todayCities(lastCountries())
    return list.length ? list : null
  })
  const [failed, setFailed] = useState(false)
  const [cityIndex, setCityIndex] = useState(0)
  const [photoIndex, setPhotoIndex] = useState(0)
  const [proofs, setProofs] = useState({})
  // Photos that couldn't load (removed, a network error): skipped, never a stuck loader.
  const [gone, setGone] = useState(() => new Set())
  const [held, setHeld] = useState(false)
  // Paused while held, and while the photo's comments are open.
  const commentsOpen = useCommentsOpen()
  const paused = held || commentsOpen
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  // Start at the city asked for; the cities before it come at the end.
  const order = useMemo(() => {
    if (!cities) return []
    const at = Math.max(0, cities.findIndex(c => String(c.city.id) === String(startCity)))
    return [...cities.slice(at), ...cities.slice(0, at)]
  }, [cities, startCity])

  useEffect(() => {
    track('today_stories_opened', { source, city: startCity, platform_surface: 'web' })
    if (!cities) {
      fetchDailyTodayCountries({ locale: i18n.language })
        .then(d => { rememberCountries(d); setCities(todayCities(d)) })
        .catch(() => setFailed(true))
    }
    return () => flushSeen()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Full screen: the app promo banner (above screens) steps aside while the stories are open.
  useEffect(() => {
    document.body.classList.add('dc-photos-open')
    return () => document.body.classList.remove('dc-photos-open')
  }, [])

  const group = order[cityIndex] ?? null
  const ids = (group?.ids ?? []).filter(id => !gone.has(id))
  const proof = ids[photoIndex] ? proofs[ids[photoIndex]] ?? null : null

  // A city's photos, the first time it shows (its top one is already there).
  useEffect(() => {
    if (!group) return
    const missing = group.ids.filter(id => !proofs[id] && id !== group.top.id).slice(0, IDS_MAX)
    const seed = { [group.top.id]: proofs[group.top.id] ?? group.top }
    if (!missing.length) { setProofs(p => ({ ...seed, ...p })); return }
    const skip = (lost) => { if (lost.length) setGone(g => new Set([...g, ...lost])) }
    fetchDailyProofsByIds(missing, i18n.language).then(list => {
      seedProofs(list, getLastToday()?.challenge?.isActive ?? true)
      setProofs(p => ({ ...seed, ...p, ...Object.fromEntries(list.map(x => [x.id, x])) }))
      skip(missing.filter(id => !list.some(x => x.id === id)))
    }).catch(() => { setProofs(p => ({ ...seed, ...p })); skip(missing) })
  }, [group?.city.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (proof) markSeen(proof.id, !!account) }, [proof?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const nextCity = () => {
    if (cityIndex + 1 < order.length) { setCityIndex(cityIndex + 1); setPhotoIndex(0); return }
    track('today_stories_completed', { cities: order.length, platform_surface: 'web' })
    onBack()
  }
  const next = () => {
    if (photoIndex + 1 < ids.length) { setPhotoIndex(photoIndex + 1); return }
    nextCity()
  }
  const prev = () => {
    if (photoIndex > 0) { setPhotoIndex(photoIndex - 1); return }
    if (cityIndex > 0) {
      const before = order[cityIndex - 1]
      setCityIndex(cityIndex - 1)
      setPhotoIndex(Math.max(0, before.ids.filter(id => !gone.has(id)).length - 1))
    }
  }
  // The photo shown was skipped (it couldn't load) and nothing follows in this city: the next city.
  useEffect(() => {
    if (group && photoIndex >= ids.length) nextCity()
  }, [group?.city.id, photoIndex, ids.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onBack()
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // every render: next/prev read the current photo

  const skipPhoto = (id) => setGone(g => new Set([...g, id]))

  if (!group) {
    return createPortal(
      <div className="tour" role="dialog" aria-modal="true" aria-label={t('worlds.tagline')}>
        <div className="dc-photos-center">
          {failed || (cities && !cities.length) ? <p className="dc-photos-end-body">{t('loadFailed')}</p> : <span className="dc-photos-spinner" aria-hidden="true" />}
        </div>
        <div className="tour-top"><div className="tour-head"><button type="button" className="tour-close" onClick={onBack} aria-label={t('back')}><Icon name="close" size={22} /></button></div></div>
      </div>,
      document.getElementById('root') ?? document.body,
    )
  }

  // The segments fill in today's theme color (the theme color system, V3 polish 7).
  const today = getLastToday()?.challenge
  const tc = themeColor(today?.special ? 'special' : today?.theme?.key)
  const barColor = tc.line ?? tc.fill

  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-label={t('worlds.tagline')}>
      {proof
        ? <img key={proof.id} className="tour-photo" src={proof.photoUrl} alt={proof.caption || ''} onError={() => skipPhoto(proof.id)} />
        : <div className="dc-photos-center"><span className="dc-photos-spinner" aria-hidden="true" /></div>}
      <div className="tour-shade" />

      {proof && <TapZone proof={proof} onPrev={prev} onNext={next} onHold={setHeld} />}

      <div className="tour-top">
        {/* One segment per photo of the city: done, filling, to come. */}
        <div className="tour-bars" role="img" aria-label={t('stories.of', { index: Math.min(photoIndex + 1, ids.length), total: ids.length })}>
          {ids.map((id, i) => (
            <span key={id} className="tour-bar">
              <span key={`${cityIndex}-${photoIndex}`}
                    className={`tour-bar-fill${i < photoIndex || (i === photoIndex && reduce) ? ' tour-bar-fill--done' : ''}${i === photoIndex && proof && !reduce ? ' st-bar-fill--run' : ''}`}
                    style={{ background: barColor, ...(i === photoIndex && paused ? { animationPlayState: 'paused' } : {}) }}
                    onAnimationEnd={i === photoIndex ? next : undefined} />
            </span>
          ))}
        </div>
        <div className="tour-head">
          <div className="tour-city">
            <FlagSticker country={group.city.country} size={26} />
            <span>
              <strong>{localizeCityName(group.city.name)}</strong>
              <small>{t('stories.cityOf', { index: cityIndex + 1, total: order.length })}</small>
            </span>
          </div>
          <button type="button" className="tour-close" onClick={onBack} aria-label={t('back')}><Icon name="close" size={22} /></button>
        </div>
      </div>

      {proof && <Bottom proof={proof} onProfile={() => openProfile(proof.user.id, proof.user.username)} />}
    </div>,
    document.getElementById('root') ?? document.body,
  )
}

/** The tap zone: the left third goes back, the rest forward; a double tap votes; hold to pause. */
function TapZone({ proof, onPrev, onNext, onHold }) {
  const { t } = useDc()
  const { state, canVote, press } = useCastVote(proof, 'stories')
  const lastTap = useRef(0)
  const pending = useRef(null)
  const hold = useRef(null)
  const held = useRef(false)
  useEffect(() => () => { clearTimeout(pending.current); clearTimeout(hold.current) }, [])

  const down = () => {
    held.current = false
    clearTimeout(hold.current)
    hold.current = setTimeout(() => { held.current = true; onHold(true) }, HOLD_MS)
  }
  const up = (e) => {
    clearTimeout(hold.current)
    if (held.current) { held.current = false; onHold(false); return }
    const r = e.currentTarget.getBoundingClientRect()
    const back = e.clientX - r.left < r.width / 3
    const now = Date.now()
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0
      clearTimeout(pending.current); pending.current = null
      if (canVote && !state?.myVote) { navigator.vibrate?.(12); press({ withdraw: false }) }
      return
    }
    lastTap.current = now
    // Wait out a possible second tap before moving on.
    pending.current = setTimeout(() => { pending.current = null; (back ? onPrev : onNext)() }, DOUBLE_TAP_MS)
  }
  const cancel = () => { clearTimeout(hold.current); if (held.current) { held.current = false; onHold(false) } }

  return (
    <button type="button" className="tour-tap st-tap" onPointerDown={down} onPointerUp={up} onPointerLeave={cancel} onPointerCancel={cancel}
            onContextMenu={(e) => e.preventDefault()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNext() } }}
            aria-label={t('stories.next')} title={t('feed.doubleTap')} />
  )
}

/** The photo's player, answer, caption and heart. */
function Bottom({ proof, onProfile }) {
  const { t, i18n } = useDc()
  const { state, canVote, voteLabel, error, press } = useCastVote(proof, 'stories')
  const name = personName(proof.user)
  const vote = () => {
    if (!state || state.isMine || (!canVote && !state.myVote)) return
    navigator.vibrate?.(12)
    press({ withdraw: !!state.myVote })
  }
  return (
    <div className="dc-photos-bottom">
      <div className="dc-photos-info">
        <button type="button" className="dc-photos-who" onClick={onProfile}>
          <AvatarWithFlag userId={proof.user.id} displayName={name} photoUrl={proof.user.photoUrl} size={38} />
          <span className="dc-photos-name">{proof.user.username ? `@${proof.user.username}` : name}{proof.user.localPass && <LocalPassBadge onDark />}</span>
        </button>
        {proof.answer && !proof.backHome && <AnswerChip answer={proof.answer} onDark />}
        {proof.caption && !captionRepeatsAnswer(proof.caption, proof.backHome ? null : proof.answer, i18n.language) && <p className="dc-photos-caption">{proof.caption}</p>}
        {error && <p className="dc-photos-error" role="status">{error}</p>}
      </div>
      {proof.status === 'approved' && (
        <div className="dc-photos-actions">
          <button type="button" className={`dc-photos-heart${state?.myVote ? ' dc-photos-heart--on' : ''}`} onClick={vote}
                  disabled={!state || state.isMine} aria-pressed={!!state?.myVote}
                  aria-label={state?.myVote ? t('vote.withdraw') : voteLabel}>
            <span className="dc-photos-heart-btn"><Icon name={state?.myVote || state?.isMine ? 'heart' : 'heart-outline'} size={28} /></span>
            <span className="dc-photos-count">{state?.voteCount ?? proof.voteCount}</span>
          </button>
          <CommentButton target={commentsTargetOf(proof)} variant="side" />
        </div>
      )}
    </div>
  )
}
