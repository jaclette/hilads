import { useEffect, useMemo, useRef, useState } from 'react'
import { cachedDailySheet, fetchDailyProof, fetchDailySheet, fetchDailyToday, fetchDailyTodayCountries } from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { CityFlag } from '../CityName'
import { track } from '../../lib/analytics'
import { coverImage } from '../../lib/imageThumb'
import { thumbFallback } from '../../lib/thumbFallback'
import { deviceStore, isPlaceTheme, themeName } from '../map/spotsShared'
import { openAppModal } from '../AppModal'
import { themeIcon } from '../../lib/icons'
import { themeColor } from '../joy/Joy'
import Icon from '../Icon'
import { answerText } from './compareShared'
import { compareCountryGroups, compareCountryProofs } from './countryOrder'
import WorldBubbles from './WorldBubbles'
import {
  useDaily, useDc, useCountdown, formatCountdown, isFinalHours, formatAmount, personName, seedProofs, seedVotesLeft,
  StatusChip, OriginalToggle, useOriginal, ProposedBy, ProofViewer, useHere, getLastToday, SheetSkeleton, challengeCover,
} from './dailyShared'

/**
 * A Daily Challenge on the web (the app's /daily/[date]), made to make people
 * play: an illustrated hero (the challenge's cover, else its theme's; never a
 * player's photo) with back and the timer, the theme, the question large and
 * the instruction (the challenge's subtitle, else its text); "The world says"
 * (a bubble per country, a tap opens that country in "See all"); Good to know
 * (price range, places pinned → the map on the theme); my photo once played;
 * my city (its top photo → "See all"); and a sticky bar: the photo rule, then
 * "Play" (the app: photos are posted there) or "See my photo". The photo
 * grids and Top 10 live in "See all". `proofId` opens that photo on arrival.
 */
export default function ChallengeScreen({ date: dateParam = 'today', ...rest }) {
  const { i18n } = useDc()
  const { cityId } = useDaily()
  // From the hero, today's date is already known (no loader).
  const [date, setDate] = useState(dateParam !== 'today' ? dateParam : getLastToday()?.challenge?.date ?? null)
  useEffect(() => {
    if (date) return
    fetchDailyToday(cityId, i18n.language).then(d => setDate(d.challenge?.date ?? 'none')).catch(() => setDate('none'))
  }, [date, cityId, i18n.language])
  if (!date) {
    return (
      <div className="full-page dc-page">
        <div className="page-body dc-body"><SheetSkeleton /></div>
      </div>
    )
  }
  return <Challenge date={date} {...rest} />
}

