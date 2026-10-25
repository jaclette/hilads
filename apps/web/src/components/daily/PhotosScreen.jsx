import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fetchDailyProof, fetchDailyTodayProofs, fetchDailyVoters } from '../../api'
import { localizeCityName, shortCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'
import { shareLink } from '../../lib/shareLink'
import { useBackLayer } from '../../lib/backLayers'
import { openAppModal } from '../AppModal'
import AvatarWithFlag from '../AvatarWithFlag'
import Icon from '../Icon'
import { FlagSticker, onFillOf, plain, themeColor } from '../joy/Joy'
import { AnswerChip, captionRepeatsAnswer } from './compareShared'
import { lastCountries, rankCountryProofs } from './countryOrder'
import { flushSeen, markSeen } from './seen'
import {
  LocalPassBadge, RoleLabel, VotersSheet, getLastToday, personName, seedProofs, useCastVote, useDaily, useDc,
} from './dailyShared'

const LIMIT = 60
/** Two taps closer than this are a double tap (a vote). */
const DOUBLE_TAP_MS = 280

/**
 * Today's photos on the web, like the app: what everyone posted today, one
 * full-screen photo at a time, newest first; scroll or swipe for the next
 * (arrow keys too). World or my city on top, today's challenge as a pill
 * under them. Each photo: its player (opens the profile), city, answer,
 * caption and place; a big heart to vote (a double tap on the photo votes
 * too, with a heart burst) and Share. The end: the app to play. `proofId`
 * (a vote notification, a strip photo) opens on that photo, the others follow;
 * `country` (Today's stories row, a mosaic tile) plays that country's photos
 * best first, then the next countries'.
 */
export default function PhotosScreen({ tab: initialTab = 'world', proofId = null, country = null, source = 'today', onBack }) {
  const { t } = useDc()
  const { cityId, account, openDaily, openProfile } = useDaily()
  const today = getLastToday()
  const challenge = today?.challenge ?? null
  const city = today?.city ?? null
  const [tab, setTab] = useState(initialTab === 'city' && city ? 'city' : 'world')
  const [proofs, setProofs] = useState(null)
  const [pinned, setPinned] = useState(null)
  const [failed, setFailed] = useState(false)
  const [voters, setVoters] = useState(null)
  const [index, setIndex] = useState(0)
  const scroller = useRef(null)
  const seen = useRef(new Set())
  useBackLayer(voters !== null, () => setVoters(null))   // the list closes before the photos

  useEffect(() => {
    track('daily_photos_opened', { source, pinned: !!proofId, country, platform_surface: 'web' })
    return () => flushSeen()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Full screen: the app promo banner (above screens) steps aside while the photos are open.
  useEffect(() => {
    document.body.classList.add('dc-photos-open')
    return () => document.body.classList.remove('dc-photos-open')
  }, [])

  // The notification's photo leads; one from another day opens on its challenge instead.
  useEffect(() => {
    if (!proofId) return
    fetchDailyProof(proofId).then(p => {
      if (challenge && p.date !== challenge.date) { onBack(); openDaily('challenge', { date: p.date, proofId: p.id }); return }
      seedProofs([p], true)
      setPinned(p)
    }).catch(() => {})
  }, [proofId]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = () => {
    setFailed(false)
    setProofs(null)
    fetchDailyTodayProofs({ scope: tab, cityId: tab === 'city' ? cityId : null, order: 'new', limit: LIMIT })
      .then(res => {
        // A city with no photo yet falls back to World on the server: here it's an empty city.
        const items = tab === 'city' && res.scope !== 'city' ? [] : res.proofs.filter(p => !p.suggestion)
        seedProofs(items, challenge?.isActive ?? true)
        setProofs(items)
      })
      .catch(() => setFailed(true))
  }
  useEffect(load, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  // A country's story (Today's stories row, a mosaic tile): its photos best first (its top photo
  // leading, rankCountryProofs), then the next countries' the same way, in Today's order.
  const story = useMemo(() => {
    const groups = country ? lastCountries()?.items ?? [] : []
    const at = groups.findIndex(g => g.country === country)
    if (at < 0 || !proofs) return null
    const byId = new Map(proofs.map(p => [p.id, p]))
    const ids = [...groups.slice(at), ...groups.slice(0, at)].flatMap(g =>
      rankCountryProofs(g.ids.map(id => byId.get(id)).filter(Boolean), g.top.id).map(p => p.id))
    return new Map(ids.map((id, i) => [id, i]))
  }, [country, proofs])

  const photos = useMemo(() => {
    if (story && tab === 'world') return [...(proofs ?? [])].sort((a, b) => (story.get(a.id) ?? 1e9) - (story.get(b.id) ?? 1e9))
    const rest = (proofs ?? []).filter(p => p.id !== pinned?.id)
    const lead = pinned && (tab === 'world' || pinned.city?.id === city?.id)
    return lead ? [pinned, ...rest] : rest
  }, [proofs, pinned, tab, city?.id, story])

  const switchTab = (next) => {
    if (next === tab) return
    track('daily_photos_tab', { tab: next, platform_surface: 'web' })
    setTab(next)
    setIndex(0)
    scroller.current?.scrollTo({ top: 0 })
  }
  const onScroll = (e) => {
    const h = e.currentTarget.clientHeight
    if (h > 0) setIndex(Math.round(e.currentTarget.scrollTop / h))
  }
  const goTo = (i) => {
    const el = scroller.current
    if (el) el.scrollTo({ top: Math.max(0, i) * el.clientHeight, behavior: 'smooth' })
  }

  // Tracking each photo once.
  useEffect(() => {
    const p = photos[index]
    if (!p || seen.current.has(p.id)) return
    seen.current.add(p.id)
    markSeen(p.id, !!account)   // Today's story ring turns neutral once a country is all seen
    track('daily_photos_viewed', { index, city: p.city?.name ?? null, tab, platform_surface: 'web' })
  }, [index, photos]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => {
      if (voters !== null) return
      if (e.key === 'Escape') onBack()
      if (e.key === 'ArrowDown') { e.preventDefault(); goTo(index + 1) }
      if (e.key === 'ArrowUp') { e.preventDefault(); goTo(index - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, voters]) // eslint-disable-line react-hooks/exhaustive-deps

  const showVoters = async (id) => {
    setVoters('loading')
    try { setVoters(await fetchDailyVoters(id)) } catch { setVoters('error') }
  }
  const pill = challenge ? themeColor(challenge.special ? 'special' : challenge.theme?.key) : null

  return createPortal(
    <div className="dc-photos" role="dialog" aria-modal="true" aria-label={t('feed.title')}>
      {proofs === null ? (
        <div className="dc-photos-center">
          {failed ? (
            <>
              <p className="dc-photos-end-body">{t('loadFailed')}</p>
              <button type="button" className="today-cta" onClick={load}>{t('place.retry')}</button>
            </>
          ) : <span className="dc-photos-spinner" aria-hidden="true" />}
        </div>
      ) : (
        <div className="dc-photos-scroll" ref={scroller} onScroll={onScroll}>
          {photos.map((p, i) => (
            <Slide key={p.id} proof={p} hint={i === 0 && photos.length > 1}
                   onProfile={(u) => openProfile(u.id, u.username)} onVoters={() => showVoters(p.id)} />
          ))}
          <End empty={photos.length === 0} tab={tab} cityName={city?.name ? shortCityName(city.name) : null}
               canPlay={!!challenge?.isActive && !today?.myProof} onClose={onBack} />
        </div>
      )}

      {/* On top: close, World / my city, and today's challenge as a pill. */}
      <div className="dc-photos-top">
        <div className="dc-photos-head">
          <button type="button" className="dc-photos-close" onClick={onBack} aria-label={t('back')}><Icon name="close" size={22} /></button>
          <div className="dc-photos-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'world'} className={`dc-photos-tab${tab === 'world' ? ' dc-photos-tab--on' : ''}`}
                    onClick={() => switchTab('world')}><Icon name="earth-outline" size={15} />{t('feed.world')}</button>
            {city?.name && (
              <button type="button" role="tab" aria-selected={tab === 'city'} className={`dc-photos-tab${tab === 'city' ? ' dc-photos-tab--on' : ''}`}
                      onClick={() => switchTab('city')}><FlagSticker country={city.country} size={16} /><span>{shortCityName(city.name)}</span></button>
            )}
          </div>
          <span className="dc-photos-side" />
        </div>
        {challenge && pill && (
          <button type="button" className="dc-photos-pill" style={{ background: pill.fill, color: onFillOf(pill.fill) }}
                  onClick={() => { track('daily_photos_challenge_opened', { platform_surface: 'web' }); onBack(); openDaily('challenge', { date: 'today', source: 'photos' }) }}>
            <span>{plain(challenge.compare?.question ?? challenge.text)}</span><Icon name="chevron-forward" size={14} />
          </button>
        )}
      </div>

      <VotersSheet voters={voters} onClose={() => setVoters(null)}
                   onOpen={(v) => { setVoters(null); onBack(); openProfile(v.id, v.username) }} />
    </div>,
    document.getElementById('root') ?? document.body,
  )
}

/** One photo, full screen: the photo (blurred around it), its player and answer, the heart and Share. */
function Slide({ proof, hint, onProfile, onVoters }) {
  const { t, i18n } = useDc()
  const { state, canVote, voteLabel, error, press } = useCastVote(proof, 'photos')
  const [burst, setBurst] = useState(0)
  const lastTap = useRef(0)
  const handled = useRef(0)
  const name = personName(proof.user)
  const place = proof.spot?.name ?? proof.place?.name ?? null
  const count = state?.voteCount ?? proof.voteCount

  const vote = (withdraw) => {
    if (state?.isMine) { if (state.voteCount > 0) onVoters(); return }
    if (!state?.myVote) setBurst(b => b + 1)
    press({ withdraw })
  }
  const doubleTap = () => {
    // Touch taps and the browser's dblclick can both report the same double tap: once.
    if (Date.now() - handled.current < 500) return
    handled.current = Date.now()
    if (canVote && !state?.myVote) vote(false)
    else if (state?.myVote) setBurst(b => b + 1)
  }
  // Two taps within DOUBLE_TAP_MS (Safari may swallow the second click), or the browser's double click.
  const tap = (e) => {
    if (e.pointerType === 'mouse') return
    const now = Date.now()
    if (now - lastTap.current < DOUBLE_TAP_MS) { lastTap.current = 0; doubleTap(); return }
    lastTap.current = now
  }

  return (
    <section className="dc-photos-slide">
      <div className="dc-photos-blur" style={{ backgroundImage: `url("${proof.thumbUrl || proof.photoUrl}")` }} aria-hidden="true" />
      <img className="dc-photos-photo" src={proof.photoUrl} alt={proof.caption || ''} loading="lazy"
           onPointerUp={tap} onDoubleClick={doubleTap}
           title={t('feed.doubleTap')} />
      {burst > 0 && <span key={burst} className="dc-photos-burst" aria-hidden="true"><Icon name="heart" size={120} /></span>}
      <div className="dc-photos-shade" aria-hidden="true" />
      <div className="dc-photos-bottom">
        <div className="dc-photos-info">
          <button type="button" className="dc-photos-who" onClick={() => onProfile(proof.user)}>
            <AvatarWithFlag userId={proof.user.id} displayName={name} photoUrl={proof.user.photoUrl} size={40} />
            <span className="dc-photos-who-body">
              <span className="dc-photos-name">{name}{proof.user.localPass && <LocalPassBadge onDark />}</span>
              {proof.city?.name && (
                <span className="dc-photos-city">
                  <FlagSticker country={proof.city.country} size={16} />{localizeCityName(proof.city.name)}
                  <RoleLabel isLocal={proof.isLocal} />
                </span>
              )}
            </span>
          </button>
          {proof.answer && !proof.backHome && <AnswerChip answer={proof.answer} onDark />}
          {proof.caption && !captionRepeatsAnswer(proof.caption, proof.backHome ? null : proof.answer, i18n.language) && <p className="dc-photos-caption">{proof.caption}</p>}
          {place && <p className="dc-photos-place"><Icon name="location" size={14} />{place}</p>}
          {error && <p className="dc-photos-error" role="status">{error}</p>}
          {hint && <p className="dc-photos-hint"><Icon name="chevron-down" size={16} />{t('feed.swipe')}</p>}
        </div>
        <div className="dc-photos-actions">
          {proof.status === 'approved' && (
            <button type="button" className={`dc-photos-heart${state?.myVote ? ' dc-photos-heart--on' : ''}`} onClick={() => vote(true)}
                    aria-pressed={!!state?.myVote}
                    aria-label={state?.isMine ? t('vote.votersTitle') : state?.myVote ? t('vote.withdraw') : voteLabel}>
              <span className="dc-photos-heart-btn"><Icon name={state?.myVote || state?.isMine ? 'heart' : 'heart-outline'} size={28} /></span>
              <span className="dc-photos-count">{count}</span>
            </button>
          )}
          <button type="button" className="dc-photos-heart" aria-label={t('share.shareProof')}
                  onClick={() => shareLink({ type: 'proof', path: `/p/${proof.id}`, text: t('worlds.tagline'), source: 'photos' })}>
            <span className="dc-photos-heart-btn"><Icon name="paper-plane-outline" size={24} /></span>
          </button>
        </div>
      </div>
    </section>
  )
}

/** The last page: everyone seen (or nobody yet), then the app to play when I haven't. */
function End({ empty, tab, cityName, canPlay, onClose }) {
  const { t } = useDc()
  const title = empty ? (tab === 'city' && cityName ? t('feed.emptyCity', { city: cityName }) : t('feed.emptyWorld')) : t('feed.endTitle')
  return (
    <section className="dc-photos-slide dc-photos-end">
      <span className="dc-photos-end-emoji" aria-hidden="true">{empty ? '📸' : '🎉'}</span>
      <p className="dc-photos-end-title">{title}</p>
      <p className="dc-photos-end-body">{canPlay ? t('feed.endPlay') : t('feed.endBody')}</p>
      {canPlay && (
        <button type="button" className="today-cta" onClick={() => { track('web_today_take_clicked', { surface: 'photos' }); openAppModal({ action: 'play', surface: 'photos' }) }}>
          <Icon name="camera-outline" size={20} />{t('ctaAnswerNoCity')}
        </button>
      )}
      <button type="button" className="dc-photos-link" onClick={onClose}>{t('feed.backToday')}</button>
    </section>
  )
}
