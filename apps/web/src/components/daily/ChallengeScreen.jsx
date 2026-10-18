import { useCallback, useEffect, useRef, useState } from 'react'
import BackButton from '../BackButton'
import { fetchDailyLeaderboard, fetchDailyProof, fetchDailySheet, fetchDailyToday } from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { CityFlag, CityName } from '../CityName'
import { track } from '../../lib/analytics'
import { APP_STORE, PLAY_STORE, deviceStore, themeName } from '../map/spotsShared'
import {
  useDaily, useDc, useCountdown, formatCountdown, isFinalHours, formatAmount, personName, seedProofs, seedVotesLeft,
  RankMedal, RoleLabel, LocalPassBadge, StatusChip, OriginalToggle, useOriginal, ProposedBy, ProofTile, ProofViewer,
} from './dailyShared'
import Icon from '../Icon'
import { themeIcon } from '../../lib/icons'

const POLL_MS = 30_000

const ROW = { display: 'inline-flex', alignItems: 'center', gap: 6 }
const LINE = { display: 'flex', alignItems: 'center', gap: 6 }

/** Provisional leaderboard of the active challenge, polled every 30 s while shown. */
export function useLeaderboard(active) {
  const [board, setBoard] = useState(null)
  useEffect(() => {
    if (!active) return
    let alive = true
    const load = () => fetchDailyLeaderboard().then(d => { if (alive) setBoard(d) }).catch(() => {})
    load()
    const id = setInterval(() => { if (document.visibilityState === 'visible') load() }, POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [active])
  return board
}

/**
 * A Daily Challenge (the app's /daily/[date]): challenge, context, Local Twist
 * and its author, "Proposed by", my proof, practical info, then World / City /
 * Top 10. `proofId` opens that proof on arrival; `tab: 'top10'` opens the Top 10.
 * Proofs are posted from the app, so the CTA opens the store.
 */
export default function ChallengeScreen({ date: dateParam = 'today', ...rest }) {
  const { i18n } = useDc()
  const { cityId } = useDaily()
  const [date, setDate] = useState(dateParam !== 'today' ? dateParam : null)
  // 'today': resolve today's date first (the sheet API is by date).
  useEffect(() => {
    if (date) return
    fetchDailyToday(cityId, i18n.language).then(d => setDate(d.challenge?.date ?? 'none')).catch(() => setDate('none'))
  }, [date, cityId, i18n.language])
  if (!date) {
    return (
      <div className="full-page dc-page">
        <div className="page-body dc-body"><div className="dc-center"><span className="wm-spinner" aria-hidden="true" /></div></div>
      </div>
    )
  }
  return <Sheet date={date} {...rest} />
}

function Sheet({ date, proofId = null, tab: initialTab = null, source = null, onBack }) {
  const { t, i18n } = useDc()
  const { cityId, account, openProfile, needAccount, openSpot } = useDaily()
  const [scope, setScope] = useState('world')
  const [tab, setTab] = useState(initialTab === 'top10' ? 'top10' : 'world')
  const [sheet, setSheet] = useState(null)
  const [error, setError] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [viewing, setViewing] = useState(null)
  const [showOriginal, toggleOriginal] = useOriginal()
  const secondsLeft = useCountdown(sheet?.challenge?.isActive ? sheet.challenge.endsAt : null)

  const load = useCallback(async () => {
    try {
      const s = await fetchDailySheet(date, { scope, cityId, locale: i18n.language })
      const open = !!s.challenge?.isActive
      seedProofs([...s.proofs, s.myProof, ...(s.results?.world ?? []), ...(s.results?.cities ?? []), s.results?.cityBest], open)
      if (open) seedVotesLeft(s.myVotes?.left ?? null)
      setSheet(s); setError(null)
    } catch (err) {
      setError(err.status === 404 ? 'not_found' : 'failed')
    }
  }, [date, scope, cityId, i18n.language])
  useEffect(() => { load() }, [load])

  const tracked = useRef(false)
  useEffect(() => {
    if (!sheet?.challenge || tracked.current) return
    tracked.current = true
    track('daily_challenge_viewed', { source: source ?? (proofId ? 'proof_link' : 'sheet'), date: sheet.challenge.date, platform_surface: 'web' })
  }, [sheet, proofId, source])

  // proofId: open it once (from the list, or fetched).
  const opened = useRef(false)
  useEffect(() => {
    if (!proofId || opened.current || !sheet) return
    opened.current = true
    openProof(proofId)
  }, [proofId, sheet]) // eslint-disable-line react-hooks/exhaustive-deps

  // A closed challenge opens on its podium, once.
  const defaulted = useRef(initialTab !== null)
  useEffect(() => {
    if (!sheet?.challenge || defaulted.current) return
    defaulted.current = true
    if (!sheet.challenge.isActive) setTab('top10')
  }, [sheet])

  const openProof = (id) => {
    const known = [...(sheet?.proofs ?? []), sheet?.myProof, ...(sheet?.results?.world ?? []), ...(sheet?.results?.cities ?? [])]
      .find(p => p?.id === id)
    if (known) { setViewing(known); return }
    fetchDailyProof(id, i18n.language).then(p => { seedProofs([p], !!sheet?.challenge?.isActive); setViewing(p) }).catch(() => {})
  }

  const loadMore = async () => {
    if (!sheet?.hasMore || loadingMore || sheet.nextBefore === null) return
    setLoadingMore(true)
    try {
      const next = await fetchDailySheet(date, { scope, cityId, before: sheet.nextBefore, locale: i18n.language })
      seedProofs(next.proofs, !!next.challenge?.isActive)
      setSheet(prev => ({
        ...prev,
        proofs: [...prev.proofs, ...next.proofs.filter(p => !prev.proofs.some(q => q.id === p.id))],
        hasMore: next.hasMore, nextBefore: next.nextBefore,
      }))
    } catch { /* keep what we have */ } finally { setLoadingMore(false) }
  }

  const selectTab = (next) => { setTab(next); if (next !== 'top10') setScope(next) }
  const goProfile = (id, name) => { if (!account) { needAccount('view_profile'); return } openProfile(id, name) }

  const challenge = sheet?.challenge ?? null
  const myProof = sheet?.myProof ?? null
  const isLive = !!sheet?.city?.isLive
  const cityName = sheet?.city?.name ? shortCityName(sheet.city.name) : ''
  const store = deviceStore()

  return (
    <div className="full-page dc-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{t('kicker')}</span>
      </div>
      <div className="page-body dc-body">
        {!sheet && !error ? <div className="dc-center"><span className="wm-spinner" aria-hidden="true" /></div>
        : error || !challenge ? (
          <div className="dc-center">
            <p className="dc-muted">{error === 'failed' ? t('loadFailed') : t('notFound')}</p>
            {error === 'failed' && <button type="button" className="dc-link" onClick={load}>{t('retry')}</button>}
          </div>
        ) : (
          <>
            <div className="dc-card">
              <div className="dc-card-top">
                <span className="today-kicker" style={ROW}><Icon name="flame-outline" size={14} />{t('kicker')}</span>
                <span className={`dc-countdown${challenge.isActive && isFinalHours(secondsLeft) ? ' dc-countdown--warn' : ''}`} style={ROW}>
                  {challenge.isActive && secondsLeft !== null && <Icon name="time-outline" size={14} />}
                  {challenge.isActive && secondsLeft !== null ? t('timeLeft', { time: formatCountdown(secondsLeft) }) : t('closed')}
                </span>
              </div>
              {challenge.theme && <span className="today-chip dc-theme" style={ROW}><Icon name={themeIcon(challenge.theme.key, challenge.special)} size={14} />{themeName(challenge.theme.key, { special: challenge.special })}</span>}
              <p className="today-text">{showOriginal && challenge.original ? challenge.original.text : challenge.text}</p>
              {challenge.context && <p className="dc-context">{showOriginal && challenge.original ? challenge.original.context : challenge.context}</p>}
              <OriginalToggle translated={!!challenge.original || !!sheet.twist?.originalText} showingOriginal={showOriginal} onClick={toggleOriginal} />
              {challenge.proposedBy && <ProposedBy credit={challenge.proposedBy} />}

              {sheet.twist && isLive && (
                <div className="dc-twist">
                  <span className="dc-twist-label" style={ROW}>{sheet.city?.country ? <CityFlag country={sheet.city.country} /> : <Icon name="location-outline" size={14} />}{t('twistIn', { city: cityName })}</span>
                  <span className="dc-twist-text">{showOriginal && sheet.twist.originalText ? sheet.twist.originalText : sheet.twist.text}</span>
                  {sheet.twist.author ? (
                    <button type="button" className="dc-author" onClick={() => goProfile(sheet.twist.author.id, personName(sheet.twist.author))}>
                      {sheet.twist.author.photoUrl ? <img src={sheet.twist.author.photoUrl} alt="" /> : <span className="dc-author-empty" />}
                      {t('twistBy', { name: personName(sheet.twist.author) })}
                    </button>
                  ) : sheet.twist.credit && <span className="dc-author">{t('twistBy', { name: sheet.twist.credit })}</span>}
                </div>
              )}

              {myProof ? (
                <div className="dc-mine" role="button" tabIndex={0} onClick={() => setViewing(myProof)}>
                  <img src={myProof.thumbUrl || myProof.photoUrl} alt="" />
                  <div className="dc-mine-body">
                    <span className="dc-mine-title">{t('yourProof')}</span>
                    <StatusChip status={myProof.status} />
                    {myProof.status === 'pending' && <span className="dc-muted">{t('pendingHint')}</span>}
                    {myProof.rejectionReason && <span className="dc-reason">{t('reasonLabel', { reason: myProof.rejectionReason })}</span>}
                  </div>
                </div>
              ) : challenge.isActive && (
                <a className="today-cta" href={store === 'android' ? PLAY_STORE : APP_STORE} target="_blank" rel="noopener noreferrer"
                   onClick={() => track('web_today_take_clicked', { store: store ?? 'ios', surface: 'sheet' })}>
                  {t('cta')}
                </a>
              )}
            </div>

            <Practical sheet={sheet} onOpenProof={openProof} onOpenSpot={openSpot} />

            <div className="dc-tabs" role="tablist">
              {(isLive ? ['world', 'city', 'top10'] : ['world', 'top10']).map(k => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={`dc-tab${tab === k ? ' dc-tab--on' : ''}`} onClick={() => selectTab(k)}>
                  {k === 'world' ? t('tabWorld') : k === 'city' ? <CityName name={sheet.city?.name} country={sheet.city?.country} short /> : t('leaderboard.tab')}
                </button>
              ))}
            </div>

            {tab === 'top10' ? (
              <LeaderboardPanel sheet={sheet} secondsLeft={secondsLeft} onOpenProof={openProof} />
            ) : sheet.proofs.length === 0 ? (
              <div className="dc-center">
                <Icon name="camera-outline" size={30} style={{ color: 'var(--muted2)' }} />
                <p className="dc-empty-title">{t('beFirst')}</p>
                <p className="dc-muted">{t('beFirstSub')}</p>
              </div>
            ) : (
              <>
                <div className="dc-grid">
                  {sheet.proofs.map(p => <ProofTile key={p.id} proof={p} onOpen={() => setViewing(p)} />)}
                </div>
                {sheet.hasMore && (
                  <button type="button" className="wm-btn wm-btn--ghost wm-more" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? '…' : t('seeProofs')}
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>
      <ProofViewer proof={viewing} onClose={() => setViewing(null)} />
    </div>
  )
}

/** Practical info from approved proofs: the price range paid and the pinned places. */
function Practical({ sheet, onOpenProof, onOpenSpot }) {
  const { t, i18n } = useDc()
  const range = sheet.practical?.priceRanges?.[0]
  const places = sheet.practical?.places ?? []
  if (!range && places.length === 0) return null
  return (
    <div className="dc-practical">
      <p className="dc-section">{t('practicalTitle')}</p>
      {range && (
        <p className="dc-line" style={LINE}>
          <Icon name="cash-outline" size={16} style={{ color: 'var(--muted2)' }} />
          <span>{range.min === range.max
            ? t('priceOne', { amount: formatAmount(range.min, i18n.language), currency: range.currency })
            : t('priceRange', { min: formatAmount(range.min, i18n.language), max: formatAmount(range.max, i18n.language), currency: range.currency })}
          {range.count ? ` · ${t('priceFrom', { count: range.count })}` : ''}</span>
        </p>
      )}
      {places.length > 0 && (
        <>
          <p className="dc-line" style={LINE}><Icon name="location-outline" size={16} style={{ color: 'var(--muted2)' }} />{t('places', { count: places.length })}</p>
          <button type="button" className="dc-pill-btn" onClick={() => onOpenSpot(null)}>{t('map.see')}</button>
          {places.slice(0, 5).map(p => (
            <button key={p.proofId} type="button" className="dc-place" onClick={() => onOpenProof(p.proofId)}>· {p.name || t('unnamedPlace')}</button>
          ))}
        </>
      )}
    </div>
  )
}

/** Top 10: the live leaderboard while active, the official podium once closed. */
function LeaderboardPanel({ sheet, secondsLeft, onOpenProof }) {
  const { t } = useDc()
  const active = !!sheet.challenge?.isActive
  const lb = useLeaderboard(active)
  const board = lb && lb.date === sheet.challenge?.date ? lb : null

  if (!active) {
    const r = sheet.results
    return (
      <div className="dc-board">
        <p className="dc-section" style={LINE}><Icon name="trophy-outline" size={16} />{t('leaderboard.official')}</p>
        {!r || (r.world.length === 0 && r.cities.length === 0) ? <p className="dc-muted">{t('results.none')}</p> : (
          <>
            {r.world.map((p, i) => <ResultRow key={p.id} proof={p} label={<RankMedal rank={i + 1} />} onOpen={() => onOpenProof(p.id)} />)}
            {r.cities.length > 0 && <p className="dc-section">{t('results.bestInCities')}</p>}
            {r.cities.map(p => <ResultRow key={`c${p.id}`} proof={p} label={<Icon name="location-outline" size={18} />} onOpen={() => onOpenProof(p.id)} />)}
          </>
        )}
      </div>
    )
  }

  const myProof = sheet.myProof
  return (
    <div className="dc-board">
      <p className="dc-section" style={LINE}><Icon name="trophy-outline" size={16} />{t('leaderboard.tab')}</p>
      <p className="dc-muted">
        {t('leaderboard.provisional')}
        {secondsLeft !== null ? ` · ${t('leaderboard.finalIn', { time: formatCountdown(secondsLeft) })}` : ''}
      </p>
      {board?.me ? (
        <div className="dc-me">
          <span>{t('leaderboard.me', { rank: board.me.rank, votes: board.me.voteCount })}</span>
          {board.me.cityRank !== null && myProof?.city && (
            <span className="dc-muted">{t('leaderboard.meCity', { rank: board.me.cityRank, city: shortCityName(myProof.city.name) })}</span>
          )}
        </div>
      ) : (
        <p className="dc-muted">{myProof?.status === 'pending' ? t('leaderboard.pending') : !myProof ? t('leaderboard.noProof') : ''}</p>
      )}
      {!board ? <div className="dc-center"><span className="wm-spinner" aria-hidden="true" /></div>
      : !board.ranked ? <p className="dc-empty-title" style={LINE}><Icon name="flame-outline" size={18} />{t('leaderboard.minProofs', { min: board.minProofs, n: board.approvedCount })}</p>
      : board.world.length === 0 ? <p className="dc-empty-title" style={LINE}><Icon name="heart-outline" size={18} />{t('leaderboard.noVotes')}</p>
      : (
        <>
          {board.world.map(e => <EntryRow key={e.proofId} entry={e} mine={e.proofId === board.me?.proofId} onOpen={() => onOpenProof(e.proofId)} />)}
          {board.cities.map(c => (
            <div key={c.city.id}>
              <p className="dc-section" style={LINE}>{c.city.country ? <CityFlag country={c.city.country} /> : <Icon name="location-outline" size={16} />}{t('leaderboard.cityTop', { city: shortCityName(c.city.name) })}</p>
              {c.entries.map(e => <EntryRow key={`${c.city.id}:${e.proofId}`} entry={e} mine={e.proofId === board.me?.proofId} hideCity onOpen={() => onOpenProof(e.proofId)} />)}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function EntryRow({ entry, mine, hideCity = false, onOpen }) {
  return (
    <button type="button" className={`dc-row${mine ? ' dc-row--mine' : ''}`} onClick={onOpen}>
      <span className="dc-rank">{entry.rank <= 3 ? <RankMedal rank={entry.rank} /> : `#${entry.rank}`}</span>
      {entry.thumbUrl ? <img className="dc-row-thumb" src={entry.thumbUrl} alt="" /> : <span className="dc-row-thumb" />}
      <span className="dc-row-body">
        <span className="dc-row-name">{personName(entry.user)} {entry.user.localPass && <LocalPassBadge />}</span>
        <span className="dc-muted">
          <RoleLabel isLocal={entry.isLocal} />
          {!hideCity && entry.city && <> · <CityName name={entry.city.name} country={entry.city.country} short /></>}
        </span>
      </span>
      <span className="dc-row-votes" style={ROW}><Icon name="heart" size={14} />{entry.voteCount}</span>
    </button>
  )
}

function ResultRow({ proof, label, onOpen }) {
  return (
    <button type="button" className="dc-row" onClick={onOpen}>
      <span className="dc-rank">{label}</span>
      <img className="dc-row-thumb" src={proof.thumbUrl || proof.photoUrl} alt="" />
      <span className="dc-row-body">
        <span className="dc-row-name">{personName(proof.user)} {proof.user.localPass && <LocalPassBadge />}</span>
        <span className="dc-muted">
          <RoleLabel isLocal={proof.isLocal} />
          {proof.city && <> · <CityName name={proof.city.name} country={proof.city.country} short /></>}
        </span>
      </span>
      <span className="dc-row-votes" style={ROW}><Icon name="heart" size={14} />{proof.voteCount}</span>
    </button>
  )
}
