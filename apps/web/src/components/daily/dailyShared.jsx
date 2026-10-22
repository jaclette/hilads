import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import { voteDailyProof, unvoteDailyProof, reportDailyProof, fetchDailyVoters } from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { CityName } from '../CityName'
import { track } from '../../lib/analytics'
import Icon from '../Icon'
import AvatarWithFlag from '../AvatarWithFlag'
import { AnswerChip, BackHomeBlock, useMoney } from './compareShared'

// Where I am, as Today last said ({id, name, country, source, presence} | null):
// the sheet's "Answer for [city]" uses it, never the browsed city.
let lastHere = null
const hereListeners = new Set()
// Today's last answer: the challenge sheet opens from it at once (its top), before its own data.
let lastToday = null
export const getLastToday = () => lastToday
export function setLastToday(today) { lastToday = today ?? null }

export function setLastHere(here) {
  lastHere = here ?? null
  hereListeners.forEach(l => l())
}
export function useHere() {
  return useSyncExternalStore(l => { hereListeners.add(l); return () => hereListeners.delete(l) }, () => lastHere)
}
import { themeName } from '../map/spotsShared'
import { thumbFallback } from '../../lib/thumbFallback'
import { useBackLayer } from '../../lib/backLayers'

// Shared pieces of the web Daily Challenge screens (W2, ports of the app's
// features/daily): the screens' context, the app's strings (challenge.json →
// dc, copied from the app's daily.json), badges, votes and the proof viewer.

/**
 * What the Daily screens need from App: the account, the city, and how to
 * navigate (open a Daily screen, a profile, a spot, the sign-up gate).
 */
export const DailyContext = createContext({
  account: null, cityId: null, scope: 'city',
  openDaily: () => {}, openProfile: () => {}, openSpot: () => {}, needAccount: () => {},
})
export const useDaily = () => useContext(DailyContext)

/** The app's Daily strings, same keys as the app (t('kicker'), t('vote.left')…). */
export function useDc() {
  return useTranslation('challenge', { keyPrefix: 'dc' })
}

const INLINE = { display: 'inline-flex', alignItems: 'center', gap: 4 }

/**
 * A rank in a round seal: #1 on gold, #2 and #3 on the primary tint, the rest
 * as a plain "#n" (the app's RankMedal; replaces the medal emoji). podium:
 * gold, silver and bronze (yesterday's podium).
 */
export function RankMedal({ rank, size = 26, podium = false }) {
  if (rank > 3) return <span>#{rank}</span>
  const tone = rank === 1 ? ' dc-medal--gold' : podium ? (rank === 2 ? ' dc-medal--silver' : ' dc-medal--bronze') : ''
  return (
    <span className={`dc-medal${tone}`} style={{ width: size, height: size }} aria-label={`#${rank}`}>
      {rank}
    </span>
  )
}

/** "Local" / "Traveler" with its icon (location / compass, as in the app); a Hilads suggestion gets its badge instead. */
export function RoleLabel({ isLocal, suggestion = false }) {
  const { t } = useDc()
  if (suggestion) return <span className="pick-badge"><Icon name="star" size={12} />{i18n.t('pick.badge', { ns: 'common' })}</span>
  return (
    <span style={INLINE}>
      <Icon name={isLocal ? 'location-outline' : 'compass-outline'} size={13} />
      {isLocal ? t('local') : t('traveler')}
    </span>
  )
}

export const COUNTDOWN_WARNING_SECONDS = 3 * 3600
export const isFinalHours = (s) => s !== null && s <= COUNTDOWN_WARNING_SECONDS

/** A countdown in the viewer's language: "20h 43m" (FR "20 h 43"), "42m 07s" in the last hour. */
export function formatCountdown(seconds) {
  if (seconds === null || seconds === undefined) return ''
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0
    ? i18n.t('dc.countdown.hm', { ns: 'challenge', h, m: pad(m) })
    : i18n.t('dc.countdown.ms', { ns: 'challenge', m, s: pad(s % 60) })
}

/** Seconds left until `endsAt` (unix s), ticking every second; null when no end. */
export function useCountdown(endsAt) {
  const calc = () => (endsAt ? Math.max(0, Math.round(endsAt - Date.now() / 1000)) : null)
  const [left, setLeft] = useState(calc)
  useEffect(() => {
    setLeft(calc())
    if (!endsAt) return
    const id = setInterval(() => setLeft(calc()), 1000)
    return () => clearInterval(id)
  }, [endsAt]) // eslint-disable-line react-hooks/exhaustive-deps
  return left
}

