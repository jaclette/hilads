import { useEffect, useRef, useState } from 'react'
import { fetchDailyCalendar, fetchDailySheet, fetchDailyToday, fetchSpotsNear } from '../../api'
import { localizeCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'
import { THEME_EMOJI, APP_STORE, PLAY_STORE, deviceStore } from '../map/spotsShared'
import {
  useDaily, useDc, useCountdown, formatCountdown, isFinalHours, personName, seedProofs, seedVotesLeft,
  StatusChip, OriginalToggle, useOriginal, ProposedBy,
} from '../daily/dailyShared'
import { useLeaderboard } from '../daily/ChallengeScreen'
import { ymd } from '../daily/CalendarScreen'

const addDays = (date, n) => ymd(new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000))

/** "350 m" / "1.2 km". */
function distance(m, lang) {
  if (m < 1000) return `${Math.round(m / 10) * 10 || m} m`
  const km = m / 1000
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km)} km`
}

/**
 * TODAY, the web home (W2, the app's Today tab, SPEC 9.3): the Daily Challenge
 * ticket, the week strip, the live top 3 (or today's latest proofs) and Spots
 * near you. Proofs are posted from the app: "Take the challenge" opens the store.
 */
export default function TodayScreen({ header }) {
  const { i18n } = useDc()
  const { cityId } = useDaily()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchDailyToday(cityId, i18n.language)
      .then(d => {
        if (!alive) return
        setData(d)
        if (d.challenge?.isActive) { seedProofs([d.myProof], true); seedVotesLeft(d.myVotes?.left ?? null) }
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [cityId, i18n.language])

  return (
    <div className="full-page full-page--tab today-page">
      <div className="tab-app-header">{header}</div>
      <div className="page-body today-body">
        <Ticket data={data} loading={loading} />
        <Week today={data} />
        <Top3 today={data} />
        <SpotsNear />
      </div>
    </div>
  )
}

function Ticket({ data, loading }) {
  const { t, i18n } = useDc()
  const { openDaily } = useDaily()
  const [showOriginal, toggleOriginal] = useOriginal()
  const secondsLeft = useCountdown(data?.challenge ? data.nextDropAt : null)
  const tracked = useRef(null)
  const challenge = data?.challenge ?? null

  useEffect(() => {
    if (!challenge || tracked.current === challenge.id) return
    tracked.current = challenge.id
    track('daily_challenge_viewed', { source: 'today', date: challenge.date, platform_surface: 'web' })
  }, [challenge])

  if (loading && !data) return <div className="today-ticket today-ticket--loading"><span className="wm-spinner" aria-hidden="true" /></div>
  if (!challenge) {
    return (
      <div className="today-ticket today-top">
        <span className="today-kicker">🔥 {t('kicker')}</span>
        <p className="today-text">{t('nothingLive')}</p>
        {data?.secondsLeft != null && <p className="today-meta">{t('nextIn', { time: formatCountdown(data.secondsLeft) })}</p>}
      </div>
    )
  }

  const city = data.city
  const myProof = data.myProof ?? null
  const twist = data.twist && city?.isLive ? data.twist : null
  const earlyUntil = !myProof && data.early && data.early.until * 1000 > Date.now() ? data.early.until : null
  const store = deviceStore()
  const open = () => openDaily('challenge', { date: 'today', source: 'today' })
  const timeOf = (s) => new Date(s * 1000).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="today-ticket dc-clickable" role="button" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open() }}
         aria-label={`${t('kicker')}: ${challenge.text}`}>
      <div className="today-top">
        <div className="today-head">
          <span className="today-kicker">🔥 {t('kicker')}</span>
          {challenge.theme && <span className="today-chip">{THEME_EMOJI[challenge.theme.key] || '•'} {challenge.theme.name}</span>}
        </div>
        <p className="today-text">{showOriginal && challenge.original ? challenge.original.text : challenge.text}</p>
        <OriginalToggle translated={!!challenge.original || !!twist?.originalText} showingOriginal={showOriginal} onClick={toggleOriginal} />
        {challenge.proposedBy && <ProposedBy credit={challenge.proposedBy} />}
        <div className="today-meta-row">
          {secondsLeft !== null && (
            <span className={`today-meta${isFinalHours(secondsLeft) ? ' dc-countdown--warn' : ''}`}>⏱ {t('timeLeft', { time: formatCountdown(secondsLeft) })}</span>
          )}
          {earlyUntil && <span className="today-early">{t('today.early', { time: timeOf(earlyUntil) })}</span>}
        </div>
      </div>
      <div className="today-perforation" aria-hidden="true" />
      <div className="today-bottom">
        {twist && (
          <div className="today-twist">
            <span className="today-twist-label">{t('twistIn', { city: localizeCityName(city?.name ?? '') })}</span>
            <span className="today-twist-text">{showOriginal && twist.originalText ? twist.originalText : twist.text}</span>
          </div>
        )}
        {myProof ? (
          <div className="today-mine">
            <StatusChip status={myProof.status} />
            <button type="button" className="dc-link" onClick={(e) => { e.stopPropagation(); open() }}>{t('today.seeMine')}</button>
          </div>
        ) : (
          <a className="today-cta" href={store === 'android' ? PLAY_STORE : APP_STORE} target="_blank" rel="noopener noreferrer"
             onClick={(e) => { e.stopPropagation(); track('web_today_take_clicked', { store: store ?? 'ios', surface: 'today' }) }}>
            {t('cta')}
          </a>
        )}
        {data.twistProposal && (data.twistProposal.open || data.twistProposal.status) && (
          <button type="button" className="today-propose" onClick={(e) => {
            e.stopPropagation()
            track('daily_proposal_started', { entry: 'twist_hero', type: 'twist', platform_surface: 'web' })
            openDaily('twist')
          }}>
            <span aria-hidden="true">🌱</span>
            <span className="today-propose-text">
              {data.twistProposal.status
                ? t('twist.heroStatus', { status: t(`twist.status.${data.twistProposal.status}`) })
                : t('twist.heroCta', { time: timeOf(data.twistProposal.closesAt) })}
            </span>
            <span aria-hidden="true">›</span>
          </button>
        )}
      </div>
    </div>
  )
}

/** The week strip: the streak (→ calendar), tomorrow's theme, Monday to Sunday, "Propose a challenge". */
function Week({ today }) {
  const { t, i18n } = useDc()
  const { account, openDaily, needAccount } = useDaily()
  const [cal, setCal] = useState(null)
  const now = ymd(new Date())
  useEffect(() => {
    if (!account) return
    fetchDailyCalendar(addDays(now, -8), addDays(now, 8)).then(setCal).catch(() => {})
  }, [account, now])

  const current = cal?.today ?? today?.challenge?.date ?? null
  if (!current) return null
  const dow = (new Date(`${current}T12:00:00Z`).getUTCDay() + 6) % 7
  const monday = addDays(current, -dow)
  const byDate = new Map((cal?.days ?? []).map(d => [d.date, d]))
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const streak = today?.streak ?? cal?.streak?.current ?? null
  const tomorrowTheme = today?.tomorrow?.theme ?? byDate.get(addDays(current, 1))?.theme ?? null

  const stateOf = (date, d) => {
    if (date === current) return 'today'
    if (date === addDays(current, 1)) return 'tomorrow'
    if (date > current) return 'later'
    if (d?.myStatus === 'approved') return 'done'
    if (d?.myStatus === 'pending') return 'pending'
    return d?.published && cal?.streak ? 'missed' : 'none'
  }
  const openDay = (date, state) => {
    if (state === 'tomorrow' || state === 'later') return
    track('daily_week_strip_used', { action: 'day', date, status: state, platform_surface: 'web' })
    openDaily('challenge', state === 'today' ? { date: 'today', source: 'week' } : { date })
  }
  const propose = () => (account ? openDaily('propose', { source: 'week_strip' }) : needAccount('create_challenge'))

  return (
    <div className="week">
      <div className="week-head">
        <button type="button" className="week-streak" onClick={() => (account ? openDaily('calendar') : needAccount('view_profile'))}>
          🔥 {streak ? t('streak', { count: streak }) : t('week.title')}
        </button>
        {tomorrowTheme && <span className="week-tomorrow">{t('today.tomorrow', { theme: tomorrowTheme.name })}</span>}
      </div>
      <div className="week-row">
        {week.map(date => {
          const d = byDate.get(date)
          const state = stateOf(date, d)
          const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString(i18n.language, { weekday: 'short', timeZone: 'UTC' })
          const theme = d?.theme?.key ?? (date === current ? today?.challenge?.theme?.key : null)
          return (
            <button key={date} type="button" className="week-day" onClick={() => openDay(date, state)}
                    disabled={state === 'tomorrow' || state === 'later'} aria-label={`${weekday}: ${t(`today.day.${state}`)}`}>
              <span className={`week-weekday${state === 'today' ? ' week-weekday--today' : ''}`}>{weekday}</span>
              <span className={`week-dot week-dot--${state}`}>
                {state === 'done' ? '✓' : state === 'pending' ? '⏳' : state === 'missed' ? '✕' : (theme ? THEME_EMOJI[theme] : '')}
              </span>
            </button>
          )
        })}
      </div>
      <button type="button" className="week-propose" onClick={propose}>💡 {t('propose.cta')}</button>
    </div>
  )
}

/** Today's live top 3 (city when it has one, else World), or today's latest proofs before ranking. */
function Top3({ today }) {
  const { t } = useDc()
  const { scope, openDaily } = useDaily()
  const active = !!today?.challenge?.isActive
  const lb = useLeaderboard(active)
  const ranked = !!lb && lb.date === today?.challenge?.date && lb.ranked
  const cityNum = today?.city?.id ?? null
  const cityEntries = scope === 'city' && cityNum !== null ? lb?.cities.find(c => c.city.id === cityNum)?.entries ?? [] : []
  const top = !ranked ? [] : (cityEntries.length > 0 ? cityEntries : lb.world).slice(0, 3)

  if (!today?.challenge) return null
  if (top.length === 0) return <Latest today={today} />
  return (
    <div className="today-card">
      <div className="today-card-head">
        <span className="today-card-title">{t('today.top3')}</span>
        <button type="button" className="dc-link" onClick={() => openDaily('challenge', { date: 'today', tab: 'top10' })}>{t('today.seeTop10')}</button>
      </div>
      <div className="top3-row">
        {top.map(e => (
          <button key={e.proofId} type="button" className="top3-entry" onClick={() => openDaily('challenge', { date: 'today', proofId: e.proofId })}>
            {e.user.photoUrl ? <img className="top3-avatar" src={e.user.photoUrl} alt="" /> : <span className="top3-avatar">{(personName(e.user) || '?')[0].toUpperCase()}</span>}
            <span className="top3-text">
              <span className="top3-name">{e.user.username ?? personName(e.user)}</span>
              <span className="dc-muted">{t('today.votes', { count: e.voteCount })}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function Latest({ today }) {
  const { t, i18n } = useDc()
  const { scope, openDaily } = useDaily()
  const [proofs, setProofs] = useState([])
  const date = today.challenge?.date ?? null
  const cityNum = scope === 'city' ? today.city?.id ?? null : null

  useEffect(() => {
    if (!date) return
    let alive = true
    ;(async () => {
      try {
        let sheet = await fetchDailySheet(date, { scope: cityNum ? 'city' : 'world', cityId: cityNum, limit: 10, locale: i18n.language })
        if (cityNum && sheet.proofs.length === 0) sheet = await fetchDailySheet(date, { scope: 'world', limit: 10, locale: i18n.language })
        if (alive) setProofs(sheet.proofs)
      } catch { /* keep what we have */ }
    })()
    return () => { alive = false }
  }, [date, cityNum, i18n.language])

  if (proofs.length === 0) return null
  return (
    <div className="today-card">
      <div className="today-card-head">
        <span className="today-card-title">{t('today.latest')}</span>
        <button type="button" className="dc-link" onClick={() => openDaily('challenge', { date: 'today', source: 'today' })}>{t('today.seeAll')}</button>
      </div>
      <div className="latest-row">
        {proofs.map(p => (
          <button key={p.id} type="button" className="latest-thumb" onClick={() => openDaily('challenge', { date: 'today', proofId: p.id })}
                  aria-label={p.caption ?? p.user.username ?? ''}>
            <img src={p.thumbUrl || p.photoUrl} alt="" loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  )
}

/** Spots near you: the nearest 2-3 spots (position only if already allowed, else the city centre). */
function SpotsNear() {
  const { t, i18n } = useDc()
  const { cityId, scope, openSpot } = useDaily()
  const [spots, setSpots] = useState(null)
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    let alive = true
    const load = (pos) => {
      if (!pos && !cityId) { setSpots([]); return }
      fetchSpotsNear({ ...(pos ?? {}), cityId: pos ? (scope === 'city' ? cityId : null) : cityId })
        .then(r => { if (alive) { setSpots(r.items); setFallback(r.fallback) } })
        .catch(() => { if (alive) setSpots(s => s ?? []) })
    }
    const granted = scope === 'city' && navigator.permissions
      ? navigator.permissions.query({ name: 'geolocation' }).then(p => p.state === 'granted').catch(() => false)
      : Promise.resolve(false)
    granted.then(ok => {
      if (!ok || !navigator.geolocation) { load(null); return }
      navigator.geolocation.getCurrentPosition(
        p => load({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => load(null),
        { maximumAge: 10 * 60000, timeout: 5000 },
      )
    })
    return () => { alive = false }
  }, [cityId, scope])

  if (spots === null) return null
  return (
    <div className="spots">
      <div className="today-card-head">
        <span className="today-card-title">{t('today.spotsTitle')}</span>
        <button type="button" className="dc-link" onClick={() => openSpot(null)}>{t('today.openMap')}</button>
      </div>
      {fallback && spots.length > 0 && <p className="dc-muted">{t('today.spotsFallback')}</p>}
      {spots.length === 0 ? (
        <button type="button" className="spots-empty" onClick={() => openSpot(null)}>📍 {t('today.spotsEmpty')}</button>
      ) : (
        <div className="spots-row">
          {spots.map(s => (
            <button key={s.id} type="button" className="spot-card" onClick={() => openSpot(s.id)} aria-label={s.name}>
              {s.cover?.thumbUrl || s.cover?.photoUrl ? <img src={s.cover.thumbUrl || s.cover.photoUrl} alt="" loading="lazy" /> : <span className="spot-card-img" />}
              <span className="spot-card-body">
                <span className="spot-card-name">{s.name}</span>
                <span className="dc-muted">
                  {s.distanceM !== undefined ? `📍 ${distance(s.distanceM, i18n.language)}` : ''}
                  {s.themes?.[0] ? ` ${THEME_EMOJI[s.themes[0]]}` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
