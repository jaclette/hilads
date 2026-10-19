import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchDailyCalendar, fetchDailyPodium, fetchDailyToday, fetchDailyTodayProofs, fetchDailyTour, fetchSpotsNear } from '../../api'
import { localizeCityName, shortCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'
import { shareLink } from '../../lib/shareLink'
import { APP_STORE, PLAY_STORE, deviceStore, isPlaceTheme, themeName } from '../map/spotsShared'
import { themeIcon } from '../../lib/icons'
import Icon from '../Icon'
import { answerText } from '../daily/compareShared'
import WorldTourViewer from '../daily/WorldTour'
import { IndexCarousel } from '../daily/Comparisons'
import { CityFlag, CityName } from '../CityName'
import {
  useDaily, useDc, useCountdown, formatCountdown, isFinalHours, seedProofs, seedVotesLeft, useVoteCount, useVotesLeft,
  StatusChip, OriginalToggle, useOriginal, ProposedBy, RankMedal, VoteButton,
} from '../daily/dailyShared'
import { ymd } from '../daily/CalendarScreen'
import { thumbFallback } from '../../lib/thumbFallback'

const ROW = { display: 'inline-flex', alignItems: 'center', gap: 6 }
/** Brand term: English in every locale. */
const DAILY_CHALLENGE = 'Daily Challenge'

const addDays = (date, n) => ymd(new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000))