export function formatAmount(n, lang) {
  try { return new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(n) } catch { return String(n) }
}

export const personName = (p) => p?.displayName || p?.username || ''

export function LocalPassBadge({ label = false, onDark = false }) {
  const { t } = useDc()
  return <span className={`dc-pass${onDark ? ' dc-pass--dark' : ''}`} aria-label={t('localPass.badgeA11y')} style={INLINE}><Icon name="ticket-outline" size={12} />{label ? t('localPass.name') : null}</span>
}

export function EarlyBadge({ onDark = false }) {
  const { t } = useDc()
  return <span className={`dc-early${onDark ? ' dc-early--dark' : ''}`} style={INLINE}><Icon name="flash-outline" size={11} />{t('early.badge')}</span>
}

/** "In review" / "Published" / "Not published" / "Removed" for my proof. */
export function StatusChip({ status }) {
  const { t } = useDc()
  const tone = status === 'approved' ? 'ok' : status === 'pending' ? 'wait' : 'bad'
  const icon = status === 'approved' ? 'checkmark-circle-outline' : status === 'pending' ? 'hourglass-outline' : 'warning-outline'
  return <span className={`dc-status dc-status--${tone}`} style={INLINE}><Icon name={icon} size={13} />{t(`status.${status}`)}</span>
}

export function useOriginal() {
  const [on, setOn] = useState(false)
  return [on, () => setOn(v => !v)]
}

export function OriginalToggle({ translated, showingOriginal, onClick }) {
  const { t } = useDc()
  if (!translated) return null
  return (
    <button type="button" className="dc-original" onClick={(e) => { e.stopPropagation(); onClick() }}>
      {showingOriginal ? t('translation.seeTranslation') : t('translation.seeOriginal')}
    </button>
  )
}

/** "Proposed by <name> · <city>"; the name opens the author's profile. */
export function ProposedBy({ credit }) {
  const { t } = useDc()
  const { account, openProfile, needAccount } = useDaily()
  const name = personName(credit.user)
  const open = (e) => {
    e.stopPropagation()
    if (!account) { needAccount('view_profile'); return }
    openProfile(credit.user.id, name)
  }
  return (
    <button type="button" className="dc-proposed" onClick={open} style={INLINE}>
      <Icon name="bulb-outline" size={14} />
      {credit.city?.name
        ? t('propose.proposedByCity', { name, city: shortCityName(credit.city.name) })
        : t('propose.proposedBy', { name })}
    </button>
  )
}

// ── Votes: one shared store, so a proof shows the same count and heart on the
// sheet, the viewer and the top 3. Seeded from every proof list fetched. ─────

const votes = new Map()          // proofId → { voteCount, myVote, isMine, votingOpen, validatedByLocal }
let votesLeft = null
const listeners = new Set()
let version = 0
const emit = () => { version++; listeners.forEach(l => l()) }
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l) }

/** Share the vote state of these proofs (open = their challenge is still active). */
export function seedProofs(proofs, open) {
  proofs.filter(Boolean).forEach(p => {
    votes.set(p.id, {
      voteCount: p.voteCount, myVote: !!p.myVote, isMine: !!p.isMine,
      votingOpen: open && p.status === 'approved', validatedByLocal: !!p.validatedByLocal,
    })
  })
  emit()
}
export function seedVotesLeft(n) { votesLeft = n; emit() }

/** Seed from GET /daily/proofs/state (chat cards carry no vote state). */
export function seedStates(items, myVotes) {
  Object.entries(items || {}).forEach(([id, st]) => votes.set(id, { ...st }))
  if (myVotes) votesLeft = myVotes.left
  emit()
}

function useVotes() { useSyncExternalStore(subscribe, () => version) }

/** A proof's live vote count (the shared store's once seeded, else its own). */
export function useVoteCount(proof) {
  useVotes()
  return votes.get(proof.id)?.voteCount ?? proof.voteCount
}

/** My votes left today (null before the first read). */
export function useVotesLeft() {
  useVotes()
  return votesLeft
}

/**
 * Vote for a proof: heart, "Vote for Lisbon" on another city's answer ("Vote"
 * on my own city's), the count, my votes left while voting is open; tap again
 * to withdraw. Disabled on my own proof and once the challenge closed. Guests
 * get the sign-up gate ("Sign up to vote for Lisbon"). `source`: vote_cast.
 * On my own photo, `onShowVoters` turns it into the list of who voted.
 */
