import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LogoHat, setSeasonalEvent } from '../event/seasonal'
import { fetchDailyToday, fetchLeaderboard, fetchMyProposals, fetchMySpots, fetchUserDaily, fetchUserFriends, fetchWeeklyRank } from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { CityFlag } from '../CityName'
import { thumbUrl } from '../../lib/imageThumb'
import { THEME_KEYS, themeName } from '../map/spotsShared'
import { themeIcon } from '../../lib/icons'
import { shareLink } from '../../lib/shareLink'
import Icon from '../Icon'
import HeaderArt from '../HeaderArt'
import { FlagSticker, themeColor } from '../joy/Joy'
import { RankMedal } from '../daily/dailyShared'
import { useBackLayer } from '../../lib/backLayers'

// Each stamp sits at its own slight angle, like a real passport (passport.html).
const ROTATION = [-6, 5, -3, 7, -5, 4, -7]

// The three ways to earn Daily Challenge points, same rows as the app's sheet.
const POINTS = [['proof', 10], ['vote', 2], ['top', '30 / 20 / 10']]

const ROW = { display: 'inline-flex', alignItems: 'center', gap: 6 }

const usePp = () => useTranslation('profile', { keyPrefix: 'pp' })

/**
 * PASSPORT (W4, the app's Passport tab, SPEC 9.7, V3 polish 6), a real,
 * shareable passport: identity (avatar, @username, home city, "Local of Saigon
 * since…", cities, photos and likes received), streak and weekly rank, the
 * flags of the cities I've been compared with, one page per city (snapping,
 * with dots) with the 7 stamps in their theme colors (click: the photo that
 * earned it) and the Local Pass apart, then My photos, My spots, My proposals
 * (+ Propose), Friends and Most Local all time (a medal for the podium), and
 * "Share my passport". Settings behind the gear; "How points work" as a
 * sheet. Guests get an invitation to start theirs.
 */
