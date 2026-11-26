import i18next from 'i18next'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from '../Icon'
import AvatarWithFlag from '../AvatarWithFlag'
import HalongArt from './HalongArt'
import { mediumUrl } from '../../lib/imageThumb'
import { fetchContest, fetchContestRanking, fetchCrew, notifyContest } from '../../api'
import { shareLink } from '../../lib/shareLink'
import { track } from '../../lib/analytics'
import { getLastToday, RankMedal } from '../daily/dailyShared'
import { ordinal } from '../../lib/ordinal'
import { countdownTarget, shortLeft, useLiveNow, SouvenirLine, Podium, JoinForm, ContestPrize } from './ContestScreen'

/**
 * The campaign's destination, the "Trip" tab (the app's app/(tabs)/trip.tsx, same sections and
 * states): the prize photo (tap: the prize details) collapsing to a slim header, a sticky sub-menu
 * (Overview · Ranking · Friends · Rules, tap or swipe), one section at a time. Every value from
 * GET /contest (the back office); the points are the regular Hilads points.
 */
const SECTIONS = ['overview', 'ranking', 'friends', 'rules']
const SLIM = 52
const useT = () => useTranslation('profile', { keyPrefix: 'pp' })
const shortDate = (date, locale) => new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
const shift = (date, days) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) }
const isOver = s => s.phase === 'over' || s.phase === 'ended'