function Challenge({ date, proofId = null, source = null, onBack }) {
  const { t, i18n } = useDc()
  const { cityId, account, openProfile, needAccount, openDaily, openMapTheme } = useDaily()
  const here = useHere()   // "Play for [city]", my city block: where I am, not the browsed city
  const [loaded, setSheet] = useState(() => cachedDailySheet(date, { scope: 'world', cityId, locale: i18n.language }))
  // Instant: the sheet Today prefetched, else its top from Today's challenge.
  const sheet = useMemo(() => {
    if (loaded) return loaded
    const today = getLastToday()
    if (!today?.challenge || today.challenge.date !== date) return null
    return { ...today, scope: 'world', proofs: [], hasMore: false, nextBefore: null, practical: { priceRanges: [], places: [] }, results: null }
  }, [loaded, date])
  const [error, setError] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [showOriginal, toggleOriginal] = useOriginal()
  const challenge = sheet?.challenge ?? null
  const myProof = sheet?.myProof ?? null
  const secondsLeft = useCountdown(challenge?.isActive ? challenge.endsAt : null)
  const isToday = date === getLastToday()?.challenge?.date
  // The hero is full bleed: the app promo banner (above screens) steps aside while it's open.
  useEffect(() => {
    document.body.classList.add('dch-open')
    return () => document.body.classList.remove('dch-open')
  }, [])

  const load = async () => {
    try {
      const s = await fetchDailySheet(date, { scope: 'world', cityId, locale: i18n.language })
      const open = !!s.challenge?.isActive
      seedProofs([...s.proofs, s.myProof], open)
      if (open) seedVotesLeft(s.myVotes?.left ?? null)
      setSheet(s); setError(null)
    } catch (err) {
      setError(err.status === 404 ? 'not_found' : 'failed')
    }
  }
  useEffect(() => { load() }, [date, cityId, i18n.language]) // eslint-disable-line react-hooks/exhaustive-deps

  // "The world says" (the same data as Today's mosaic), and my city's top photo and count.
  const myCityId = here?.id ?? sheet?.city?.id ?? null
  const myCityName = here?.name ?? sheet?.city?.name ?? null
  const [countries, setCountries] = useState(null)
  const [mine, setMine] = useState(null)
  useEffect(() => {
    fetchDailyTodayCountries({ date: isToday ? null : date, cityId: myCityId, locale: i18n.language }).then(setCountries).catch(() => {})
  }, [date, isToday, myCityId, i18n.language])
  useEffect(() => {
    if (!myCityId) { setMine(null); return }
    fetchDailySheet(date, { scope: 'city', cityId: myCityId, limit: 50, locale: i18n.language })
      .then(s => setMine({ top: s.proofs.filter(p => !p.suggestion).sort(compareCountryProofs)[0] ?? null, count: s.counts?.city ?? 0 }))
      .catch(() => {})
  }, [date, myCityId, i18n.language])

  const tracked = useRef(false)
  useEffect(() => {
    if (!challenge || tracked.current) return
    tracked.current = true
    track('daily_challenge_viewed', { source: source ?? (proofId ? 'proof_link' : 'sheet'), date: challenge.date, platform_surface: 'web' })
  }, [challenge, proofId, source])

  // proofId: open it once (from the sheet, or fetched).
  const opened = useRef(false)
  useEffect(() => {
    if (!proofId || opened.current || !sheet) return
    opened.current = true
    const known = [...sheet.proofs, sheet.myProof].find(p => p?.id === proofId)
    if (known) { setViewing(known); return }
    fetchDailyProof(proofId, i18n.language).then(p => { seedProofs([p], !!sheet.challenge?.isActive); setViewing(p) }).catch(() => {})
  }, [proofId, sheet]) // eslint-disable-line react-hooks/exhaustive-deps

  const seeAll = (country) => {
    track('challenge_bubble_tapped', { country, platform_surface: 'web' })
    openDaily('countries', { ...(isToday ? {} : { date }), ...(country ? { country } : {}), source: 'challenge' })
  }
  const play = () => {
    track('challenge_cta_tapped', { played: !!myProof, platform_surface: 'web' })
    if (myProof) { setViewing(myProof); return }
    track('web_today_take_clicked', { store: deviceStore() ?? 'ios', surface: 'challenge' })
    openAppModal({ action: 'play', city: here?.name ? shortCityName(here.name) : null, cityId: here?.id ?? null, surface: 'challenge_sheet' })
  }
  const goProfile = (id, name) => { if (!account) { needAccount('view_profile'); return } openProfile(id, name) }

  if (!challenge) {
    return (
      <div className="full-page dc-page">
        <div className="page-body dc-body">
          {!error ? <SheetSkeleton /> : (
            <div className="dc-center">
              <p className="dc-muted">{error === 'failed' ? t('loadFailed') : t('notFound')}</p>
              {error === 'failed' && <button type="button" className="dc-link" onClick={load}>{t('retry')}</button>}
              <button type="button" className="dc-link" onClick={onBack}>{t('back')}</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  const cover = challengeCover(challenge)
  const question = challenge.compare ? (showOriginal && challenge.compare.original ? challenge.compare.original : challenge.compare.question) : null
  const text = showOriginal && challenge.original ? challenge.original.text : challenge.text
  const instruction = question
    ? (showOriginal && challenge.original ? text : challenge.subtitle || text)
    : (showOriginal && challenge.original ? challenge.original.context : challenge.context) ?? ''
  const range = sheet.practical?.priceRanges?.[0]
  const placesCount = sheet.practical?.places?.length ?? 0
  const items = [...(countries?.items ?? [])].sort((a, b) => compareCountryGroups(a, b, here?.country ?? sheet.city?.country ?? null))
  const myCountry = items.find(g => g.city.id === myCityId)?.country ?? here?.country ?? sheet.city?.country ?? null
  const cityShort = myCityName ? shortCityName(myCityName) : null
  const canPlay = challenge.isActive
  const showBar = canPlay || !!myProof
  const hue = themeColor(challenge.special ? 'special' : challenge.theme?.key)
  const isLive = !!sheet.city?.isLive

  return (
    <div className="full-page dch-page">
      <div className="dch-scroll">
        {/* 1. The hero: the cover, the theme, the question and the instruction. */}
        <div className="dch-hero">
          {cover && <img className="dch-hero-photo" {...coverImage(cover)} onError={thumbFallback(cover)} alt="" fetchPriority="high" decoding="async" />}
          <div className="dch-hero-bottom">
            {challenge.theme && (
              <span className="today-hero-chip today-hero-chip--theme" style={{ '--c': hue.fill, '--on': hue.onFill }}>
                <Icon name={themeIcon(challenge.theme.key, challenge.special)} size={15} />{themeName(challenge.theme.key, { special: challenge.special })}
              </span>
            )}
            <h1 className="dch-question">{question ?? text}</h1>
            {instruction && <p className="dch-instruction">{instruction}</p>}
          </div>
        </div>

        <div className="dch-body">
          {(challenge.original || sheet.twist?.originalText || challenge.proposedBy) && (
            <div className="dch-meta">
              <OriginalToggle translated={!!challenge.original || !!sheet.twist?.originalText} showingOriginal={showOriginal} onClick={toggleOriginal} />
              {challenge.proposedBy && <ProposedBy credit={challenge.proposedBy} />}
            </div>
          )}

          {/* 2. The world says. */}
          <section className="dch-block">
            <h2 className="dch-title">{t('worldSays.title')}</h2>
            <WorldBubbles items={items} seed={challenge.date} onOpen={seeAll} onFirst={canPlay && !myProof ? play : undefined} />
          </section>

          {/* The Local Twist of my city (locals of a live city). */}
          {sheet.twist && isLive && (
            <div className="dc-twist">
              <span className="dc-twist-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {sheet.city?.country ? <CityFlag country={sheet.city.country} /> : <Icon name="location-outline" size={14} />}
                {t('twistIn', { city: sheet.city?.name ? shortCityName(sheet.city.name) : '' })}
              </span>
              <span className="dc-twist-text">{showOriginal && sheet.twist.originalText ? sheet.twist.originalText : sheet.twist.text}</span>
              {sheet.twist.author ? (
                <button type="button" className="dc-author" onClick={() => goProfile(sheet.twist.author.id, personName(sheet.twist.author))}>
                  {sheet.twist.author.photoUrl ? <img src={sheet.twist.author.photoUrl} alt="" loading="lazy" /> : <span className="dc-author-empty" />}
                  {t('twistBy', { name: personName(sheet.twist.author) })}
                </button>
              ) : sheet.twist.credit && <span className="dc-author">{t('twistBy', { name: sheet.twist.credit })}</span>}
            </div>
          )}

          {/* 3. Good to know: two small tiles. */}
          {(range || placesCount > 0) && (
            <section className="dch-block">
              <h2 className="dch-title">{t('practicalTitle')}</h2>
              <div className="dch-tiles">
                {range && (
                  <div className="dch-tile">
                    <Icon name="cash-outline" size={18} />
                    <strong>{range.min === range.max
                      ? t('priceOne', { amount: formatAmount(range.min, i18n.language), currency: range.currency })
                      : t('priceRange', { min: formatAmount(range.min, i18n.language), max: formatAmount(range.max, i18n.language), currency: range.currency })}</strong>
                    {range.count ? <span className="dc-muted">{t('priceFrom', { count: range.count })}</span> : null}
                  </div>
                )}
                {placesCount > 0 && (
                  <button type="button" className="dch-tile"
                          onClick={() => openMapTheme(challenge.theme && isPlaceTheme(challenge.theme.key) ? challenge.theme.key : null)}>
                    <Icon name="location-outline" size={18} />
                    <strong>{t('places', { count: placesCount })}</strong>
                    <span className="dch-tile-link">{t('map.see')} ›</span>
                  </button>
                )}
              </div>
            </section>
          )}

          {/* My photo (posted from the app): its status. */}
          {myProof && (
            <button type="button" className="dch-row" onClick={() => setViewing(myProof)}>
              <img className="dch-thumb" src={myProof.thumbUrl || myProof.photoUrl} onError={thumbFallback(myProof.photoUrl)} alt="" loading="lazy" />
              <span className="dch-row-body">
                <span className="dch-row-title">{t('yourProof')} <StatusChip status={myProof.status} /></span>
                {myProof.status === 'pending' && <span className="dc-muted">{t('pendingHint')}</span>}
                {myProof.rejectionReason && <span className="dc-reason">{t('reasonLabel', { reason: myProof.rejectionReason })}</span>}
              </span>
            </button>
          )}

          {/* 4. My city: its top photo, or be its first. */}
          {cityShort && (mine?.top ? (
            <button type="button" className="dch-row" onClick={() => seeAll(myCountry)}>
              <img className="dch-thumb" src={mine.top.thumbUrl || mine.top.photoUrl} onError={thumbFallback(mine.top.photoUrl)} alt="" loading="lazy" />
              <span className="dch-row-body">
                <span className="dch-row-title">{t('myCity.in', { city: cityShort, count: mine.count })}</span>
                {(mine.top.answer && !mine.top.backHome) || mine.top.caption
                  ? <span className="dch-row-answer">{mine.top.answer && !mine.top.backHome ? answerText(mine.top.answer, i18n.language) : mine.top.caption}</span> : null}
              </span>
              <Icon name="chevron-forward" size={20} />
            </button>
          ) : mine && canPlay && !myProof ? (
            <button type="button" className="dch-row dch-row--first" onClick={play}>
              <span className="tc-camera"><Icon name="camera-outline" size={22} /></span>
              <span className="dch-row-title dch-row-body">{t('myCity.first', { city: cityShort })}</span>
              <Icon name="chevron-forward" size={20} />
            </button>
          ) : null)}
        </div>
      </div>

      {/* Back and the timer stay on top while scrolling. */}
      <div className="dch-top">
        <button type="button" className="dch-pill dch-back" onClick={onBack} aria-label={t('back')}><Icon name="chevron-back" size={22} /></button>
        <span className={`dch-pill dch-timer${challenge.isActive && isFinalHours(secondsLeft) ? ' dch-timer--warn' : ''}`}>
          <Icon name="time-outline" size={14} />
          {challenge.isActive && secondsLeft !== null ? t('timeLeft', { time: formatCountdown(secondsLeft) }) : t('closed')}
        </span>
      </div>

      {/* 5. Sticky: the photo rule in one line, then Play (the app) or See my photo. */}
      {showBar && (
        <div className="dch-bar">
          {!myProof && <p className="dch-rule">{isPlaceTheme(challenge.theme?.key) ? t('proofHint.place') : t('proofHint.noPlace')}</p>}
          <button type="button" className={`today-cta${myProof ? ' today-cta--taken' : ''}`} onClick={play}>
            <Icon name="camera-outline" size={20} />
            {myProof ? t('myCity.seeMine') : here?.name ? t('ctaAnswer', { city: shortCityName(here.name) }) : t('ctaAnswerNoCity')}
          </button>
        </div>
      )}
      <ProofViewer proof={viewing} onClose={() => setViewing(null)} />
    </div>
  )
}