export function VoteButton({ proof, variant = 'tile', source = 'sheet_tile', onShowVoters }) {
  const { t } = useDc()
  const { account, cityId, needAccount } = useDaily()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useVotes()
  const state = votes.get(proof.id) ?? null
  const canVote = !!state && state.votingOpen && !state.isMine
  const ownCity = !!proof.city && cityId != null && Number(String(cityId).replace(/^city_/, '')) === proof.city.id
  const short = proof.city?.name ? shortCityName(proof.city.name) : null
  const voteLabel = !ownCity && short ? t('vote.voteFor', { city: short }) : t('vote.vote')
  const showVoters = !!onShowVoters && !!state?.isMine && state.voteCount > 0

  const click = async (e) => {
    e.stopPropagation()
    if (!state || busy) return
    if (showVoters) { onShowVoters(); return }
    if (!account) { needAccount('daily_vote', { city: short }); return }
    if (!canVote) return
    setBusy(true); setError(null)
    const action = state.myVote ? 'unvote' : 'vote'
    try {
      const r = state.myVote ? await unvoteDailyProof(proof.id) : await voteDailyProof(proof.id)
      votes.set(proof.id, { ...state, myVote: r.voted, voteCount: r.voteCount, validatedByLocal: r.validatedByLocal })
      votesLeft = r.votesLeft
      emit()
      track('daily_vote_cast', { action, challenge_date: proof.date, city: proof.city?.name ?? null, is_local: account.mode === 'local', platform_surface: 'web' })
      track('vote_cast', { action, source, challenge_date: proof.date, city: proof.city?.name ?? null, own_city: ownCity, platform_surface: 'web' })
    } catch (err) {
      setError(t(`vote.errors.${err.code}`, { defaultValue: t('vote.errors.generic') }))
    } finally {
      setBusy(false)
    }
  }

  const sub = state?.isMine ? t('vote.yours') : null

  return (
    <span className="dc-vote-wrap">
      <button type="button" onClick={click} disabled={!state || (!!account && !canVote && !showVoters)}
              className={`dc-vote dc-vote--${variant}${state?.myVote ? ' dc-vote--on' : ''}`}
              aria-pressed={!!state?.myVote} aria-label={showVoters ? t('vote.votersTitle') : state?.myVote ? t('vote.withdraw') : voteLabel}>
        <Icon name={state?.myVote ? 'heart' : 'heart-outline'} size={variant === 'tile' ? 14 : 16} />
        {state && (
          <span className="dc-vote-count">
            {variant !== 'tile' && !state.myVote && !state.isMine && state.votingOpen
              ? (variant === 'strip' ? t('vote.vote') : `${voteLabel} · ${state.voteCount}`) : state.voteCount}
          </span>
        )}
        {sub && variant !== 'tile' && variant !== 'strip' && <span className="dc-vote-sub">{sub}</span>}
        {showVoters && variant !== 'tile' && variant !== 'strip' && <Icon name="chevron-forward" size={13} />}
      </button>
      {error && <span className="dc-vote-error" role="status">{error}</span>}
    </span>
  )
}

/** One proof in a grid: photo (medal if World top 3), author, local/traveler, city, badges, caption, vote. */
export function ProofTile({ proof, onOpen }) {
  const { t } = useDc()
  const name = personName(proof.user)
  return (
    <div className="dc-tile" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}>
      <div className="dc-tile-photo">
        <img src={proof.thumbUrl || proof.photoUrl} onError={thumbFallback(proof.photoUrl)} alt={proof.caption || ''} loading="lazy" />
        {proof.worldRank !== null && proof.worldRank <= 3 && <span className="dc-tile-medal"><RankMedal rank={proof.worldRank} /></span>}
      </div>
      <div className="dc-tile-meta">
        <span className="dc-tile-name">{name} {proof.user.localPass && <LocalPassBadge />}</span>
        <span className="dc-tile-sub">
          <RoleLabel isLocal={proof.isLocal} suggestion={proof.suggestion} />
          {proof.city && <> · <CityName name={proof.city.name} country={proof.city.country} short /></>}
        </span>
        {proof.validatedByLocal && <span className="dc-tile-badge" style={INLINE}><Icon name="checkmark" size={12} />{t('validatedByLocal')}</span>}
        {proof.isEarly && <EarlyBadge />}
        {proof.answer && <AnswerChip answer={proof.answer} />}
        {proof.caption && <span className="dc-tile-caption">{proof.caption}</span>}
        {/* A Hilads suggestion is never voted on. */}
        {!proof.suggestion && <VoteButton proof={proof} variant="tile" />}
      </div>
    </div>
  )
}