export default function TripScreen({ account, initialSection = 'overview', onOpenToday, onOpenProfile, onSignUp }) {
  const { t, i18n } = useT()
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  const [ranking, setRanking] = useState(null)
  const [crew, setCrew] = useState(null)
  const [section, setSection] = useState(SECTIONS.includes(initialSection) ? initialSection : 'overview')
  const [collapsed, setCollapsed] = useState(false)
  const [overlay, setOverlay] = useState(null)   // 'prize' | 'join'
  const scroller = useRef(null)
  const hero = useRef(null)

  const load = useCallback(() => {
    setFailed(false)
    return fetchContest(i18n.language).then(setData).catch(() => setFailed(true))
  }, [i18n.language])
  useEffect(() => { load() }, [load])
  const s = data?.season ?? null
  const part = s && ['final', 'over', 'ended'].includes(s.phase) ? 'final' : 'season'
  useEffect(() => {
    if (!s) return
    fetchContestRanking(part).then(setRanking).catch(() => {})
    if (account) fetchCrew().then(setCrew).catch(() => {})
  }, [s?.id, part, account?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (s) track('trip_viewed', { section, phase: s.phase, test: !!s.isTest, platform_surface: 'web' }) }, [s?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (SECTIONS.includes(initialSection)) setSection(initialSection) }, [initialSection])

  const onScroll = () => {
    const el = scroller.current
    const h = hero.current?.offsetHeight ?? 0
    if (!el) return
    const c = el.scrollTop >= h - SLIM - 8
    setCollapsed(prev => (prev === c ? prev : c))
  }
  const go = (next, via) => {
    if (next === section) return
    track('trip_section_viewed', { section: next, via, phase: s?.phase ?? null, platform_surface: 'web' })
    const el = scroller.current
    const h = (hero.current?.offsetHeight ?? 0) - SLIM
    if (el && el.scrollTop > h) el.scrollTop = h
    setSection(next)
  }
  // Swipe left / right on the section to change it (phones).
  const touch = useRef(null)
  const onTouchStart = e => { const p = e.touches[0]; touch.current = { x: p.clientX, y: p.clientY } }
  const onTouchEnd = e => {
    const a = touch.current; touch.current = null
    if (!a) return
    const p = e.changedTouches[0]
    const dx = p.clientX - a.x, dy = p.clientY - a.y
    if (Math.abs(dx) < 60 || Math.abs(dy) > 40) return
    const i = SECTIONS.indexOf(section)
    if (dx < 0 && i < SECTIONS.length - 1) go(SECTIONS[i + 1], 'swipe')
    if (dx > 0 && i > 0) go(SECTIONS[i - 1], 'swipe')
  }
  const cta = (name, extra) => track('trip_cta', { cta: name, section, phase: s?.phase ?? null, platform_surface: 'web', ...extra })

  if (overlay === 'prize') {
    return <ContestPrize account={account} onBack={() => setOverlay(null)} onOpenHome={() => setOverlay(null)} onSignUp={onSignUp}
                         onOpenRules={() => { cta('prize_rules'); setOverlay(null); go('rules', 'cta') }} />
  }
  if (overlay === 'join' && s) {
    return (
      <div className="full-page full-page--tab tr-page">
        <JoinForm season={s} suggested={data.me?.suggestedCountry} onBack={() => setOverlay(null)} onDone={() => { setOverlay(null); load() }} />
      </div>
    )
  }

  if (!s) {
    return (
      <div className="full-page full-page--tab tr-page">
        <div className="tr-empty">
          {!data && !failed ? <span className="spinner" aria-label="…" /> : (
            <>
              <Icon name="airplane-outline" size={40} />
              <h2>{t('trip.noneTitle')}</h2>
              <p>{t('trip.noneText')}</p>
              <button type="button" className="btn-secondary" onClick={onOpenToday}>{t('trip.toToday')}</button>
            </>
          )}
        </div>
      </div>
    )
  }

  const cover = s.photos?.[0]
  const prizeCta = s.tab?.prizeCta || t('trip.prizeCta')
  const openPrize = () => { cta('prize'); setOverlay('prize') }
  return (
    <div className="full-page full-page--tab tr-page">
      <div className="tr-scroll" ref={scroller} onScroll={onScroll}>
        {/* The whole photo opens the prize, and so does its "See the prize" button. */}
        <div className="tr-hero" ref={hero} role="button" tabIndex={0} onClick={openPrize}
             onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPrize() } }}
             aria-label={`${s.name}. ${s.prize?.title || s.name}. ${t('trip.forFirst')}. ${t('trip.a11yPrize')}`}>
          <span className="tr-hero-art">{cover ? <img src={mediumUrl(cover.url) ?? cover.url} alt="" /> : <HalongArt />}</span>
          <span className="tr-hero-shade" aria-hidden="true" />
          <span className="tr-hero-top">
            <span className="tr-tag">{s.name.toUpperCase()}</span>
            {s.isTest && <span className="ls-test">{t('contest.test')}</span>}
          </span>
          <span className="tr-hero-bottom">
            <span className="tr-hero-text">
              <strong className="tr-hero-title">{s.prize?.title || s.name}{' '}✈️</strong>
              <span className="tr-hero-sub">{isOver(s) && s.winner ? t('trip.over.winnerKnown') : t('trip.forFirst')}</span>
              <button type="button" className="tr-prize-btn" onClick={e => { e.stopPropagation(); openPrize() }}>
                {prizeCta}<Icon name="chevron-forward" size={14} />
              </button>
            </span>
            <Chip s={s} />
          </span>
        </div>

        <div className="tr-stick">
          <div className={`tr-slim${collapsed ? ' is-on' : ''}`} aria-hidden={!collapsed}>
            <button type="button" className="tr-slim-row" onClick={openPrize} tabIndex={collapsed ? 0 : -1}>
              <span className="tr-slim-thumb">{cover ? <img src={mediumUrl(cover.url) ?? cover.url} alt="" /> : <HalongArt />}</span>
              <span className="tr-slim-text"><span className="tr-slim-title">{s.prize?.title || s.name}</span>
                <small className="tr-slim-link">{prizeCta.replace(/\s*🎁\s*$/u, '')} ›</small></span>
              <Chip s={s} small />
            </button>
          </div>
          <div className="tr-menu" role="tablist">
            {SECTIONS.map((k, i) => (
              <button key={k} type="button" role="tab" aria-selected={k === section} className={`tr-menu-item${k === section ? ' is-on' : ''}`}
                      aria-label={t('trip.a11ySection', { name: t(`trip.sections.${k}`), index: i + 1, count: SECTIONS.length })}
                      onClick={() => go(k, 'tap')}>{t(`trip.sections.${k}`)}</button>
            ))}
          </div>
        </div>

        <div className="tr-body" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} key={section}>
          {section === 'overview' && <Overview data={data} ranking={ranking} crew={crew} account={account} t={t} i18n={i18n} onCta={cta}
                                               onSection={k => go(k, 'cta')} onJoin={() => { cta('join'); setOverlay('join') }} onSignUp={onSignUp}
                                               onOpenToday={onOpenToday} onOpenProfile={onOpenProfile} setData={setData} />}
          {section === 'ranking' && <Ranking s={s} ranking={ranking} meId={account?.id ?? null} t={t} i18n={i18n} onOpenProfile={onOpenProfile} />}
          {section === 'friends' && <Friends s={s} crew={crew} account={account} t={t} onCta={cta} onSignUp={onSignUp} />}
          {section === 'rules' && <Rules s={s} counter={data.counter} t={t} i18n={i18n} onCta={cta} />}
        </div>
      </div>
    </div>
  )
}