/** "350 m" / "1.2 km". */
function distance(m, lang) {
  if (m < 1000) return `${Math.round(m / 10) * 10 || m} m`
  const km = m / 1000
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km)} km`
}

/**
 * TODAY, the web home (W2, the app's Today tab, SPEC 9.3): the Daily Challenge
 * ticket, the week strip, today's proofs, yesterday's podium and Spots near
 * you (or in the chosen city). Proofs are posted from the app: "Take the challenge" opens the store.
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
        <BrandLine today={data} />
        <Ticket data={data} loading={loading} />
        <Week today={data} />
        {/* Yesterday around the world (SPEC 10.7); yesterday's podium below 2 cities. */}
        <TourRow today={data} />
        <TodayProofs today={data} />
        {/* The world, compared (SPEC 10.9): last week's comparisons, every day. */}
        <IndexCarousel />
        <SpotsNear />
      </div>
    </div>
  )
}

/** "Challenge a friend" (SPEC 9.14): shares hilads.live/today (its preview = today's card). */
function ChallengeFriend({ challenge, representCity = null, source = 'today_card' }) {
  const { t } = useTranslation('common')
  const [copied, setCopied] = useState(false)
  const go = async (e) => {
    e.stopPropagation()
    // An unrepresented city (SPEC 9.16): "Help me represent Saigon on Hilads."
    const res = representCity
      ? await shareLink({ type: 'represent', path: '/today', text: t('represent.share', { city: representCity }), source: `represent_${source}` })
      : await shareLink({ type: 'today', path: '/today', text: t('shareLink.textToday', { challenge: challenge.text }), source })
    if (res === 'copied') { setCopied(true); setTimeout(() => setCopied(false), 1800) }
  }
  return (
    <button type="button" className="today-took today-friend" onClick={go}>
      <Icon name="paper-plane-outline" size={16} />
      <span className="today-took-link">{copied ? t('shareLink.copied') : representCity ? t('represent.invite') : t('shareLink.challengeFriend')}</span>
    </button>
  )
}

/** Bundled covers of known special days (public/covers), by id ("halloween-2027" too). */
const SPECIAL_COVERS = ['halloween']
function specialCover(special) {
  const id = special?.id?.replace(/-\d{4}$/, '')
  return id && SPECIAL_COVERS.includes(id) ? id : 'only_here'
}

/**
 * Today's brand line (SPEC 9.3 / 9.9): "Hilads" in the wordmark weight, then
 * the tagline in muted text, one line that wraps on small screens. At the top
 * of the scrolling content, so it scrolls away. For guests, and for signed-in
 * users until their first proof; then hidden so the card sits higher.
 */
function BrandLine({ today }) {
  const { t } = useTranslation('common')
  const { account } = useDaily()
  // Signed in: wait for Today to know, so it never flashes for users who posted.
  if (account && (!today || today.hasProof)) return null
  return <p className="brand-line"><span className="brand-line-name">Hilads</span> {t('firstLaunch')}</p>
}

/** True while the element is on screen and the tab visible: the "I'm in" pulse runs only then. */
function usePulseVisible(el) {
  const [onScreen, setOnScreen] = useState(true)
  const [tabVisible, setTabVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  useEffect(() => {
    const onVis = () => setTabVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])
  useEffect(() => {
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [el])
  return onScreen && tabVisible
}

/**
 * Today's Daily Challenge as a ticket (SPEC 9.3): an image band (the
 * challenge's cover, else its theme's) with "Daily Challenge" over the theme
 * and the time left; the challenge on the light background; the Local Twist,
 * "I'm in" (the card's only orange element) or my proof's status, and how many
 * took it. Tomorrow's Local Twist proposal sits under the week strip.
 */
const COMPARE_TIP_KEY = 'hilads_compare_tip_seen'
const TIP_MS = 6000
/** Until when the world block's tip shows (epoch ms; 0 = hidden): the card can remount while it shows. */
let tipUntil = 0

function Ticket({ data, loading }) {
  const { t, i18n } = useDc()
  const { t: tc } = useTranslation('common')
  const { scope, openDaily } = useDaily()
  const [showOriginal, toggleOriginal] = useOriginal()
  const secondsLeft = useCountdown(data?.challenge ? data.nextDropAt : null)
  const [pulseEl, setPulseEl] = useState(null)
  const tracked = useRef(null)
  const challenge = data?.challenge ?? null
  const pulseOn = usePulseVisible(pulseEl)
  // The world block's one-time tip (per browser): "Tap to compare your city with the world."
  const [tip, setTip] = useState(() => Date.now() < tipUntil)
  const hideTip = () => { tipUntil = 0; setTip(false) }
  const hasCompare = !!challenge?.compare
  useEffect(() => {
    if (!hasCompare) return
    try {
      if (localStorage.getItem(COMPARE_TIP_KEY) === '1') return
      localStorage.setItem(COMPARE_TIP_KEY, '1')
    } catch { return }
    tipUntil = Date.now() + TIP_MS
    setTip(true)
  }, [hasCompare])
  useEffect(() => {
    if (!tip) return
    const id = setTimeout(() => setTip(false), Math.max(0, tipUntil - Date.now()))
    return () => clearTimeout(id)
  }, [tip])

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
  const world = data?.world ?? null
  const answers = (world?.answers ?? []).filter(a => a.answer).slice(0, 3).map(a => answerText(a.answer, i18n.language))
  const compared = !!world && world.countries >= 2
  const timeOf = (s) => new Date(s * 1000).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })

  const theme = challenge.theme?.key ?? null
  // A special day without a cover: its bundled one (Halloween), else Only here's; the API sends uploaded covers.
  const cover = challenge.coverUrl || (theme ? `/covers/${theme === 'special' ? specialCover(challenge.special) : theme}.jpg` : null)
  // Represent your city (SPEC 9.16), city scope only: nobody has represented it today
  // (my own pending proof counts for me), and its run of represented days.
  const presence = scope === 'city' ? data.presence ?? null : null
  const cityShort = city?.name ? shortCityName(city.name) : null
  const emptyCity = !!presence && !presence.represented && !!cityShort && challenge.isActive
  const cityStreak = presence && cityShort && presence.streak >= 2 ? presence.streak : 0
  // "Only in Saigon" in city scope, "Only here" in World; a special day's own name.
  const themeLabel = theme ? themeName(theme, { special: challenge.special, city: scope === 'city' ? city?.name : null }) : ''

  return (
    <div className="today-ticket dc-clickable" role="button" tabIndex={0} onClick={() => { hideTip(); open() }} onKeyDown={(e) => { if (e.key === 'Enter') open() }}
         aria-label={`${DAILY_CHALLENGE}${theme ? `, ${themeLabel}` : ''}: ${challenge.text}`}>
      {/* Image band (SPEC 9.3): the challenge's cover, else its theme's; decorative. */}
      <div className="today-cover">
        {cover && <img src={cover} alt="" />}
        <div className="today-cover-row">
          <span className="today-cover-label">
            <span className="today-cover-kicker">{DAILY_CHALLENGE}</span>
            {theme && <span className="today-cover-theme"><Icon name={themeIcon(theme, challenge.special)} size={22} />{themeLabel}</span>}
          </span>
          {secondsLeft !== null && (
            <span className="today-cover-time" style={ROW}><Icon name="time-outline" size={14} />{t('timeLeft', { time: formatCountdown(secondsLeft) })}</span>
          )}
        </div>
      </div>
      <div className="today-top">
        <p className="today-text">{showOriginal && challenge.original ? challenge.original.text : challenge.text}</p>
        {/* The comparison question and the world's answers, one block (SPEC 10.2, 10.6): from 2
            countries it opens the Compare tab, before the sheet's World tab. */}
        {challenge.compare && (
          <div className="today-world-wrap">
            <button type="button" className="today-world" onClick={(e) => {
              e.stopPropagation()
              hideTip()
              if (compared) track('world_teaser_tapped', { countries: world.countries, cities: world.cities, platform_surface: 'web' })
              openDaily('challenge', compared ? { date: 'today', source: 'teaser', tab: 'compare' } : { date: 'today', source: 'today_block', tab: 'world' })
            }}>
              <span className="today-world-kicker"><Icon name="earth-outline" size={14} />{t('compare.worldAnswers')}</span>
              <span className="today-world-question">{showOriginal && challenge.compare.original ? challenge.compare.original : challenge.compare.question}</span>
              <span className="today-world-line">
                {compared && (
                  <span className="today-teaser-flags" aria-hidden="true">
                    {[...new Set(world.flags ?? world.answers.map(a => a.city.country))].filter(Boolean).slice(0, 5).map(c => <CityFlag key={c} country={c} size={20} />)}
                  </span>
                )}
                <span className="today-world-answers">{compared ? [t('compare.nCountries', { count: world.countries }), ...answers].join(' · ') : t('compare.firstIn')}</span>
                <span className="today-world-see">{t('compare.seeAnswers')}<Icon name="chevron-forward" size={16} /></span>
              </span>
            </button>
            {/* Once per browser: what the block does. Any tap or 6 seconds closes it. */}
            {tip && <button type="button" className="today-world-tip" onClick={(e) => { e.stopPropagation(); hideTip() }}>{t('compare.tip')}</button>}
          </div>
        )}
        <OriginalToggle translated={!!challenge.original || !!twist?.originalText || !!challenge.compare?.original} showingOriginal={showOriginal} onClick={toggleOriginal} />
        {challenge.proposedBy && <ProposedBy credit={challenge.proposedBy} />}
        {earlyUntil && <span className="today-early">{t('today.early', { time: timeOf(earlyUntil) })}</span>}
      </div>
      <div className="today-perforation" aria-hidden="true" />
      <div className="today-bottom">
        {twist && (
          <div className="today-twist">
            <span className="today-twist-label"><CityFlag country={city?.country} />{t('twistIn', { city: shortCityName(city?.name ?? '') })}</span>
            <span className="today-twist-text">{showOriginal && twist.originalText ? twist.originalText : twist.text}</span>
          </div>
        )}
        {emptyCity && (
          <span className="today-empty-city"><CityFlag country={city?.country} size={18} />{tc('represent.empty', { city: cityShort })}</span>
        )}
        {!myProof && (
          <span className="today-hint">
            <span className="today-hint-icon"><Icon name="camera-outline" size={20} /></span>
            <span className="today-hint-body">
              <span className="today-hint-title">{t('proofHint.title')}</span>
              <span>{isPlaceTheme(theme) ? t('proofHint.place') : t('proofHint.noPlace')}</span>
            </span>
          </span>
        )}
        {myProof ? (
          <>
            {myProof.status !== 'approved' && <StatusChip status={myProof.status} />}
            {/* Posted: no pulse; the button opens my proof. */}
            <button type="button" className="today-cta today-cta--taken"
                    onClick={(e) => { e.stopPropagation(); openDaily('challenge', { date: 'today', proofId: myProof.id }) }}>
              <Icon name="checkmark-circle-outline" size={20} />{t('ctaTaken')}
            </button>
          </>
        ) : (
          // The card's only orange element, pulsing (CSS; paused off screen and
          // in a hidden tab; none with reduced motion). The web opens the store.
          <span ref={setPulseEl} className={`today-cta-pulse${isFinalHours(secondsLeft) ? ' today-cta-pulse--fast' : ''}${pulseOn ? '' : ' today-cta-pulse--paused'}`}>
            <a className="today-cta" href={store === 'android' ? PLAY_STORE : APP_STORE} target="_blank" rel="noopener noreferrer"
               onClick={(e) => { e.stopPropagation(); navigator.vibrate?.(8); track('web_today_take_clicked', { store: store ?? 'ios', surface: 'today' }) }}>
              <Icon name="camera-outline" size={20} />{cityShort ? t('ctaAnswer', { city: cityShort }) : t('ctaAnswerNoCity')}
            </a>
          </span>
        )}
        {cityStreak > 0 && (
          <span className="today-city-streak" style={ROW}><Icon name="flame-outline" size={16} />{tc('represent.streak', { count: cityStreak, city: cityShort })}</span>
        )}
        {challenge.isActive && <ChallengeFriend challenge={challenge} representCity={emptyCity ? cityShort : null} />}
      </div>
    </div>
  )
}

/** The week strip: the streak (→ calendar), tomorrow's theme, Monday to Sunday, "Propose a challenge". */
function Week({ today }) {
  const { t, i18n } = useDc()
  const { account, openDaily, needAccount } = useDaily()
  const [cal, setCal] = useState(null)
  const [peek, setPeek] = useState(false)
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
  const tomorrowSpecial = today?.tomorrow?.special ?? byDate.get(addDays(current, 1))?.special ?? null

  const stateOf = (date, d) => {
    if (date === current) return 'today'
    if (date === addDays(current, 1)) return 'tomorrow'
    if (date > current) return 'later'
    if (!account) return 'none'
    if (d?.myStatus === 'approved') return 'done'
    if (d?.myStatus === 'pending') return 'pending'
    return d?.published && cal?.streak ? 'missed' : 'none'
  }
  // A past day opens its sheet (read-only once closed); tomorrow only shows its theme.
  const openDay = (date, state) => {
    if (state === 'tomorrow') { setPeek(p => !p); return }
    if (state === 'later' || (date < current && !byDate.get(date)?.published)) return
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
        {tomorrowTheme && <span className="week-tomorrow">{t('today.tomorrow', { theme: themeName(tomorrowTheme.key, { special: tomorrowSpecial }) })}</span>}
      </div>
      <div className="week-row">
        {week.map(date => {
          const d = byDate.get(date)
          const state = stateOf(date, d)
          const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString(i18n.language, { weekday: 'short', timeZone: 'UTC' })
          const theme = d?.theme?.key ?? (date === current ? today?.challenge?.theme?.key : null)
          const special = d?.special ?? (date === current ? today?.challenge?.special : null)
          return (
            <button key={date} type="button" className="week-day" onClick={() => openDay(date, state)}
                    disabled={state === 'later'} aria-expanded={state === 'tomorrow' ? peek : undefined}
                    aria-label={`${weekday}: ${t(`today.day.${state}`)}`}>
              <span className={`week-weekday${state === 'today' ? ' week-weekday--today' : ''}`}>{weekday}</span>
              <span className={`week-dot week-dot--${state}`}>
                {state === 'done' ? <Icon name="checkmark" size={18} />
                  : state === 'pending' ? <Icon name="hourglass-outline" size={17} />
                  : state === 'missed' ? <Icon name="close" size={17} />
                  : theme ? <Icon name={themeIcon(theme, special)} size={17} /> : null}
              </span>
            </button>
          )
        })}
      </div>
      {peek && tomorrowTheme && (
        <p className="week-peek" style={ROW} role="status">
          <Icon name={themeIcon(tomorrowTheme.key, tomorrowSpecial)} size={16} />{t('today.tomorrow', { theme: themeName(tomorrowTheme.key, { special: tomorrowSpecial }) })}
        </p>
      )}
      {/* Secondary links (SPEC 9.3): list rows in one card, no orange (it stays the Daily Challenge button's). */}
      <div className="link-rows">
        <LinkRow icon="calendar-outline" title={t('today.allPast')} sub={t('today.links.pastSub')} onClick={() => openDaily('archive')} />
        <LinkRow icon="bulb-outline" title={t('propose.cta')} sub={t('today.links.proposeSub')} onClick={propose} />
        {/* Locals of a live city only: tomorrow's Local Twist, until its deadline in their local time. */}
        {today?.twistProposal && (today.twistProposal.open || today.twistProposal.status) && (
          <LinkRow icon="leaf-outline" title={t('today.links.twistTitle')}
                   sub={today.twistProposal.status
                     ? t('twist.heroStatus', { status: t(`twist.status.${today.twistProposal.status}`) })
                     : t('today.links.twistSub', { time: new Date(today.twistProposal.closesAt * 1000).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) })}
                   onClick={() => {
                     track('daily_proposal_started', { entry: 'twist_week', type: 'twist', platform_surface: 'web' })
                     openDaily('twist')
                   }} />
        )}
      </div>
    </div>
  )
}

/** A Today link row: a ground-colour circle with the icon in ink, a bold title, a muted line, a chevron. */
function LinkRow({ icon, title, sub, onClick }) {
  return (
    <button type="button" className="link-row" onClick={onClick}>
      <span className="link-row-icon"><Icon name={icon} size={19} /></span>
      <span className="link-row-body">
        <span className="link-row-title">{title}</span>
        <span className="link-row-sub">{sub}</span>
      </span>
      <Icon name="chevron-forward" size={18} className="link-row-chevron" />
    </button>
  )
}

/** Votes per user and day (DailyVotes::MAX). */
const DAILY_VOTES = 3

/**
 * Today's proofs (SPEC 9.3) and Today around the world (V4 votes). City
 * scope: "Today in Saigon", then, once 2 countries answered, "Today around
 * the world": one card per city with its most voted answer, the cities with
 * the most answers first. World scope: "Today around the world" is the main
 * strip (all of World's proofs before 2 countries). Under each title, while
 * voting is open: "Who gets your 3 votes today?" with my votes left; each
 * card has its vote button; under the strips, what the votes do.
 */
function TodayProofs({ today }) {
  const { t, i18n } = useDc()
  const { t: tc } = useTranslation('common')
  const { scope, openDaily } = useDaily()
  const [strip, setStrip] = useState(null)
  const [cities, setCities] = useState(null)
  const date = today?.challenge?.date ?? null
  const cityNum = scope === 'city' ? today?.city?.id ?? null : null

  useEffect(() => {
    if (!date) { setStrip(null); setCities(null); return }
    let alive = true
    Promise.all([
      fetchDailyTodayProofs({ scope: cityNum ? 'city' : 'world', cityId: cityNum, locale: i18n.language }),
      fetchDailyTodayProofs({ scope: 'cities', locale: i18n.language }),
    ]).then(([s, c]) => {
      if (!alive) return
      setStrip(s); setCities(c); seedProofs([...s.proofs, ...c.proofs], true)
    }).catch(() => { /* keep what we have */ })
    return () => { alive = false }
  }, [date, cityNum, i18n.language])

  // My own proof in review leads the strip, with its badge (only mine: others' never show before approval).
  const mine = today?.myProof?.status === 'pending'
    && (strip?.scope === 'world' || today.myProof.city?.id === strip?.city?.id) ? today.myProof : null
  const items = [...(mine && !strip?.proofs.some(p => p.id === mine.id) ? [{ ...mine, rank: null }] : []), ...(strip?.proofs ?? [])]
  const around = cities && cities.countries >= 2 && cities.proofs.length > 0 ? cities : null
  const cityStrip = strip?.scope === 'city' && items.length > 0 ? strip : null
  // World's strip only while fewer than 2 countries answered (else Today around the world).
  const worldStrip = !cityStrip && !around && strip && items.length > 0 ? strip : null
  if (!cityStrip && !around && !worldStrip) return null

  const voting = !!today?.challenge?.isActive
  // Represent your city (SPEC 9.16), World scope: never a zero count; my own pending proof counts for me.
  const presence = scope === 'world' ? today?.presence ?? null : null
  const myCity = today?.city?.name ? shortCityName(today.city.name) : null
  const board = !!presence && !presence.represented && presence.citiesToday > 0 && !!myCity && voting ? (
    <div className="today-board">
      <span>{tc('represent.board', { count: presence.citiesToday, city: myCity })}</span>
      <ChallengeFriend challenge={today.challenge} representCity={myCity} source="world_strip" />
    </div>
  ) : null
  const aroundData = around ?? worldStrip
  return (
    <>
      {cityStrip && (
        <Strip title={t('today.inCity', { city: shortCityName(cityStrip.city?.name ?? '') })} stats={t('today.proofs', { count: cityStrip.total })}
               onOpen={() => openDaily('challenge', { date: 'today', source: 'today_strip', tab: 'city' })}
               items={items} voting={voting} source="strip_city" footer={!around && voting} />
      )}
      {aroundData && (
        <Strip title={t('today.aroundWorld')}
               stats={t('today.proofsIn', { proofs: t('today.proofs', { count: aroundData.total }), countries: t('today.countries', { count: aroundData.countries }) })}
               onOpen={() => openDaily('challenge', around ? { date: 'today', source: 'world_strip', tab: 'compare' } : { date: 'today', source: 'today_strip', tab: 'world' })}
               items={around ? around.proofs : items} voting={voting} source="strip_world" footer={voting} board={board} />
      )}
    </>
  )
}

/** One strip: title and "See all" (the sheet), the vote prompt while voting is open, the cards, what the votes do. */
function Strip({ title, stats, onOpen, items, voting, source, footer, board = null }) {
  const { t } = useDc()
  const { account, openDaily } = useDaily()
  const left = useVotesLeft()
  const votesLeft = account ? left : DAILY_VOTES
  const prompted = useRef(false)
  useEffect(() => {
    if (!voting || prompted.current) return
    prompted.current = true
    track('vote_prompt_shown', { source, votes_left: votesLeft ?? null, guest: !account, platform_surface: 'web' })
  }, [voting]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="today-card">
      <div className="today-card-head">
        {/* The title and "See all" open the challenge sheet on the strip's tab. */}
        <button type="button" className="today-card-title today-card-title--link" onClick={onOpen}>
          {title}<Icon name="chevron-forward" size={16} />
        </button>
        <button type="button" className="dc-link" onClick={onOpen}>{t('today.seeAll')}</button>
      </div>
      <span className="dc-muted today-proofs-stats">{stats}</span>
      {voting && votesLeft !== null && (votesLeft > 0 ? (
        <div className="vote-prompt">
          <span className="vote-prompt-text">{t('vote.prompt', { count: DAILY_VOTES })}</span>
          <span className="vote-prompt-chip">{t('vote.left', { count: votesLeft })}</span>
        </div>
      ) : <span className="vote-prompt-done">{t('vote.allIn')}</span>)}
      {board}
      <div className="proof-strip">
        {items.map(p => (
          <StripProof key={p.id} proof={p} source={source} onOpen={() => openDaily('challenge', { date: 'today', proofId: p.id })} />
        ))}
      </div>
      {footer && <p className="dc-muted vote-tour-note">{t('vote.tourNote')}</p>}
    </div>
  )
}

function StripProof({ proof, source, onOpen }) {
  const { t, i18n } = useDc()
  const voteCount = useVoteCount(proof)
  const city = proof.city ? localizeCityName(proof.city.name ?? '') : ''
  const votes = t('today.votes', { count: voteCount })
  return (
    <div className="proof-strip-item">
    <button type="button" className="proof-strip-open" onClick={onOpen}
            aria-label={[proof.rank ? `#${proof.rank}` : null, city, votes].filter(Boolean).join(', ')}>
      <span className="proof-strip-photo">
        <img src={proof.thumbUrl || proof.photoUrl} onError={thumbFallback(proof.photoUrl)} alt="" loading="lazy" />
        {proof.rank && <span className="proof-strip-rank"><RankMedal rank={proof.rank} size={24} /></span>}
        {proof.status === 'pending' && <span className="proof-strip-pending"><StatusChip status="pending" /></span>}
      </span>
      {/* The city, then the answer to the day's question on its own line (SPEC 10.2). */}
      {proof.city?.name && <CityName name={proof.city.name} country={proof.city.country} short className="proof-strip-city" />}
      {proof.answer && <span className="proof-strip-answer">{answerText(proof.answer, i18n.language)}</span>}
    </button>
    {proof.status === 'approved' && <VoteButton proof={proof} variant="strip" source={source} />}
    </div>
  )
}