const REPORT_REASONS = ['inappropriate', 'person_without_consent', 'dangerous', 'spam', 'other']

/** Full-screen photo of one proof: author, badges, caption, price, place, vote, report. */
export function ProofViewer({ proof, onClose }) {
  useBackLayer(!!proof, onClose)   // browser back closes it
  const { t } = useDc()
  const { account, needAccount, openSpot, openProfile } = useDaily()
  const [reporting, setReporting] = useState(false)
  const [voters, setVoters] = useState(null)   // null closed, 'loading', 'error' or the list
  useBackLayer(voters !== null, () => setVoters(null))   // the list closes before the photo
  useBackLayer(reporting, () => setReporting(false))   // the report menu closes before the photo
  const [notice, setNotice] = useState(null)
  const money = useMoney()
  if (!proof) return null
  const name = personName(proof.user)

  const showVoters = async () => {
    setVoters('loading')
    try { setVoters(await fetchDailyVoters(proof.id)) } catch { setVoters('error') }
  }

  const report = async (reason) => {
    setReporting(false)
    try {
      await reportDailyProof(proof.id, reason)
      setNotice(t('report.thanks'))
    } catch (err) {
      setNotice(err.status === 409 ? t('report.already') : t('vote.errors.generic'))
    }
  }

  // At the app root, above the tab bar (a screen's own layer would trap it);
  // #root is the desktop column, so the viewer stays inside it.
  return createPortal(
    <div className="dc-viewer" role="dialog" aria-modal="true">
      <button type="button" className="dc-viewer-close" onClick={onClose} aria-label={t('back')}><Icon name="close" size={22} /></button>
      {/* A blurred, darkened copy of the photo fills the space around it (landscape photos). */}
      <div className="dc-viewer-blur" style={{ backgroundImage: `url("${proof.thumbUrl || proof.photoUrl}")` }} aria-hidden="true" />
      <div className="dc-viewer-scroll">
      <img className="dc-viewer-photo" src={proof.photoUrl} alt={proof.caption || ''} />
      <div className="dc-viewer-meta">
        <div className="dc-viewer-name">
          {name} · <RoleLabel isLocal={proof.isLocal} suggestion={proof.suggestion} />
          {proof.city && <> · <CityName name={proof.city.name} country={proof.city.country} short /></>}
          {proof.user.localPass && <LocalPassBadge label onDark />}
          {proof.isEarly && <EarlyBadge onDark />}
        </div>
        {(proof.validatedByLocal || (proof.worldRank !== null && proof.worldRank <= 3)) && (
          <div className="dc-viewer-badge">
            {proof.worldRank !== null && proof.worldRank <= 3 && (
              <span style={INLINE}><RankMedal rank={proof.worldRank} size={20} />{t('results.worldRank', { rank: proof.worldRank })}</span>
            )}
            {proof.worldRank !== null && proof.worldRank <= 3 && proof.validatedByLocal ? '  ·  ' : ''}
            {proof.validatedByLocal && <span style={INLINE}><Icon name="checkmark" size={13} />{t('validatedByLocal')}</span>}
          </div>
        )}
        {/* The proof's challenge: "Drinks · How do locals say cheers?", then its text (a shared link lands here). */}
        {proof.context && (
          <div className="dc-viewer-context">
            <strong>{[proof.context.theme ? themeName(proof.context.theme.key, { special: proof.context.special, city: proof.city?.name }) : null,
              proof.context.question].filter(Boolean).join(' · ')}</strong>
            {proof.context.text && <span>{proof.context.text}</span>}
          </div>
        )}
        {proof.answer && !proof.backHome && <AnswerChip answer={proof.answer} onDark />}
        {proof.caption && <p className="dc-viewer-caption">{proof.caption}</p>}
        {proof.backHome && <BackHomeBlock proof={proof} />}
        {((proof.price && !proof.backHome) || proof.place || proof.spot) && (
          <p className="dc-viewer-extra">
            {proof.price && !proof.backHome && (
              // Converted to my currency, the original after it (SPEC 10.5).
              <span style={{ ...INLINE, marginRight: 12 }}><Icon name="cash-outline" size={13} />{money.price(proof.price).main}
                {money.price(proof.price).original && <small className="dc-price-original">{money.price(proof.price).original}</small>}</span>
            )}
            {proof.spot ? (
              <button type="button" className="dc-viewer-spot" style={INLINE} onClick={() => { onClose(); openSpot(proof.spot.id) }}><Icon name="location-outline" size={13} />{proof.spot.name}</button>
            ) : proof.place ? <span style={INLINE}><Icon name="location-outline" size={13} />{proof.place.name || t('unnamedPlace')}</span> : ''}
          </p>
        )}
        <div className="dc-viewer-actions">
          {proof.status === 'approved' && !proof.suggestion && <VoteButton proof={proof} variant="viewer" source="viewer" onShowVoters={proof.isMine ? showVoters : undefined} />}
          {!proof.isMine && (
            <button type="button" className="dc-viewer-report" onClick={() => (account ? setReporting(true) : needAccount('view_profile'))}>
              {t('report.title')}
            </button>
          )}
        </div>
        {notice && <p className="dc-viewer-notice" role="status">{notice}</p>}
      </div>
      </div>
      {voters !== null && (
        <div className="v3-sheet-wrap" role="dialog" aria-modal="true" aria-label={t('vote.votersTitle')}>
          <button type="button" className="v3-sheet-scrim" onClick={() => setVoters(null)} aria-label={t('back')} />
          <div className="v3-sheet">
            <span className="v3-sheet-grabber" aria-hidden="true" />
            <p className="v3-sheet-title">{t('vote.votersTitle')}</p>
            {voters === 'loading' ? <SheetSkeleton rows />
              : voters === 'error' ? <p className="dc-muted">{t('vote.errors.generic')}</p>
              : voters.length === 0 ? <p className="dc-muted">{t('vote.votersEmpty')}</p>
              : (
                <div className="dc-voters">
                  {voters.map(v => (
                    // A voter's profile opens over the app: the viewer closes first.
                    <button key={v.id} type="button" className="v3-scope-row" onClick={() => { setVoters(null); onClose(); openProfile(v.id, v.username) }}>
                      <AvatarWithFlag userId={v.id} displayName={personName(v)} photoUrl={v.photoUrl} size={40} />
                      <span className="v3-scope-row-body">
                        <span className="v3-scope-row-title">{personName(v)}</span>
                        {v.city && <span className="v3-scope-row-sub">{shortCityName(v.city)}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
          </div>
        </div>
      )}
      {reporting && (
        <div className="v3-sheet-wrap" role="dialog" aria-modal="true" aria-label={t('report.title')}>
          <button type="button" className="v3-sheet-scrim" onClick={() => setReporting(false)} aria-label={t('cancel')} />
          <div className="v3-sheet">
            <span className="v3-sheet-grabber" aria-hidden="true" />
            <p className="v3-sheet-title">{t('report.title')}</p>
            <p className="dc-muted">{t('report.body')}</p>
            {REPORT_REASONS.map(r => (
              <button key={r} type="button" className="v3-scope-row" onClick={() => report(r)}>
                <span className="v3-scope-row-body"><span className="v3-scope-row-title">{t(`report.reasons.${r}`)}</span></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.getElementById('root') ?? document.body,
  )
}

/**
 * Placeholders inside the challenge sheet while its photos or the Compare
 * board load (the sheet itself opens at once): a 2 x 2 grid of photo tiles,
 * or board rows. Never a full-page loader.
 */
export function SheetSkeleton({ rows = false }) {
  if (rows) {
    return (
      <div className="dc-skel-rows" aria-busy="true">
        {[60, 52, 44, 36].map(w => <div key={w} className="dc-skel-row"><span className="dc-skel dc-skel-flag" /><span className="dc-skel dc-skel-line" style={{ width: `${w}%` }} /></div>)}
      </div>
    )
  }
  return (
    <div className="dc-skel-grid" aria-busy="true">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="dc-skel-tile">
          <span className="dc-skel dc-skel-photo" />
          <span className="dc-skel dc-skel-line" style={{ width: '70%' }} />
          <span className="dc-skel dc-skel-line" style={{ width: '45%' }} />
        </div>
      ))}
    </div>
  )
}