function Chip({ s, small }) {
  const { t } = useT()
  const { now } = useLiveNow()
  const target = countdownTarget(s)
  const label = target ? t(`trip.chip.${target.label}`) : t('trip.chip.over')
  const value = target ? shortLeft(target.at - now, t) : null
  return (
    <span className={`tr-chip${small ? ' tr-chip--small' : ''}`} role="timer" aria-label={value ? `${value} ${label}` : label}>
      {value && <b>{s.phase === 'final' && <i className="tr-live-dot" aria-hidden="true" />}{value}</b>}
      <small className={value ? '' : 'tr-chip-only'}>{label}</small>
    </span>
  )
}

// ── Overview ──────────────────────────────────────────────────────────────────

function Overview({ data, ranking, crew, account, t, i18n, onCta, onSection, onJoin, onSignUp, onOpenToday, onOpenProfile, setData }) {
  const s = data.season
  const [sharing, setSharing] = useState(false)
  return (
    <div className="tr-stack">
      {s.isTest && <p className="tr-test-note" role="alert"><Icon name="warning-outline" size={16} />{t('trip.testNote')}</p>}
      {isOver(s) && <Winner data={data} ranking={ranking} t={t} onOpenProfile={onOpenProfile} />}
      <Timeline s={s} t={t} i18n={i18n} />
      {data.counter && <Boarding s={s} counter={data.counter} me={data.me} t={t} i18n={i18n} onShare={() => { onCta('boarding_share'); setSharing(true) }} />}
      {sharing && <BoardingShare s={s} counter={data.counter} account={account} t={t} onClose={() => setSharing(false)} />}
      {!isOver(s) && <MyStatus data={data} account={account} t={t} i18n={i18n} />}
      <PrimaryCta data={data} crew={crew} account={account} t={t} i18n={i18n} onCta={onCta} onSection={onSection} onJoin={onJoin}
                  onSignUp={onSignUp} onOpenToday={onOpenToday} setData={setData} />
    </div>
  )
}

function Timeline({ s, t, i18n }) {
  const d = x => shortDate(x, i18n.language)
  const now = s.phase === 'season' ? 0 : s.phase === 'final' ? 1 : isOver(s) ? 2 : -1
  const steps = [
    { icon: 'lock-open-outline', title: t('trip.phases.unlock'), when: `${d(s.startDate)} – ${d(shift(s.finalWeekStart, -1))}` },
    { icon: 'flag-outline', title: t('trip.phases.final'), when: `${d(s.finalWeekStart)} – ${d(s.endDate)}` },
    { icon: 'trophy-outline', title: t('trip.phases.winner'), when: d(shift(s.endDate, 1)) },
  ]
  return (
    <ol className="tr-timeline">
      {steps.map((st, i) => (
        <li key={i} className={`tr-phase${i === now ? ' is-now' : ''}${i < now ? ' is-done' : ''}`}
            aria-label={`${st.title}, ${st.when}${i === now ? `, ${t('trip.phases.now')}` : i < now ? `, ${t('trip.phases.done')}` : ''}`}>
          <Icon name={i < now ? 'checkmark-circle' : st.icon} size={22} />
          <b>{st.title}</b>
          <small>{i === now ? t('trip.phases.now') : st.when}</small>
        </li>
      ))}
    </ol>
  )
}