/**
 * Yesterday's podium (SPEC 9.3): yesterday's top 3 proofs of the scope with
 * gold, silver and bronze seals, author, city and votes, and "N proofs in M
 * countries". A photo opens it in yesterday's sheet; "See all" opens the sheet.
 * A city with no proof yesterday shows World's; hidden when there were none.
 */
/**
 * Yesterday around the world (SPEC 10.7): "[N] cities, same challenge" and
 * one story circle per city, opening the tour at that city. Fewer than 2
 * cities (or no tour): yesterday's podium stays.
 */
function TourRow({ today }) {
  const { t, i18n } = useDc()
  const [tour, setTour] = useState(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(null)
  const cityId = today?.city?.id ?? null
  const loaded = !!today

  useEffect(() => {
    if (!loaded) return
    let alive = true
    fetchDailyTour(cityId, i18n.language)
      .then(r => { if (alive) { setTour(r); setFailed(false) } })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [loaded, cityId, i18n.language])

  if (!tour && !failed) return null
  if (!tour || tour.slides.length < 2) return <Podium today={today} />
  return (
    <div className="today-card">
      <div className="today-card-head">
        <span className="today-card-title">{t('tour.title')}</span>
        <button type="button" className="dc-link" onClick={() => setOpen(0)}>{t('tour.watch')}</button>
      </div>
      <span className="dc-muted today-proofs-stats">{t('tour.sub', { count: tour.slides.length })}</span>
      <div className="tour-circles">
        {tour.slides.map((s, i) => (
          <button key={s.city.id} type="button" className="tour-circle" onClick={() => setOpen(i)}
                  aria-label={t('tour.openCity', { city: shortCityName(s.city.name) })}>
            <span className="tour-circle-ring">
              <img src={s.proof.thumbUrl || s.proof.photoUrl} onError={thumbFallback(s.proof.photoUrl)} alt="" loading="lazy" />
              <span className="tour-circle-flag"><CityFlag country={s.city.country} size={20} /></span>
            </span>
            <span className="tour-circle-name">{shortCityName(s.city.name)}</span>
          </button>
        ))}
      </div>
      {open !== null && <WorldTourViewer tour={tour} start={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function Podium({ today }) {
  const { t, i18n } = useDc()
  const { scope, openDaily } = useDaily()
  const [podium, setPodium] = useState(null)
  const cityNum = scope === 'city' ? today?.city?.id ?? null : null
  const loaded = !!today

  useEffect(() => {
    if (!loaded) return
    let alive = true
    fetchDailyPodium({ scope: cityNum ? 'city' : 'world', cityId: cityNum, locale: i18n.language })
      .then(p => { if (alive) { setPodium(p); seedProofs(p.proofs, false) } })
      .catch(() => { /* keep what we have */ })
    return () => { alive = false }
  }, [loaded, cityNum, i18n.language])

  if (!podium || podium.proofs.length === 0) return null
  const proofs = t('today.proofs', { count: podium.total })
  return (
    <div className="today-card">
      <div className="today-card-head">
        <span className="today-card-title">{t('today.podiumTitle')}</span>
        <button type="button" className="dc-link" onClick={() => openDaily('challenge', { date: podium.date, source: 'today' })}>{t('today.seeAll')}</button>
      </div>
      <span className="dc-muted today-proofs-stats">
        {podium.scope === 'world' ? t('today.proofsIn', { proofs, countries: t('today.countries', { count: podium.countries }) }) : proofs}
      </span>
      <div className="podium-row">
        {podium.proofs.map(p => (
          <button key={p.id} type="button" className="podium-item" onClick={() => openDaily('challenge', { date: podium.date, proofId: p.id })}
                  aria-label={[`#${p.rank}`, p.user.username ?? p.user.displayName, p.city ? localizeCityName(p.city.name) : null, t('today.votes', { count: p.voteCount })].filter(Boolean).join(', ')}>
            <span className="proof-strip-photo podium-photo">
              <img src={p.thumbUrl || p.photoUrl} onError={thumbFallback(p.photoUrl)} alt="" loading="lazy" />
              <span className="proof-strip-rank"><RankMedal rank={p.rank} size={24} podium /></span>
            </span>
            <span className="podium-name">{p.user.displayName || p.user.username}</span>
            {p.city?.name && <CityName name={p.city.name} country={p.city.country} short className="podium-city" />}
            <span className="dc-muted proof-strip-votes">{t('today.votes', { count: p.voteCount })}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Spots near you: the nearest 2-3 spots (position only if already allowed, else
 * the city centre). In a city I'm not in: "Spots in <city>", around its centre.
 */
function SpotsNear() {
  const { t, i18n } = useDc()
  const { cityId, scope, openSpot } = useDaily()
  const [spots, setSpots] = useState(null)
  const [fallback, setFallback] = useState(false)
  // Centred on the chosen city when I'm not in it: "Spots in <city>".
  const [away, setAway] = useState(null)

  useEffect(() => {
    let alive = true
    const load = (pos) => {
      if (!pos && !cityId) { setSpots([]); return }
      fetchSpotsNear({ ...(pos ?? {}), cityId: pos ? (scope === 'city' ? cityId : null) : cityId })
        .then(r => { if (alive) { setSpots(r.items); setFallback(r.fallback); setAway(scope === 'city' && r.center === 'city' ? r.city : null) } })
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
        <span className="today-card-title">{away ? <span style={ROW}><CityFlag country={away.country} />{t('today.spotsIn', { city: shortCityName(away.name) })}</span> : t('today.spotsTitle')}</span>
        <button type="button" className="dc-link" onClick={() => openSpot(null)}>{t('today.openMap')}</button>
      </div>
      {fallback && spots.length > 0 && <p className="dc-muted">{t('today.spotsFallback')}</p>}
      {spots.length === 0 ? (
        <button type="button" className="spots-empty" onClick={() => openSpot(null)}><Icon name="location-outline" size={18} style={{ color: 'var(--primary-text)' }} />{t('today.spotsEmpty')}</button>
      ) : (
        <div className="spots-row">
          {spots.map(s => (
            <button key={s.id} type="button" className="spot-card" onClick={() => openSpot(s.id)} aria-label={s.name}>
              <span className="spot-card-photo">
                {s.cover?.thumbUrl || s.cover?.photoUrl ? <img src={s.cover.thumbUrl || s.cover.photoUrl} onError={thumbFallback(s.cover.photoUrl)} alt="" loading="lazy" /> : <span className="spot-card-img" />}
                {s.cover?.by && <span className="photo-credit">{i18n.t('photoBy', { ns: 'common', username: s.cover.by })}</span>}
              </span>
              <span className="spot-card-body">
                <span className="spot-card-name">{s.name}</span>
                <span className="dc-muted" style={ROW}>
                  {s.distanceM !== undefined && <><Icon name="location-outline" size={13} />{distance(s.distanceM, i18n.language)}</>}
                  {s.themes?.[0] ? <Icon name={themeIcon(s.themes[0])} size={13} /> : null}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