export default function PassportScreen({ account, guestName, guestMode, cityId, cityName, cityCountry, onSettings, onSignUp, onSignIn, onOpen }) {
  const { t, i18n } = usePp()
  const { t: tc } = useTranslation('challenge')
  const [stats, setStats] = useState(null)
  const [today, setToday] = useState(null)
  const [counts, setCounts] = useState({ spots: null, proposals: null, friends: null, week: null, alltime: null })
  const [help, setHelp] = useState(false)
  const [page, setPage] = useState(0)
  const [copied, setCopied] = useState(false)
  useBackLayer(help, () => setHelp(false))
  const cityKey = cityId ? (String(cityId).startsWith('city_') ? String(cityId) : `city_${cityId}`) : null
  const cityNum = cityKey ? Number(cityKey.slice(5)) : null
  const city = cityName ? shortCityName(cityName) : null

  useEffect(() => {
    if (!account) return
    let alive = true
    const set = (patch) => { if (alive) setCounts(c => ({ ...c, ...patch })) }
    fetchUserDaily(account.id, i18n.language).then(s => { if (alive) setStats(s) }).catch(() => {})
    fetchDailyToday(cityKey, i18n.language).then(d => { setSeasonalEvent(d?.event); if (alive) setToday(d) }).catch(() => {})
    fetchMySpots().then(s => set({ spots: s.length })).catch(() => {})
    fetchMyProposals(i18n.language).then(p => set({ proposals: p.items.filter(x => x.status === 'pending').length })).catch(() => {})
    fetchUserFriends(account.id, { page: 1, limit: 1 }).then(f => set({ friends: f.total })).catch(() => {})
    fetchWeeklyRank(cityKey).then(r => set({ week: r?.rank ?? null })).catch(() => {})
    fetchLeaderboard({ scope: cityKey ? 'city' : 'world', period: 'alltime', limit: 1, cityId: cityKey ?? undefined })
      .then(r => set({ alltime: r?.me?.rank ?? null })).catch(() => {})
    return () => { alive = false }
  }, [account, cityKey, i18n.language])

  const header = (
    <div className="pp-header has-art">
      <HeaderArt kind="passport" />
      <div className="tab-heading">
        <h1 className="pp-title">{t('passport.title')}</h1>
        <p className="tab-subtitle">{i18n.t('subtitles.passport', { ns: 'common' })}</p>
      </div>
      <button type="button" className="v3-round" onClick={onSettings} aria-label={t('settings')}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </div>
  )

  if (!account) {
    return (
      <div className="full-page full-page--tab pp-page">
        {header}
        <div className="page-body pp-body">
          <Identity name={guestName || '-'} photo={null} mode={guestMode} city={city} country={cityCountry} />
          <div className="pp-guest">
            <p className="pp-guest-title">{t('passport.guestTitle')}</p>
            <p className="dc-muted">{t('passport.guestBody')}</p>
            <button type="button" className="today-cta dc-full" onClick={onSignUp}>{t('passport.signUp')}</button>
            <button type="button" className="dc-link pp-center" onClick={onSignIn}>{t('passport.signIn')}</button>
          </div>
        </div>
      </div>
    )
  }

  // City pages: every city with stamps, the current city first (even with none).
  const progress = [...(stats?.localPassProgress ?? [])]
  if (cityNum !== null && !progress.some(p => p.city.id === cityNum)) {
    progress.unshift({ city: { id: cityNum, name: cityName ?? null, country: cityCountry ?? null }, done: 0, total: 7, themes: [], earned: false })
  }
  progress.sort((a, b) => (a.city.id === cityNum ? -1 : b.city.id === cityNum ? 1 : b.done - a.done))
  // A special day earns its own stamp, not one of the 7.
  const todayKey = today?.challenge?.theme?.key ?? null
  const todayTheme = todayKey === 'special' ? null : todayKey
  const tomorrow = today?.tomorrow?.theme ?? null
  const streak = stats?.currentStreak ?? today?.streak ?? 0
  const home = stats?.homeCity ?? null
  // "Local of Saigon since March 2026": my home city (else the city shown) and when I joined.
  const sinceCity = home?.name ? shortCityName(home.name) : city
  const since = stats?.memberSince && sinceCity && account.mode === 'local'
    ? t('passport.localSince', { city: sinceCity, date: new Date(stats.memberSince * 1000).toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' }) })
    : null
  const openStamp = (s) => onOpen('challenge', { date: s.date, proofId: s.proofId })
  // Share my passport (SPEC 9.14): the link to Hilads, with the passport line (no card image on the web).
  const share = async () => {
    const name = progress[0]?.city.name ?? cityName
    const text = name ? i18n.t('shareLink.textPassport', { ns: 'common', city: shortCityName(name) }) : i18n.t('shareLink.textPassportNoCity', { ns: 'common' })
    const res = await shareLink({ type: 'passport', path: '/', text, source: 'passport' })
    if (res === 'copied') { setCopied(true); setTimeout(() => setCopied(false), 1800) }
  }

  return (
    <div className="full-page full-page--tab pp-page">
      {header}
      <div className="page-body pp-body">
        <Identity name={account.username ? `@${account.username}` : account.display_name}
                  photo={account.thumbAvatarUrl ?? account.profile_photo_url ?? null} mode={account.mode ?? null}
                  city={home ? shortCityName(home.name ?? '') : city} country={home ? home.country : cityCountry} since={since}
                  stats={stats ? { cities: stats.citiesPlayed ?? null, photos: stats.photos ?? stats.completed ?? null, likes: stats.likesReceived ?? null } : null} />

        <div className="pp-cards">
          <div className="pp-card">
            <span className="pp-card-title" style={ROW}><Icon name="flame-outline" size={18} />{tc('dc.streak', { count: streak })}</span>
            <span className="dc-muted">{t('passport.best', { count: stats?.bestStreak ?? 0 })}</span>
          </div>
          <div className="pp-card">
            <span className="pp-card-title" style={ROW}><Icon name="trophy-outline" size={18} />{counts.week ? t('passport.weekRank', { rank: counts.week }) : t('passport.weekNone')}</span>
            <span className="dc-muted pp-ellipsis">{city ? t('passport.mostLocalIn', { city }) : t('passport.mostLocalWorld')}</span>
          </div>
        </div>
        {/* The cities I've been compared with: their flags (a click opens that city's stories). */}
        {(stats?.comparedCities?.length ?? 0) > 0 ? (
          <div className="pp-compared-block">
            <span className="dc-muted pp-compared">{t('passport.comparedCities', { count: stats.comparedCities.length })}</span>
            <div className="pp-flags">
              {stats.comparedCities.map(c => (
                <button key={c.id} type="button" className="pp-flag-chip" aria-label={c.name ?? ''}
                        onClick={() => onOpen('stories', { city: c.id, source: 'passport' })}>
                  <FlagSticker country={c.country} size={22} />
                  <span className="pp-flag-name">{shortCityName(c.name ?? '')}</span>
                </button>
              ))}
            </div>
          </div>
        ) : stats?.comparedCountries > 0 && (
          <span className="dc-muted pp-compared" style={ROW}><Icon name="earth-outline" size={16} />{t('passport.compared', { count: stats.comparedCountries })}</span>
        )}

        {progress.length > 0 && (
          <div className="pp-pages-wrap">
            {/* One page per city, snapping page by page. */}
            <div className={`pp-pages${progress.length > 1 ? ' pp-pages--scroll' : ''}`}
                 onScroll={progress.length > 1 ? (e) => setPage(Math.round(Math.abs(e.currentTarget.scrollLeft) / (e.currentTarget.clientWidth + 10))) : undefined}>
              {progress.map(p => (
                <CityPage key={p.city.id} cityName={shortCityName(p.city.name ?? '')} country={p.city.country} themes={p.themes}
                          stamps={p.stamps} total={p.total} earned={p.earned} onStamp={openStamp}
                          todayTheme={p.city.id === cityNum ? todayTheme : null} tomorrowTheme={p.city.id === cityNum ? tomorrow : null} />
              ))}
            </div>
            {progress.length > 1 && (
              <div className="pp-dots" aria-hidden="true">
                {progress.map((p, i) => <span key={p.city.id} className={`pp-dot${i === page ? ' pp-dot--on' : ''}`} />)}
              </div>
            )}
          </div>
        )}

        {(stats?.pioneerOf?.length ?? 0) > 0 && <PioneerBadges pioneers={stats.pioneerOf} />}
        {(stats?.specialStamps?.length ?? 0) > 0 && <SpecialStamps stamps={stats.specialStamps} />}

        <div className="pp-rows">
          <Row label={t('passport.myPhotos')} value={stats?.photos !== undefined ? String(stats.photos) : ''} onClick={() => onOpen('photos')} />
          <Row label={t('passport.mySpots')} value={counts.spots !== null ? String(counts.spots) : ''} onClick={() => onOpen('spots')} />
          <Row label={t('passport.myProposals')} value={counts.proposals ? t('passport.inReview', { count: counts.proposals }) : ''} onClick={() => onOpen('proposals')} />
          <Row icon="add-circle-outline" label={tc('dc.propose.cta')} onClick={() => onOpen('propose', { source: 'passport' })} />
          <Row label={t('passport.friends')} value={counts.friends !== null ? String(counts.friends) : ''} onClick={() => onOpen('friends')} />
          <Row label={t('passport.mostLocalAllTime')}
               leading={counts.alltime && counts.alltime <= 3 ? <RankMedal rank={counts.alltime} size={26} /> : null}
               value={counts.alltime ? (city ? t('passport.allTimeRank', { rank: counts.alltime, city }) : `#${counts.alltime}`) : ''}
               onClick={() => onOpen('alltime')} />
        </div>

        <button type="button" className="today-cta dc-full" style={{ gap: 8 }} onClick={share}>
          <Icon name="share-social-outline" size={18} />{copied ? i18n.t('shareLink.copied', { ns: 'common' }) : t('passport.share')}
        </button>
        <button type="button" className="dc-link pp-help" style={ROW} onClick={() => setHelp(true)}><Icon name="information-circle-outline" size={16} />{t('passport.howPoints')}</button>
      </div>
      {help && <PointsSheet onClose={() => setHelp(false)} />}
    </div>
  )
}

function Identity({ name, photo, mode, city, country, since = null, stats = null }) {
  const { t } = usePp()
  const local = mode === 'local'
  return (
    <div className="pp-identity">
      {/* A seasonal event's live day: the passport photo wears the hat. */}
      <span className="pp-avatar-wrap">
        {photo
          ? <img className="pp-avatar" src={thumbUrl(photo)} alt="" />
          : <span className="pp-avatar pp-avatar--empty">{(name.replace('@', '') || '?')[0].toUpperCase()}</span>}
        <LogoHat size={40} className="seasonal-hat seasonal-hat--avatar" />
      </span>
      <div className="pp-identity-body">
        <span className="pp-name">{name}</span>
        {since && <span className="pp-since">{since}</span>}
        <div className="pp-chips">
          {mode && <span className={`pp-chip ${local ? 'pp-chip--local' : 'pp-chip--traveler'}`}>{t(`mode.${local ? 'local' : 'exploring'}.label`)}</span>}
          {city && <span className="pp-chip pp-chip--city" style={{ ...ROW, gap: 4 }}>{country ? <CityFlag country={country} size={14} /> : <Icon name="location-outline" size={13} />}{city}</span>}
        </div>
        {stats && (
          <div className="pp-stats">
            {[['cities', stats.cities], ['photos', stats.photos], ['likes', stats.likes]].map(([k, n]) => n !== null && (
              <span key={k}><strong>{n}</strong> {t(`passportStats.${k}`, { count: n })}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * One city page (SPEC 9.7, V3 polish 6): the 7 theme stamps, each in its
 * theme's color like real ink (a dashed inner ring, its own angle, the date it
 * was earned in tiny type; a click opens the photo that earned it), the
 * missing ones dashed grey with their icon, then the Local Pass apart: a gold
 * row, the reward of the 7. "N of 7" counts the 7 themes only.
 */
function CityPage({ cityName, country, themes, stamps, total = 7, earned, todayTheme, tomorrowTheme, onStamp }) {
  const { t, i18n } = usePp()
  const have = new Set(themes)
  const todayMissing = todayTheme !== null && !have.has(todayTheme)
  const hint = earned || have.size >= total ? t('passport.hintPass')
    : todayMissing ? t('passport.hintToday', { theme: themeName(todayTheme, { city: cityName }) })
    : tomorrowTheme && tomorrowTheme.key !== 'special' ? t('passport.hintTomorrow', { theme: themeName(tomorrowTheme.key, { city: cityName }) })
    : null
  const day = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return (
    <div className="pp-cpage" aria-label={t('passport.pageA11y', { city: cityName, count: have.size })}>
      <div className="pp-cpage-head">
        <span className="pp-cpage-city"><CityFlag country={country} />{cityName}</span>
        <span className="dc-muted">{t('passport.stampsOf', { count: have.size, total })}</span>
      </div>
      {hint && <p className="dc-line pp-hint">{hint}</p>}
      <div className="pp-grid">
        {THEME_KEYS.map((k, i) => {
          const stamped = have.has(k)
          const next = !stamped && k === todayTheme
          const c = themeColor(k)
          const ink = { '--c': c.fill, '--cl': c.line ?? c.fill, '--ct': c.light, '--ctd': c.dark }
          const earnedBy = stamps?.[k] ?? null
          const body = stamped ? (
            <span className="pp-stamp" style={{ ...ink, transform: `rotate(${ROTATION[i]}deg)` }}><span className="pp-stamp-inner"><Icon name={themeIcon(k)} size={22} /></span></span>
          ) : (
            <span className={`pp-empty${next ? ' pp-empty--next' : ''}`} style={next ? ink : undefined}><Icon name={themeIcon(k)} size={22} /></span>
          )
          return (
            <div key={k} className="pp-cell">
              {earnedBy && onStamp ? (
                <button type="button" className="pp-stamp-btn" onClick={() => onStamp(earnedBy)}
                        aria-label={`${themeName(k, { city: cityName })}, ${day(earnedBy.date)}`}>{body}</button>
              ) : body}
              <span className={`pp-label${!stamped && !next ? ' pp-label--off' : ''}`}>{themeName(k, { city: cityName })}</span>
              {earnedBy && <span className="pp-date pp-date--stamp">{day(earnedBy.date)}</span>}
            </div>
          )
        })}
      </div>
      {/* The Local Pass: the reward of the 7 stamps, never an 8th one. */}
      <div className={`pp-pass${earned ? ' pp-pass--on' : ''}`}>
        <span className={`pp-seal${earned ? ' pp-seal--on' : ''}`}><Icon name={earned ? 'ribbon' : 'ribbon-outline'} size={26} /></span>
        <span className="pp-pass-body">
          <span className="pp-pass-title">{t('passport.localPass')}</span>
          <span className="pp-pass-sub">{earned ? t('passport.passEarned', { city: cityName }) : t('passport.passToGo', { count: Math.max(0, total - have.size) })}</span>
        </span>
      </div>
    </div>
  )
}

/**
 * "Special stamps" (SPEC 9.15): one limited-edition stamp per special day with
 * an approved proof, apart from the city pages and never counted for the Local Pass.
 */
function SpecialStamps({ stamps }) {
  const { t, i18n } = usePp()
  return (
    <div className="pp-cpage">
      <div className="pp-cpage-head"><span className="pp-cpage-city">{t('passport.specialTitle')}</span></div>
      <p className="dc-line pp-hint">{t('passport.specialSub')}</p>
      <div className="pp-grid">
        {stamps.map((s, i) => {
          const date = new Date(`${s.date}T12:00:00Z`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
          return (
            <div key={s.id} className="pp-cell" aria-label={`${s.name}, ${date}`}>
              <span className="pp-stamp pp-stamp--special" style={{ transform: `rotate(${ROTATION[(i + 3) % ROTATION.length]}deg)` }}>
                <span className="pp-stamp-inner" style={{ color: 'var(--gold)' }}><Icon name={themeIcon('special', s)} size={22} /></span>
              </span>
              <span className="pp-label">{s.name}</span>
              <span className="dc-muted pp-date">{date}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Pioneer badges (SPEC 9.16): "Pioneer of Saigon" for each city whose first approved proof ever is mine. */
function PioneerBadges({ pioneers }) {
  const { t } = useTranslation('common')
  return (
    <div className="pp-cpage">
      <div className="pp-cpage-head"><span className="pp-cpage-city">{t('represent.pioneerTitle')}</span></div>
      <p className="dc-line pp-hint">{t('represent.pioneerSub')}</p>
      <div className="pp-pioneers">
        {pioneers.map(p => (
          <span key={p.city.id} className="pp-pioneer" style={ROW}>
            <Icon name="flag-outline" size={15} style={{ color: 'var(--gold)' }} /><CityFlag country={p.city.country} />
            {t('represent.pioneer', { city: shortCityName(p.city.name ?? '') })}
          </span>
        ))}
      </div>
    </div>
  )
}

function Row({ label, value = '', icon = null, leading = null, onClick }) {
  return (
    <button type="button" className="pp-row" onClick={onClick}>
      {icon && <Icon name={icon} size={20} style={{ color: 'var(--primary-text)' }} />}
      {leading}
      <span className="pp-row-label">{label}</span>
      <span className="pp-row-value">{value}</span>
      <Icon name="chevron-forward" size={18} style={{ color: 'var(--muted2)' }} />
    </button>
  )
}

/** "How to earn points": the 9 ways, as in the app's sheet. */
function PointsSheet({ onClose }) {
  const { t } = usePp()
  return (
    <div className="v3-sheet-wrap" role="dialog" aria-modal="true" aria-label={t('points.title')}>
      <button type="button" className="v3-sheet-scrim" onClick={onClose} aria-label={t('passport.close')} />
      <div className="v3-sheet pp-points">
        <span className="v3-sheet-grabber" aria-hidden="true" />
        <p className="v3-sheet-title">{t('points.title')}</p>
        <p className="dc-muted">{t('points.intro')}</p>
        <div className="pp-points-list">
          {POINTS.map(([key, pts]) => (
            <div key={key} className="pp-points-row"><span>{t(`points.${key}`)}</span><strong>+{pts}</strong></div>
          ))}
        </div>
        <p className="dc-muted">{t('points.weekly')}</p>
        <button type="button" className="today-cta dc-full" onClick={onClose}>{t('passport.gotIt')}</button>
      </div>
    </div>
  )
}