// Boarding: the players' goal as a flight ("186 of 500 seats taken", the plane along the route; below
// the server's showFrom "Be among the first to board", never a count near 0), my boarding pass, the
// fallback. The block and its Invite button open the Boarding share (my invite link).
function Boarding({ s, counter, me, t, i18n, onShare }) {
  const reached = counter.reached ?? counter.players >= counter.threshold
  const showCount = reached || (counter.players > 0 && counter.players >= (counter.showFrom ?? 0))
  const pct = showCount ? Math.min(1, counter.players / Math.max(1, counter.threshold)) : 0
  const joined = me?.joined && !me.excluded ? me : null
  const myPhotos = joined ? joined.photos ?? 0 : null
  const earned = myPhotos !== null && myPhotos >= counter.photos
  const status = showCount ? t('trip.board.seats', { players: counter.players, threshold: counter.threshold }) : t('trip.board.first')
  const dots = Math.min(counter.photos, 10)
  return (
    <div role="button" tabIndex={0} className={`tr-card tr-boarding${reached ? ' is-reached' : ''}`} aria-label={t('trip.board.a11y', { status })}
         onClick={onShare} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onShare() } }}>
      <h3 className="tr-card-title">{reached ? t('trip.board.full') : t('trip.board.title')}
        <span className="tr-invite-chip"><Icon name="share-outline" size={16} />{t('trip.board.invite')}</span></h3>
      <p className={showCount ? 'tr-seats' : 'tr-seats is-first'}>{status}</p>
      <div className="tr-track" aria-hidden="true">
        <span className="tr-track-bg" /><span className="tr-track-fill" style={{ width: `${pct * 100}%` }} />
        <span className="tr-track-plane" style={{ left: `${pct * 100}%` }}><Icon name="airplane-outline" size={22} /></span>
        <span className="tr-track-gift"><Icon name="gift" size={22} /></span>
      </div>
      <p className="tr-muted">{reached ? t('trip.board.fullText') : `${t('trip.board.takeoff')} ${t('trip.board.what', { photos: counter.photos })}`}</p>
      {myPhotos !== null && (
        <div className={`tr-pass${earned ? ' is-earned' : ''}`}
             aria-label={earned ? `${t('trip.board.passEarned')}. ${t('trip.board.passEarnedText')}` : `${t('trip.board.pass')}: ${t('trip.board.passProgress', { n: myPhotos, photos: counter.photos })}`}>
          <Icon name={earned ? 'airplane-outline' : 'ticket-outline'} size={20} />
          <span className="tr-pass-text"><small>{earned ? t('trip.board.passEarned') : t('trip.board.pass')}</small>
            <b>{earned ? t('trip.board.passEarnedText') : t('trip.board.passProgress', { n: myPhotos, photos: counter.photos })}</b></span>
          {earned ? <Icon name="sparkles" size={20} /> : (
            <span className="tr-pass-dots" aria-hidden="true">{Array.from({ length: dots }).map((_, i) =>
              <i key={i} className={i < Math.round((myPhotos / Math.max(1, counter.photos)) * dots) ? 'on' : ''} />)}</span>
          )}
        </div>
      )}
      {!reached && (
        <p className="tr-fallback"><Icon name="gift-outline" size={16} />
          <span>{isOver(s) ? t('trip.board.notFullText', { prize: s.fallbackPrize ?? '' })
            : t('trip.board.fallback', { date: shortDate(s.endDate, i18n.language), prize: s.fallbackPrize ?? '' })}</span>
        </p>
      )}
    </div>
  )
}

