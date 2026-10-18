import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchDailyCalendar, fetchDailyToday, fetchDailyTodayProofs, fetchSpotsNear } from '../../api'
import { localizeCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'
import { APP_STORE, PLAY_STORE, deviceStore, themeName } from '../map/spotsShared'
import { THEME_ICON } from '../../lib/icons'
import Icon from '../Icon'
import { CityFlag, CityName } from '../CityName'
import {
  useDaily, useDc, useCountdown, formatCountdown, isFinalHours, seedProofs, seedVotesLeft, useVoteCount,
  StatusChip, OriginalToggle, useOriginal, ProposedBy, RankMedal,
} from '../daily/dailyShared'
import { ymd } from '../daily/CalendarScreen'

const ROW = { display: 'inline-flex', alignItems: 'center', gap: 6 }

const addDays = (date, n) => ymd(new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000))

/** "350 m" / "1.2 km". */
function distance(m, lang) {
  if (m < 1000) return `${Math.round(m / 10) * 10 || m} m`
  const km = m / 1000
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km)} km`
}

/**
 * TODAY, the web home (W2, the app's Today tab, SPEC 9.3): the Daily Challenge
 * ticket, the week strip, today's proofs and Spots near you. Proofs are posted from the app: "Take the challenge" opens the store.
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
        <FirstLaunchLine />
        <Ticket data={data} loading={loading} />
        <Week today={data} />
        <TodayProofs today={data} />
        <SpotsNear />
      </div>
    </div>
  )
}

const FIRST_LAUNCH_KEY = 'hilads_first_launch_line_seen'

/**
 * First launch (W5, SPEC 9.9): "One local challenge a day." on top of Today
 * for a guest's first visit, never again. No tutorial.
 */
function FirstLaunchLine() {
  const { t } = useTranslation('common')
  const { account } = useDaily()
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (account) return
    try {
      if (localStorage.getItem(FIRST_LAUNCH_KEY) !== '1') { setShow(true); localStorage.setItem(FIRST_LAUNCH_KEY, '1') }
    } catch { /* storage blocked: skip the line */ }
  }, [account])
  if (!show || account) return null
  return <p className="first-launch">{t('firstLaunch')}</p>
}

function Ticket({ data, loading }) {
  const { t, i18n } = useDc()
  const { scope, openDaily } = useDaily()
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
        <span className="today-kicker" style={ROW}><Icon name="flame-outline" size={14} />{t('kicker')}</span>
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
  // People who took it: the city's count in city scope once it has proofs, else World's.
  const took = (scope === 'city' && data.counts?.city ? data.counts.city : data.counts?.world) ?? 0
  const timeOf = (s) => new Date(s * 1000).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="today-ticket dc-clickable" role="button" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open() }}
         aria-label={`${t('kicker')}: ${challenge.text}`}>
      <div className="today-top">
        <div className="today-head">
          <span className="today-kicker" style={ROW}><Icon name="flame-outline" size={14} />{t('kicker')}</span>
          {challenge.theme && <span className="today-chip" style={ROW}><Icon name={THEME_ICON[challenge.theme.key] ?? 'pricetag-outline'} size={14} />{themeName(challenge.theme.key)}</span>}
        </div>
        <p className="today-text">{showOriginal && challenge.original ? challenge.original.text : challenge.text}</p>
        <OriginalToggle translated={!!challenge.original || !!twist?.originalText} showingOriginal={showOriginal} onClick={toggleOriginal} />
        {challenge.proposedBy && <ProposedBy credit={challenge.proposedBy} />}
        <div className="today-meta-row">
          {secondsLeft !== null && (
            <span className={`today-meta${isFinalHours(secondsLeft) ? ' dc-countdown--warn' : ''}`} style={ROW}><Icon name="time-outline" size={14} />{t('timeLeft', { time: formatCountdown(secondsLeft) })}</span>
          )}
          {earlyUntil && <span className="today-early">{t('today.early', { time: timeOf(earlyUntil) })}</span>}
        </div>
      </div>
      <div className="today-perforation" aria-hidden="true" />
      <div className="today-bottom">
        {twist && (
          <div className="today-twist">
            <span className="today-twist-label"><CityFlag country={city?.country} />{t('twistIn', { city: localizeCityName(city?.name ?? '') })}</span>
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
        {took > 0 && (
          <button type="button" className="today-took" onClick={(e) => { e.stopPropagation(); open() }}>
            {t('today.tookIt', { count: took })} · <span className="today-took-link">{t('today.seePhotos', { count: took })}</span>
          </button>
        )}
        {data.twistProposal && (data.twistProposal.open || data.twistProposal.status) && (
          <button type="button" className="today-propose" onClick={(e) => {
            e.stopPropagation()
            track('daily_proposal_started', { entry: 'twist_hero', type: 'twist', platform_surface: 'web' })
            openDaily('twist')
          }}>
            <Icon name="leaf-outline" size={18} />
            <span className="today-propose-text">
              {data.twistProposal.status
                ? t('twist.heroStatus', { status: t(`twist.status.${data.twistProposal.status}`) })
                : t('twist.heroCta', { time: timeOf(data.twistProposal.closesAt) })}
            </span>
            <Icon name="chevron-forward" size={16} />
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
  // The week's themes are public (the challenges' themes, else the weekday
  // defaults): loaded for everyone; my statuses and streak only come signed in.
  useEffect(() => {
    fetchDailyCalendar(addDays(now, -8), addDays(now, 8)).then(setCal).catch(() => {})
  }, [account?.id, now]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!account) return 'none'
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
        <button type="button" className="week-streak" style={ROW} onClick={() => (account ? openDaily('calendar') : needAccount('view_profile'))}>
          <Icon name="flame-outline" size={17} style={{ color: 'var(--primary-text)' }} />
          {streak ? t('streak', { count: streak }) : t('week.title')}
        </button>
        {tomorrowTheme && <span className="week-tomorrow">{t('today.tomorrow', { theme: themeName(tomorrowTheme.key) })}</span>}
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
                {state === 'done' ? <Icon name="checkmark" size={18} />
                  : state === 'pending' ? <Icon name="hourglass-outline" size={17} />
                  : state === 'missed' ? <Icon name="close" size={17} />
                  : theme && THEME_ICON[theme] ? <Icon name={THEME_ICON[theme]} size={17} /> : null}
              </span>
            </button>
          )
        })}
      </div>
      <button type="button" className="week-propose" style={ROW} onClick={propose}><Icon name="bulb-outline" size={16} />{t('propose.cta')}</button>
    </div>
  )
}

/**
 * Today's proofs (SPEC 9.3): the scope's approved proofs as a photo strip, most
 * voted first then newest, each with its city and votes, and a 1/2/3 seal on
 * the top three once the leaderboard ranks. A city with none shows World's.
 * Hidden when nobody has posted.
 */
function TodayProofs({ today }) {
  const { t, i18n } = useDc()
  const { scope, openDaily } = useDaily()
  const [strip, setStrip] = useState(null)
  const date = today?.challenge?.date ?? null
  const cityNum = scope === 'city' ? today?.city?.id ?? null : null

  useEffect(() => {
    if (!date) { setStrip(null); return }
    let alive = true
    fetchDailyTodayProofs({ scope: cityNum ? 'city' : 'world', cityId: cityNum, locale: i18n.language })
      .then(s => { if (!alive) return; setStrip(s); seedProofs(s.proofs, true) })
      .catch(() => { /* keep what we have */ })
    return () => { alive = false }
  }, [date, cityNum, i18n.language])

  if (!strip || strip.proofs.length === 0) return null
  const world = strip.scope === 'world'
  const proofs = t('today.proofs', { count: strip.total })
  return (
    <div className="today-card">
      <div className="today-card-head">
        <span className="today-card-title">{world ? t('today.aroundWorld') : t('today.inCity', { city: localizeCityName(strip.city?.name ?? '') })}</span>
        <button type="button" className="dc-link" onClick={() => openDaily('challenge', { date: 'today', source: 'today' })}>{t('today.seeAll')}</button>
      </div>
      <span className="dc-muted today-proofs-stats">
        {world ? t('today.proofsIn', { proofs, countries: t('today.countries', { count: strip.countries }) }) : proofs}
      </span>
      <div className="proof-strip">
        {strip.proofs.map(p => (
          <StripProof key={p.id} proof={p} onOpen={() => openDaily('challenge', { date: 'today', proofId: p.id })} />
        ))}
      </div>
    </div>
  )
}

function StripProof({ proof, onOpen }) {
  const { t } = useDc()
  const voteCount = useVoteCount(proof)
  const city = proof.city ? localizeCityName(proof.city.name ?? '') : ''
  const votes = t('today.votes', { count: voteCount })
  return (
    <button type="button" className="proof-strip-item" onClick={onOpen}
            aria-label={[proof.rank ? `#${proof.rank}` : null, city, votes].filter(Boolean).join(', ')}>
      <span className="proof-strip-photo">
        <img src={proof.thumbUrl || proof.photoUrl} alt="" loading="lazy" />
        {proof.rank && <span className="proof-strip-rank"><RankMedal rank={proof.rank} size={24} /></span>}
      </span>
      {proof.city?.name && <CityName name={proof.city.name} country={proof.city.country} short className="proof-strip-city" />}
      <span className="dc-muted proof-strip-votes">{votes}</span>
    </button>
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
        <button type="button" className="spots-empty" onClick={() => openSpot(null)}><Icon name="location-outline" size={18} style={{ color: 'var(--primary-text)' }} />{t('today.spotsEmpty')}</button>
      ) : (
        <div className="spots-row">
          {spots.map(s => (
            <button key={s.id} type="button" className="spot-card" onClick={() => openSpot(s.id)} aria-label={s.name}>
              {s.cover?.thumbUrl || s.cover?.photoUrl ? <img src={s.cover.thumbUrl || s.cover.photoUrl} alt="" loading="lazy" /> : <span className="spot-card-img" />}
              <span className="spot-card-body">
                <span className="spot-card-name">{s.name}</span>
                <span className="dc-muted" style={ROW}>
                  {s.distanceM !== undefined && <><Icon name="location-outline" size={13} />{distance(s.distanceM, i18n.language)}</>}
                  {s.themes?.[0] && THEME_ICON[s.themes[0]] ? <Icon name={THEME_ICON[s.themes[0]]} size={13} /> : null}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
