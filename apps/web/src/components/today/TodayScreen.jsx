import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchDailyBoard, fetchDailyCalendar, fetchDailySheet, fetchDailyToday, fetchSpotsNear } from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'
import { shareLink } from '../../lib/shareLink'
import { deviceStore, themeName } from '../map/spotsShared'
import { openAppModal } from '../AppModal'
import { themeIcon } from '../../lib/icons'
import Icon from '../Icon'
import { IndexCarousel } from '../daily/Comparisons'
import TodayCountries, { YesterdayRecap, todayCities, useTodayCountries } from './TodayCountries'
import {
  challengeCover, useDaily, useDc, useCountdown, formatCountdown, isFinalHours, seedProofs, seedVotesLeft, StatusChip, setLastHere, setLastToday, useOriginal,
} from '../daily/dailyShared'
import { ymd } from '../daily/CalendarScreen'
import { coverImage } from '../../lib/imageThumb'
import { thumbFallback } from '../../lib/thumbFallback'
import { FlagSticker, Wordmark, themeColor } from '../joy/Joy'
import { SeasonalDayIcon, SeasonalHeroDecor, SeasonalTeaser, isEventDay, setSeasonalEvent, useSeasonal, useSeasonalAttr, useSeasonalLive } from '../event/seasonal'

const ROW = { display: 'inline-flex', alignItems: 'center', gap: 6 }
/** Brand term: English in every locale. */
const DAILY_CHALLENGE = 'Daily Challenge'
// The button on the hero's photo (SPEC 9.3): 'white', or the "sun orange" option ('sun').
const HERO_CTA_TONE = 'white'

const addDays = (date, n) => ymd(new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000))

/**
 * TODAY, the web home (W2, the app's Today tab, SPEC 9.3, V3 polish): the
 * Daily Challenge hero, the seasonal banner, today's photos by city, your week
 * (streak, tomorrow), yesterday with every past challenge, the Index, a slim
 * row to the spots near you and "Got a challenge idea? Propose it". Proofs are
 * posted from the app: "Take the challenge" opens the store.
 */