// The Boarding share (the app's SharePanel with the Boarding card): a preview of the card (the prize photo,
// "186 / 500 seats taken. Grab yours", Hilads), my invite link (a friend who joins from it counts for me),
// WhatsApp / Messenger / Copy link, and the system share sheet (Zalo, Instagram... where the browser has one).
function BoardingShare({ s, counter, account, t, onClose }) {
  const [code, setCode] = useState(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (account) fetchCrew().then(c => setCode(c.code)).catch(() => {}) }, [account])
  useEffect(() => { track('share_started', { content_type: 'trip_boarding', source: 'trip_boarding', platform_surface: 'web' }) }, [])
  const showCount = (counter.reached ?? false) || (counter.players > 0 && counter.players >= (counter.showFrom ?? 0))
  const text = showCount ? t('trip.board.shareText', { players: counter.players, threshold: counter.threshold }) : t('trip.board.shareTextFirst')
  const path = `/today${code ? `?ref=${code}&` : '?'}utm_campaign=launch_trip`
  const link = ch => `${window.location.origin}${path}&utm_source=${ch}&utm_medium=share`
  const done = channel => track('share_completed', { content_type: 'trip_boarding', channel, platform_surface: 'web' })
  const go = ch => {
    track('share_target', { content_type: 'trip_boarding', channel: ch, platform_surface: 'web' })
    if (ch === 'copy_link') {
      navigator.clipboard?.writeText(`${text}\n${link(ch)}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); done(ch) }).catch(() => {})
      return
    }
    if (ch === 'share_sheet') { shareLink({ type: 'trip_boarding', path, text, source: 'trip_boarding' }); return }
    const url = ch === 'whatsapp' ? `https://wa.me/?text=${encodeURIComponent(`${text}\n${link(ch)}`)}` : `fb-messenger://share?link=${encodeURIComponent(link(ch))}`
    window.open(url, '_blank', 'noopener'); done(ch)
  }
  const cover = s.photos?.[0]
  const targets = [['whatsapp', 'chatbubble-ellipses-outline', 'WhatsApp'], ['messenger', 'chatbubbles-outline', 'Messenger'],
                   ['copy_link', copied ? 'checkmark' : 'link-outline', copied ? t('invite.copied') : t('invite.channel.copy_link')], ['share_sheet', 'share-outline', t('invite.share')]]
  return (
    <div className="tr-share-scrim" role="dialog" aria-modal="true" aria-label={t('trip.board.invite')} onClick={onClose}>
      <div className="tr-share" onClick={e => e.stopPropagation()}>
        <div className="tr-share-card" aria-hidden="true">
          <span className="tr-share-art">{cover ? <img src={mediumUrl(cover.url) ?? cover.url} alt="" /> : <HalongArt />}</span>
          <span className="tr-share-body"><small>Hilads · Launch Trip</small>
            <b>{showCount ? t('trip.board.cardSeats', { players: counter.players, threshold: counter.threshold }) : t('trip.board.first')}</b>
            <em>{t('trip.board.cardGrab')} ✈️</em></span>
        </div>
        <div className="tr-share-targets">{targets.map(([ch, icon, label]) => (
          <button key={ch} type="button" onClick={() => go(ch)}><span><Icon name={icon} size={22} /></span>{label}</button>))}</div>
        <button type="button" className="tr-cta is-secondary" onClick={onClose}>{t('back', { ns: 'common' })}</button>
      </div>
    </div>
  )
}

function MyStatus({ data, account, t, i18n }) {
  const s = data.season
  const me = data.me
  const board = (title, text) => <section className="tr-board"><b>{title}</b>{text && <p>{text}</p>}</section>
  if (s.phase === 'upcoming') return board(t('trip.me.upcomingTitle'), t('trip.me.upcomingText', { date: shortDate(s.startDate, i18n.language) }))
  if (!account || !me) return board(t('trip.me.joinTitle'), t('trip.me.joinText'))
  if (me.joined === false) return board(t('trip.me.joinTitle'), me.canJoin ? t('trip.me.joinText') : me.reason === 'closed' ? t('trip.me.closed') : t('trip.me.cantJoin'))
  if (me.disqualified) return board(t('contest.dq'))
  if (me.excluded) return board(t('contest.excluded'))
  const race = me.race
  if (!race || !race.rank || race.points <= 0) {
    return (
      <section className="tr-board">
        <span className="tr-board-top"><span className="tr-rank-empty"><Icon name="flag-outline" size={20} /></span>
          <span><b>{t('trip.me.notScored')}</b><p>{t(race?.part === 'final' ? 'trip.me.notScoredFinal' : 'trip.me.notScoredText')}</p></span></span>
      </section>
    )
  }
  const moved = race.prevRank != null ? race.prevRank - race.rank : null
  const line = race.rank === 1 ? t('trip.me.leading') : race.gap === 0 ? t('trip.me.tie', { rank: race.rank - 1 }) : t('trip.me.gap', { count: race.gap ?? 0, rank: race.rank - 1 })
  const above = race.gap != null ? race.points + race.gap : race.points
  const pct = race.rank === 1 ? 1 : Math.max(0.04, Math.min(1, race.points / Math.max(1, above)))
  return (
    <section className="tr-board" aria-label={`${t('trip.me.rank', { rank: race.rank })}. ${t('contest.pts', { count: race.points })}. ${line}`}>
      <span className="tr-board-top">
        <span className="tr-rank">{race.rank}</span>
        <span className="tr-board-text">{race.part === 'final' && <small className="tr-board-kicker">{t('trip.me.finalLive')}</small>}
          <b>{t('trip.me.rank', { rank: race.rank })}</b>
          <p>{t('contest.pts', { count: race.points })} · {line}</p></span>
        {moved ? <span className={`tr-move ${moved > 0 ? 'up' : 'down'}`}>{moved > 0 ? `▲${moved}` : `▼${-moved}`}</span> : null}
      </span>
      <span className="tr-board-bar"><i style={{ width: `${pct * 100}%` }} /></span>
      {race.part === 'final' && race.headstart > 0 && <p>{t('trip.me.headstart', { count: race.headstart })}</p>}
    </section>
  )
}

function PrimaryCta({ data, crew, account, t, i18n, onCta, onSection, onJoin, onSignUp, onOpenToday, setData }) {
  const s = data.season
  const me = data.me
  const [busy, setBusy] = useState(false)
  const btn = (icon, label, onClick, secondary) => (
    <button type="button" className={`tr-cta${secondary ? ' is-secondary' : ''}`} onClick={onClick} disabled={busy}><Icon name={icon} size={20} />{label}</button>
  )
  if (isOver(s)) return btn('podium-outline', t('trip.cta.ranking'), () => { onCta('see_ranking'); onSection('ranking') }, true)
  if (s.phase === 'upcoming') {
    const notified = me?.joined === true || !!me?.notified
    if (!account) return btn('notifications-outline', t('contest.notifyMe'), () => { onCta('sign_in'); onSignUp() })
    return btn(notified ? 'checkmark-circle-outline' : 'notifications-outline', t(notified ? 'contest.notifyOn' : 'contest.notifyMe'), () => {
      if (notified) return
      onCta('notify'); setBusy(true)
      notifyContest(s.id, i18n.language).then(setData).catch(() => {}).finally(() => setBusy(false))
    }, notified)
  }
  if (!account || !me) return btn('rocket-outline', t('trip.cta.signIn'), () => { onCta('sign_in'); onSignUp() })
  if (me.joined === false) return me.canJoin ? btn('rocket-outline', t('trip.cta.join'), onJoin) : null
  if (me.disqualified || me.excluded) return null
  const played = !!getLastToday()?.myProof
  if (!played) return btn('camera-outline', t('trip.cta.play'), () => { onCta('play'); onOpenToday() })
  return (
    <div className="tr-played">
      <p><Icon name="checkmark-circle" size={20} />{t('trip.cta.played')}</p>
      {btn('person-add-outline', t('trip.cta.invite'), () => { onCta('invite', { friends: crew?.count ?? null }); onSection('friends') })}
    </div>
  )
}

function Winner({ data, ranking, t, onOpenProfile }) {
  const s = data.season
  const w = s.winner
  const me = data.me?.joined ? data.me : null
  const name = w ? (w.username ? '@' + w.username : w.displayName ?? '') : ''
  return (
    <section className="tr-card is-reached tr-winner">
      {w ? (
        <>
          <AvatarWithFlag userId={w.userId} displayName={w.displayName ?? w.username} photoUrl={w.photoUrl} size={88} />
          <h3 className="tr-card-title">{t('trip.over.winnerTitle', { name })}</h3>
          <p>{data.counter?.reached ? t('trip.over.winnerTrip', { name, prize: s.prize?.title || s.name }) : t('trip.over.winnerFallback', { name, prize: s.fallbackPrize ?? '' })}</p>
        </>
      ) : (
        <>
          <Icon name="hourglass-outline" size={34} />
          <h3 className="tr-card-title">{t('trip.over.title')}</h3>
          <p className="tr-muted">{t('trip.over.text')}</p>
          {ranking?.rows?.length > 0 && <Podium rows={ranking.rows.slice(0, 3)} meId={ranking.me?.userId ?? null} t={t} onOpenProfile={onOpenProfile} />}
        </>
      )}
      {me?.finalRank ? <b className="tr-you-finished">{t('trip.over.yourRank', { rank: me.finalRank })}</b> : null}
    </section>
  )
}

// ── Ranking ───────────────────────────────────────────────────────────────────

function Ranking({ s, ranking, meId, t, i18n, onOpenProfile }) {
  const final = ranking?.phase === 'final'
  const hs = s.rules.headstartTopN
  const mine = ranking?.me ?? null
  const rows = ranking?.rows ?? []
  return (
    <div className="tr-stack">
      <h3 className="tr-section-title">{t(final ? 'trip.ranking.final' : 'trip.ranking.before')}
        {s.phase === 'final' && <span className="tr-live"><i className="tr-live-dot" aria-hidden="true" />{t('trip.ranking.live')}</span>}</h3>
      {mine?.rank && <div className="tr-pinned"><small>{t('trip.ranking.you')}</small><RaceRow row={mine} me bonus={final ? mine.headstart : 0} t={t} onOpenProfile={onOpenProfile} /></div>}
      {!ranking ? <p className="tr-muted">…</p> : rows.length === 0 ? (
        <section className="tr-card"><p>{s.phase === 'upcoming' ? t('trip.ranking.emptyUpcoming', { date: shortDate(s.startDate, i18n.language) }) : t('trip.ranking.empty')}</p></section>
      ) : (
        <section className="tr-card">
          <Podium rows={rows.slice(0, 3)} meId={meId} t={t} onOpenProfile={onOpenProfile} bonusFor={row => (final ? row.headstart : 0)} />
          <div className="tr-rows">{rows.slice(3).map(r => <RaceRow key={r.userId} row={r} me={r.userId === meId} bonus={final ? r.headstart : 0} t={t} onOpenProfile={onOpenProfile} />)}</div>
        </section>
      )}
      <p className="tr-note"><Icon name="flag-outline" size={20} />
        <span>{final ? t('trip.ranking.noteFinal', { date: shortDate(s.finalWeekStart, i18n.language), count: hs, end: shortDate(s.endDate, i18n.language) })
          : t('trip.ranking.noteBefore', { date: shortDate(s.finalWeekStart, i18n.language), count: hs })} {t('trip.ranking.ties')}</span></p>
    </div>
  )
}

function RaceRow({ row, me, bonus, t, onOpenProfile }) {
  const name = row.username ? '@' + row.username : row.displayName ?? ''
  const moved = row.prevRank != null ? row.prevRank - row.rank : null
  const move = moved === null ? t('trip.ranking.new') : moved > 0 ? `▲${moved}` : moved < 0 ? `▼${-moved}` : null
  const moveA11y = moved === null ? t('trip.ranking.new') : moved > 0 ? t('trip.ranking.up', { count: moved }) : moved < 0 ? t('trip.ranking.down', { count: -moved }) : ''
  return (
    <button type="button" className={`tr-row${me ? ' is-me' : ''}`} onClick={() => onOpenProfile(row.userId, row.displayName ?? row.username)}
            aria-label={`${ordinal(row.rank, i18next.language)}, ${name}${me ? `, ${t('contest.youLabel')}` : ''}, ${t('contest.pts', { count: row.points })}${moveA11y ? `, ${moveA11y}` : ''}`}>
      <span className="tr-row-n">{row.rank}</span>
      <AvatarWithFlag userId={row.userId} displayName={row.displayName ?? row.username} photoUrl={row.photoUrl} size={36} />
      <span className="tr-row-name">{me ? t('contest.youLabel') : name}{bonus > 0 && <span className="ls-hs">{t('contest.hsBadge', { count: bonus })}</span>}</span>
      {move && <span className={`tr-row-move${moved === null ? ' new' : moved > 0 ? ' up' : ' down'}`} aria-hidden="true">{move}</span>}
      <b className="tr-row-pts">{row.points}</b>
    </button>
  )
}

// ── Friends ───────────────────────────────────────────────────────────────────

function Friends({ s, crew, account, t, onCta, onSignUp }) {
  const friendPts = crew?.points?.friend ?? s.points?.friend ?? 10
  const crewPts = crew?.points?.crew ?? s.points?.crew ?? 50
  const max = crew?.max ?? s.points?.friendsPerMonth ?? 5
  const steps = [['share-social-outline', t('trip.friends.step1')], ['person-add-outline', t('trip.friends.step2')], ['camera-outline', t('trip.friends.step3', { points: friendPts })]]
  const share = () => {
    if (!crew) return
    onCta('share_invite', { friends: crew.count })
    shareLink({ type: 'invite', path: `/today?ref=${crew.code}`, text: t('invite.shareLine'), source: 'trip_friends' })
  }
  return (
    <div className="tr-stack">
      <section className="tr-card">
        <h3 className="tr-card-title">{t('trip.friends.title', { points: friendPts })}</h3>
        <ol className="tr-steps">{steps.map(([icon, text], i) => <li key={i}><i>{i + 1}</i><Icon name={icon} size={26} /><span>{text}</span></li>)}</ol>
      </section>
      {!account ? (
        <section className="tr-card"><p>{t('trip.friends.signIn')}</p>
          <button type="button" className="tr-cta" onClick={() => { onCta('sign_in'); onSignUp() }}><Icon name="person-add-outline" size={20} />{t('trip.cta.signIn')}</button></section>
      ) : (
        <>
          <section className="tr-card">
            <div className="tr-slots" aria-label={t('trip.friends.slots', { count: crew?.count ?? 0, max })}>
              {Array.from({ length: max }).map((_, i) => {
                const ok = i < (crew?.count ?? 0)
                return <span key={i} className={`tr-slot${ok ? ' is-on' : ''}`}>{ok ? <Icon name="checkmark" size={20} /> : i === max - 1 ? <b>+{crewPts}</b> : <Icon name="add" size={18} />}</span>
              })}
            </div>
            <p>{t('trip.friends.slots', { count: crew?.count ?? 0, max })}</p>
            <p className="tr-muted">{crew?.bonus ? t('trip.friends.crewDone', { points: crewPts }) : t('trip.friends.crew', { size: max, points: crewPts })}</p>
            <button type="button" className="tr-cta" onClick={share} disabled={!crew}><Icon name="share-outline" size={20} />{t('trip.friends.share')}</button>
          </section>
          <section className="tr-card">
            <h3 className="tr-card-title">{t('trip.friends.list')}</h3>
            {!crew || crew.friends.length === 0 ? <p className="tr-muted">{t('trip.friends.none')}</p> : crew.friends.map(f => {
              const status = f.status ?? (f.credited ? 'credited' : 'joined')
              return (
                <div key={f.id} className="tr-friend">
                  <AvatarWithFlag userId={f.id} displayName={f.displayName ?? f.username} photoUrl={f.photoUrl} size={36} />
                  <b>{f.username ? '@' + f.username : f.displayName ?? ''}</b>
                  <span className={`tr-friend-status${status === 'credited' ? ' is-ok' : ''}`}>
                    {status === 'credited' ? t('trip.friends.status.credited', { points: friendPts }) : t(`trip.friends.status.${status}`)}</span>
                </div>
              )
            })}
          </section>
        </>
      )}
    </div>
  )
}

// ── Rules ─────────────────────────────────────────────────────────────────────

function Rules({ s, counter, t, i18n, onCta }) {
  const d = x => shortDate(x, i18n.language)
  const p = s.points ?? { play: 10, podium: [30, 20, 10], week: 30, friend: 10, crew: 50, crewSize: 5, friendsPerMonth: 5 }
  const hs = s.rules.headstartTopN
  const table = [
    [t('trip.rules.week'), `+${p.week}`], [t('trip.rules.friend', { count: p.friendsPerMonth }), `+${p.friend}`],
    [t('trip.rules.crew', { size: p.crewSize }), `+${p.crew}`],
  ]
  return (
    <div className="tr-stack">
      <section className="tr-card">
        <h3 className="tr-card-title">{t('trip.rules.howTitle')}</h3>
        <ol className="tr-how">{[t('trip.rules.how1'), t('trip.rules.how2', { count: hs, date: d(s.finalWeekStart) }), t('trip.rules.how3', { date: d(s.endDate) })]
          .map((line, i) => <li key={i}><i className={i === 2 ? 'win' : ''}>{i + 1}</i><span>{line}</span></li>)}</ol>
      </section>
      <section className="tr-card">
        <h3 className="tr-card-title">{t('trip.rules.pointsTitle')}</h3>
        <dl className="tr-table">
          <div><dt>{t('trip.rules.play')}</dt><dd>+{p.play}</dd></div>
          {/* The podium of the day: one line per place with its medal, as on "How it works". */}
          <div><dt>{t('trip.rules.podiumTitle')}</dt><dd /></div>
          {p.podium.map((pts, i) => <div key={`p${i}`} className="tr-place"><dt><RankMedal rank={i + 1} podium size={28} />{t('trip.rules.place', { rank: i + 1 })}</dt><dd>+{pts}</dd></div>)}
          {table.map(([label, value], i) => <div key={i}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        <p className="tr-muted">{t('trip.rules.pointsNote', { date: d(s.startDate) })}</p>
      </section>
      <section className="tr-card">
        <h3 className="tr-card-title">{t('trip.rules.finalTitle')}</h3>
        <p>{t('trip.rules.final1', { date: d(s.finalWeekStart) })}</p>
        {hs > 0 && <p>{t('trip.rules.final2', { count: hs })}</p>}
        <p>{t('trip.rules.final3')}</p>
      </section>
      <section className="tr-card">
        <h3 className="tr-card-title">{t('trip.rules.prizeTitle')}</h3>
        <p><b>{s.prize?.title || s.name}</b></p>
        {s.prize?.subtitle && <p>{s.prize.subtitle}</p>}
        {s.prize?.description && <p className="tr-muted">{s.prize.description}</p>}
        <SouvenirLine souvenir={s.souvenir} />
      </section>
      <section className="tr-card">
        <h3 className="tr-card-title">{t('trip.rules.goalTitle')}</h3>
        <p>{t('trip.rules.goalText', { players: counter?.threshold ?? 500, photos: counter?.photos ?? 10 })}</p>
        <p>{t('trip.rules.fallbackText', { date: d(s.endDate), prize: s.fallbackPrize ?? '' })}</p>
      </section>
      <section className="tr-card">
        <h3 className="tr-card-title">{t('trip.rules.whoTitle')}</h3>
        <ul className="tr-who">{['who1', 'who2', 'who3', 'who4'].map(k => <li key={k}><Icon name="checkmark" size={16} />{t(`trip.rules.${k}`)}</li>)}</ul>
      </section>
      <a className="tr-cta is-secondary" href={s.rulesUrl} target="_blank" rel="noreferrer" onClick={() => onCta('rules_full')}>
        <Icon name="open-outline" size={20} />{t('trip.rules.full')}</a>
    </div>
  )
}