export default function TodayScreen({ header }) {
  const { i18n } = useDc()
  // A seasonal event's live look (Halloween...) re-colors the whole tab.
  const seasonalAttr = useSeasonalAttr()
  const { cityId, here, hereVersion } = useDaily()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const hereKey = here ? `${here.cityId}:${here.gps}` : ''

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchDailyToday(cityId, i18n.language, here)
      .then(d => {
        if (!alive) return
        setData(d)
        setLastHere(d.here)
        setLastToday(d)
        setSeasonalEvent(d.event)
        // The sheet's photos and the Compare board, so the hero's tap opens them ready.
        if (d.challenge) {
          fetchDailySheet(d.challenge.date, { scope: 'world', cityId, locale: i18n.language }).catch(() => {})
          if (d.challenge.compare) fetchDailyBoard(d.challenge.date, i18n.language).catch(() => {})
        }
        if (d.challenge?.isActive) { seedProofs([d.myProof], true); seedVotesLeft(d.myVotes?.left ?? null) }
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [cityId, i18n.language, hereKey, hereVersion]) // eslint-disable-line react-hooks/exhaustive-deps
  // Today's cities, one list for the hero's live strip and the compare section.
  const countries = useTodayCountries(data)

  return (
    <div className="full-page full-page--tab today-page" {...seasonalAttr}>
      {/* The header, fixed: the logo row, then the brand line (stays visible while scrolling). */}
      <div className="tab-app-header">{header}<BrandLine /></div>
      <div className="page-body today-body">
        <Ticket data={data} countries={countries} loading={loading} />
        {/* A seasonal event's countdown (teaser days). */}
        <SeasonalTeaser />
        {/* Today's photos by country: the stories row and the mosaic (players' photos only). */}
        <TodayCountries today={data} data={countries} />
        {/* Your week: the streak, tomorrow's theme and the week strip. */}
        <Week today={data} />
        {/* Yesterday's recap (the winning photo, the question, how many cities played) and every past challenge. */}
        <YesterdayRecap today={data} />
        {/* The world, compared (SPEC 10.9): last week's comparisons, every day. */}
        <IndexCarousel />
        <SpotsNear />
        <ProposeLink />
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
/**
 * Today's brand line (SPEC 9.3 / 9.9, DESIGN.md): the official "hilads"
 * wordmark (the mark is the header's logo just above), then the tagline in
 * muted Medium, in the header under the logo row, so it stays on screen while
 * the content scrolls. For everyone. One line (the tagline cut with an ellipsis).
 */
function BrandLine() {
  const { t } = useTranslation('common')
  return (
    <p className="brand-line brand-line--joy" aria-label={`Hilads. ${t('firstLaunch')}`}>
      <Wordmark height={16} mark={false} /><span className="brand-line-tag">{t('firstLaunch')}</span>
    </p>
  )
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
 * Today's Daily Challenge, the hero (SPEC 9.3, V3 polish, the app's
 * TodayTicket): the cover photo with the theme chip and the time left; the
 * short headline and, under it, the full ask; for a player who never played,
 * the three steps (Snap it, Name it, Compare); the live strip of the cities
 * that played today (the same list as the compare section under it: GET
 * /daily/today/countries), which opens the compare view; "Snap it for [city]"
 * (the web opens the app modal: photos are posted from the app), then "You
 * played · See the world" once my photo is in. Tapping the photo opens the challenge.
 */
function Ticket({ data, countries, loading }) {
  const { t } = useDc()
  const seasonal = useSeasonalLive()
  const { scope, openDaily } = useDaily()
  const [showOriginal] = useOriginal()
  const secondsLeft = useCountdown(data?.challenge ? data.nextDropAt : null)
  const [pulseEl, setPulseEl] = useState(null)
  const tracked = useRef(null)
  const challenge = data?.challenge ?? null
  const pulseOn = usePulseVisible(pulseEl)
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
  const store = deviceStore()
  const open = () => openDaily('challenge', { date: 'today', source: 'today' })
  const theme = challenge.theme?.key ?? null
  // A special day without a cover: its bundled one (Halloween), else Only here's; the API sends uploaded covers.
  const cover = challengeCover(challenge)
  // Where I am (never the browsed city): the button's city.
  const here = data.here ?? null
  const cityShort = here?.name ? shortCityName(here.name) : null
  // Today's cities, the same list as the compare section: is mine in?
  const cities = todayCities(countries)
  const mineIn = !!myProof || (!!here && cities.some(c => String(c.city.id) === String(here.id)))
  // The compare view: every city's photos, side by side (the same as the compare section's "See all").
  const openCompare = (source) => {
    track('world_teaser_tapped', { cities: cities.length, source, platform_surface: 'web' })
    openDaily('countries', { source })
  }
  // "Only in Saigon" in city scope, "Only here" in World; a special day's own name.
  const themeLabel = theme ? themeName(theme, { special: challenge.special, city: scope === 'city' ? city?.name : null }) : ''
  // The theme's own color (DESIGN.md): the chip's fill and its text color.
  const hue = themeColor(challenge.special ? 'special' : theme)

  // The hero's photo: a cover, never a player's photo (those are in the mosaic right under it):
  // the challenge's own, else its special day's, else its theme's (uploaded default, else bundled).
  const photo = cover
  const original = showOriginal && challenge.original ? challenge.original.text : null
  const headline = original ?? (challenge.headline || challenge.text)
  // The full ask under a short headline ("...and share its local name"): the subtitle, else the text.
  const ask = original ? null : challenge.subtitle || (challenge.headline && challenge.headline !== challenge.text ? challenge.text : null)
  // A seasonal event's live day (Halloween: "Haunt Lisbon 👻") replaces the label.
  const ctaLabel = seasonal ? (cityShort ? t(seasonal.theme.copy.cta, { city: cityShort }) : t(seasonal.theme.copy.ctaNoCity))
    : cityShort ? t('hero.cta', { city: cityShort }) : t('hero.ctaNoCity')
  // Never played (no photo today, no streak; the web posts none): the three steps under the ask.
  const showSteps = !myProof && !data.streak && challenge.isActive

  return (
    <div className="today-hero dc-clickable" role="button" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open() }}
         aria-label={`${DAILY_CHALLENGE}${theme ? `, ${themeLabel}` : ''}: ${challenge.text}`}>
      {photo && <img className="today-hero-photo" {...coverImage(photo)} onError={thumbFallback(photo)} alt="" fetchPriority="high" decoding="async" />}
      <SeasonalHeroDecor />
      <div className="today-hero-top">
        {/* The theme alone, with its icon (never cut): "Daily Challenge" is the screen's own name. */}
        <span className="today-hero-chip today-hero-chip--theme" style={{ '--c': hue.fill, '--on': hue.onFill }}>
          {theme && <Icon name={themeIcon(theme, challenge.special)} size={15} />}{themeLabel || DAILY_CHALLENGE}
        </span>
        <span className="today-hero-topright">
          {secondsLeft !== null && <span className="today-hero-chip"><Icon name="time-outline" size={14} />{t('timeLeft', { time: formatCountdown(secondsLeft) })}</span>}
        </span>
      </div>
      <div className="today-hero-bottom">
        <div className="today-hero-titles">
          <p className="today-hero-headline">{headline}</p>
          {!!ask && <p className="today-hero-ask">{ask}</p>}
        </div>
        {showSteps && <Steps compareType={challenge.compare?.type ?? null} price={!!challenge.compare?.priceLabel} />}
        <LiveStrip cities={cities} mineIn={mineIn} city={cityShort} active={challenge.isActive}
                   onClick={(e) => { e.stopPropagation(); openCompare('hero_strip') }} />
        {myProof ? (
          <>
            {myProof.status !== 'approved' && <StatusChip status={myProof.status} />}
            {/* Played: no pulse; the button opens the world's photos. */}
            <button type="button" className="today-cta today-cta--taken"
                    onClick={(e) => { e.stopPropagation(); openCompare('hero_played') }}>
              <Icon name="checkmark-circle-outline" size={20} />{t('hero.played')}
            </button>
          </>
        ) : challenge.isActive ? (
          // White on the photo, pulsing (paused off screen, in a hidden tab, with reduced motion). The web opens the app modal.
          <span ref={setPulseEl} className={`today-cta-pulse${HERO_CTA_TONE === 'sun' ? ' today-cta-pulse--sun' : ''}${isFinalHours(secondsLeft) ? ' today-cta-pulse--fast' : ''}${pulseOn ? '' : ' today-cta-pulse--paused'}`}>
            <button type="button" className="today-cta"
               onClick={(e) => { e.stopPropagation(); navigator.vibrate?.(8); track('web_today_take_clicked', { store: store ?? 'ios', surface: 'today' })
                 openAppModal({ action: 'play', city: cityShort, cityId: here?.id ?? null, surface: 'today_hero' }) }}>
              <Icon name="camera-outline" size={20} />{ctaLabel}
            </button>
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * How it works in three steps, for a player who never played: Snap it, then
 * the challenge's own action (Name it for a word, Count it, Time it, Price
 * it; Tell it without a question), then Compare. On the photo, so white.
 */
function Steps({ compareType, price }) {
  const { t } = useDc()
  const second = price ? ['pricetag-outline', 'hero.steps.price']
    : compareType === 'number' ? ['stats-chart-outline', 'hero.steps.count']
    : compareType === 'time' ? ['time-outline', 'hero.steps.time']
    : compareType ? ['create-outline', 'hero.steps.name']
    : ['chatbubble-ellipses-outline', 'hero.steps.tell']
  const steps = [['camera-outline', 'hero.steps.snap'], second, ['earth-outline', 'hero.steps.compare']]
  return (
    <p className="today-steps">
      {steps.map(([icon, key], i) => (
        <span key={key} className="today-step-wrap">
          {i > 0 && <Icon name="chevron-forward" size={13} className="today-step-arrow" />}
          <span className="today-step"><Icon name={icon} size={14} />{t(key)}</span>
        </span>
      ))}
    </p>
  )
}

/**
 * The live strip: the flags of the cities that played today (mine first) and
 * where my city stands ("2 cities in. Saigon isn't yet!", "3 cities in ·
 * Compare", "Be the first city in the world today"). Opens the compare view.
 */
function LiveStrip({ cities, mineIn, city, active, onClick }) {
  const { t } = useDc()
  const n = cities.length
  if (n === 0 && !active) return null
  const text = n === 0 ? t('hero.firstCity')
    : mineIn ? `${t('hero.citiesIn', { count: n })} · ${t('compare.seeAnswers')}`
    : city ? t('hero.citiesMissing', { count: n, city })
    : t('hero.citiesIn', { count: n })
  return (
    <button type="button" className="today-strip" onClick={onClick} aria-label={text}>
      {n > 0 ? (
        <span className="today-strip-flags" aria-hidden="true">
          {cities.slice(0, 4).map(c => <FlagSticker key={c.city.id} country={c.city.country} size={22} />)}
        </span>
      ) : <Icon name="earth-outline" size={18} />}
      <span className="today-strip-text">{text}</span>
      <Icon name="chevron-forward" size={16} />
    </button>
  )
}

/** The streak last shown on Today (this page session): a higher one bumps the flame. */
let shownStreak = null

/**
 * "Your week" (SPEC 9.3, V3 polish 3.1), one card: the streak (→ calendar; it
 * bumps when it grows after a photo) and tomorrow's theme in its own color,
 * then Monday to Sunday; "Play today to keep your streak" when a streak of 2+
 * waits for today's photo. A live city's local still finds tomorrow's Local Twist at the bottom.
 */
function Week({ today }) {
  const { t, i18n } = useDc()
  // A seasonal event (teaser, live, recap): its days show its icon (Halloween: a pumpkin).
  const seasonal = useSeasonal()
  const dayIcon = (date, size, fallback) => (isEventDay(seasonal, date) ? <SeasonalDayIcon themeKey={seasonal.key} size={size} /> : fallback)
  const { account, openDaily, needAccount } = useDaily()
  const [cal, setCal] = useState(null)
  const [peek, setPeek] = useState(false)
  const [bump, setBump] = useState(0)
  const now = ymd(new Date())
  // The week's themes are public (the challenges' themes, else the weekday
  // defaults): loaded for everyone; my statuses and streak only come signed in.
  useEffect(() => {
    fetchDailyCalendar(addDays(now, -8), addDays(now, 8)).then(setCal).catch(() => {})
  }, [account?.id, now]) // eslint-disable-line react-hooks/exhaustive-deps
  const streak = today?.streak ?? cal?.streak?.current ?? null
  // The streak grew since Today last showed it (a photo just went in): bump the flame and the number (CSS, none with reduced motion).
  useEffect(() => {
    if (streak === null) return
    const grew = shownStreak !== null && streak > shownStreak
    shownStreak = streak
    if (!grew) return
    navigator.vibrate?.(12)
    setBump(b => b + 1)
  }, [streak])

  const current = cal?.today ?? today?.challenge?.date ?? null
  if (!current) return null
  const dow = (new Date(`${current}T12:00:00Z`).getUTCDay() + 6) % 7
  const monday = addDays(current, -dow)
  const byDate = new Map((cal?.days ?? []).map(d => [d.date, d]))
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  // Today not played yet and a streak worth keeping: say so under the week.
  const atRisk = !!account && !today?.myProof && !!today?.challenge?.isActive && (streak ?? 0) >= 2
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
  // Tomorrow's theme color: its text tone in light and in dark.
  const tc = tomorrowTheme ? themeColor(tomorrowSpecial ? 'special' : tomorrowTheme.key) : null

  return (
    <div className="week">
      <div className="week-head">
        <button type="button" className="week-streak" onClick={() => (account ? openDaily('calendar') : needAccount('view_profile'))}>
          <span key={bump} className={`week-streak-inner${bump ? ' week-streak-inner--bump' : ''}`}>
            <Icon name={streak ? 'flame' : 'flame-outline'} size={18} className={streak ? 'week-flame' : undefined} />
            {streak ? t('streak', { count: streak }) : t('week.title')}
          </span>
        </button>
        {tomorrowTheme && (
          <span className="week-tomorrow" style={{ '--tl': tc.light, '--td': tc.dark }}>
            {dayIcon(addDays(current, 1), 15, <Icon name={themeIcon(tomorrowTheme.key, tomorrowSpecial)} size={15} />)}
            <span className="week-tomorrow-text">{t('today.tomorrow', { theme: themeName(tomorrowTheme.key, { special: tomorrowSpecial }) })}</span>
          </span>
        )}
      </div>
      <div className="week-row">
        {week.map(date => {
          const d = byDate.get(date)
          const state = stateOf(date, d)
          const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString(i18n.language, { weekday: 'short', timeZone: 'UTC' })
          const theme = d?.theme?.key ?? (date === current ? today?.challenge?.theme?.key : null)
          const special = d?.special ?? (date === current ? today?.challenge?.special : null)
          // The day's theme color: a fill (done), a ring (today, tomorrow), a tint (in review), the icon's color.
          const c = themeColor(special ? 'special' : theme)
          return (
            <button key={date} type="button" className="week-day" onClick={() => openDay(date, state)}
                    disabled={state === 'later'} aria-expanded={state === 'tomorrow' ? peek : undefined}
                    aria-label={`${weekday}: ${t(`today.day.${state}`)}`}>
              <span className={`week-weekday${state === 'today' ? ' week-weekday--today' : ''}`}>{weekday}</span>
              <span className={`week-dot week-dot--${state}`} style={{ '--c': c.fill, '--cl': c.line ?? c.fill, '--on': c.onFill, '--ct': c.light, '--ctd': c.dark }}>
                {state === 'done' ? <Icon name="checkmark" size={18} />
                  : state === 'pending' ? <Icon name="hourglass-outline" size={17} />
                  : state === 'missed' ? <Icon name="close" size={17} />
                  : theme ? dayIcon(date, 17, <Icon name={themeIcon(theme, special)} size={17} />) : null}
              </span>
            </button>
          )
        })}
      </div>
      {peek && tomorrowTheme && (
        <p className="week-peek" style={ROW} role="status">
          {dayIcon(addDays(current, 1), 16, <Icon name={themeIcon(tomorrowTheme.key, tomorrowSpecial)} size={16} />)}{t('today.tomorrow', { theme: themeName(tomorrowTheme.key, { special: tomorrowSpecial }) })}
        </p>
      )}
      {atRisk && <p className="week-keep"><Icon name="flame" size={15} />{t('week.keep')}</p>}
      {/* Locals of a live city only: tomorrow's Local Twist, until its deadline in their local time. */}
      {today?.twistProposal && (today.twistProposal.open || today.twistProposal.status) && (
        <div className="link-rows">
          <LinkRow icon="leaf-outline" accent="#1FB5A8" title={t('today.links.twistTitle')}
                   sub={today.twistProposal.status
                     ? t('twist.heroStatus', { status: t(`twist.status.${today.twistProposal.status}`) })
                     : t('today.links.twistSub', { time: new Date(today.twistProposal.closesAt * 1000).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) })}
                   onClick={() => {
                     track('daily_proposal_started', { entry: 'twist_week', type: 'twist', platform_surface: 'web' })
                     openDaily('twist')
                   }} />
        </div>
      )}
    </div>
  )
}

/** A Today link row: a circle tinted with its accent and the icon in ink, a bold title, a muted line, a chevron. */
function LinkRow({ icon, title, sub, onClick, accent }) {
  return (
    <button type="button" className="link-row" onClick={onClick}>
      <span className="link-row-icon" style={{ '--a': accent }}><Icon name={icon} size={19} /></span>
      <span className="link-row-body">
        <span className="link-row-title">{title}</span>
        <span className="link-row-sub">{sub}</span>
      </span>
      <Icon name="chevron-forward" size={18} className="link-row-chevron" />
    </button>
  )
}

/**
 * Spots near you (SPEC 9.3, V3 polish 3.4): one slim row, "12 spots near you ·
 * Open map" (the Map owns the spots); hidden when there's none around, or only
 * the nearest ones anywhere. Position only if already allowed, else the city
 * centre. In a city I'm not in: "3 spots in <city>", around its centre.
 */
function SpotsNear() {
  const { t } = useDc()
  const { cityId, scope, openSpot } = useDaily()
  const [spots, setSpots] = useState(null)
  const [fallback, setFallback] = useState(false)
  // Centred on the chosen city when I'm not in it: "3 spots in <city>".
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

  if (spots === null || spots.length === 0 || fallback) return null
  const label = away ? t('today.spotsTeaserIn', { count: spots.length, city: shortCityName(away.name) }) : t('today.spotsTeaser', { count: spots.length })
  return (
    <button type="button" className="spots-teaser" onClick={() => openSpot(null)} aria-label={`${label}. ${t('today.openMap')}`}>
      <span className="spots-teaser-pin"><Icon name="location" size={18} /></span>
      <span className="spots-teaser-text">{label}</span>
      <span className="spots-teaser-open">{t('today.openMap')}<Icon name="chevron-forward" size={16} /></span>
    </button>
  )
}

/**
 * The bottom of Today (V3 polish 3.3): a friendly text link, "Got a challenge
 * idea? Propose it" (SPEC 8.6: guests get the sign-up sheet, then the form).
 */
function ProposeLink() {
  const { t } = useDc()
  const { account, openDaily, needAccount } = useDaily()
  return (
    <button type="button" className="today-propose" onClick={() => (account ? openDaily('propose', { source: 'today_link' }) : needAccount('create_challenge'))}>
      <Icon name="bulb-outline" size={16} />
      <span>{t('propose.linkAsk')} <span className="today-propose-cta">{t('propose.linkCta')}</span></span>
    </button>
  )
}
