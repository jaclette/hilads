import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { voteDailyProof, unvoteDailyProof, reportDailyProof } from '../../api'
import { localizeCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'

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

export const MEDALS = ['🥇', '🥈', '🥉']

export const COUNTDOWN_WARNING_SECONDS = 3 * 3600
export const isFinalHours = (s) => s !== null && s <= COUNTDOWN_WARNING_SECONDS

/** "6h 12m" / "12m" / "45s". */
export function formatCountdown(seconds) {
  if (seconds === null || seconds === undefined) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m`
  return `${seconds}s`
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
  return <span className={`dc-pass${onDark ? ' dc-pass--dark' : ''}`} aria-label={t('localPass.badgeA11y')}>🎫{label ? ` ${t('localPass.name')}` : ''}</span>
}

export function EarlyBadge({ onDark = false }) {
  const { t } = useDc()
  return <span className={`dc-early${onDark ? ' dc-early--dark' : ''}`}>⚡ {t('early.badge')}</span>
}

/** "In review" / "Published" / "Not published" / "Removed" for my proof. */
export function StatusChip({ status }) {
  const { t } = useDc()
  const tone = status === 'approved' ? 'ok' : status === 'pending' ? 'wait' : 'bad'
  const icon = status === 'approved' ? '✅' : status === 'pending' ? '⏳' : '⚠️'
  return <span className={`dc-status dc-status--${tone}`}>{icon} {t(`status.${status}`)}</span>
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
    <button type="button" className="dc-proposed" onClick={open}>
      💡 {credit.city?.name
        ? t('propose.proposedByCity', { name, city: localizeCityName(credit.city.name) })
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

/**
 * Vote for a proof: heart + count, my votes left while voting is open; tap
 * again to withdraw. Disabled on my own proof and once the challenge closed.
 * Guests get the sign-up gate.
 */
export function VoteButton({ proof, variant = 'tile' }) {
  const { t } = useDc()
  const { account, needAccount } = useDaily()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useVotes()
  const state = votes.get(proof.id) ?? null
  const canVote = !!state && state.votingOpen && !state.isMine

  const click = async (e) => {
    e.stopPropagation()
    if (!state || busy) return
    if (!account) { needAccount('daily_vote'); return }
    if (!canVote) return
    if (!state.myVote && votesLeft === 0) { setError(t('vote.noneLeft')); return }
    setBusy(true); setError(null)
    const action = state.myVote ? 'unvote' : 'vote'
    try {
      const r = state.myVote ? await unvoteDailyProof(proof.id) : await voteDailyProof(proof.id)
      votes.set(proof.id, { ...state, myVote: r.voted, voteCount: r.voteCount, validatedByLocal: r.validatedByLocal })
      votesLeft = r.votesLeft
      emit()
      track('daily_vote_cast', { action, challenge_date: proof.date, city: proof.city?.name ?? null, is_local: account.mode === 'local', platform_surface: 'web' })
    } catch (err) {
      setError(t(`vote.errors.${err.code}`, { defaultValue: t('vote.errors.generic') }))
    } finally {
      setBusy(false)
    }
  }

  const sub = !state ? null
    : state.isMine ? t('vote.yours')
    : !state.votingOpen ? null
    : account && votesLeft !== null ? t('vote.left', { count: votesLeft })
    : null

  return (
    <span className="dc-vote-wrap">
      <button type="button" onClick={click} disabled={!state || (!!account && !canVote)}
              className={`dc-vote dc-vote--${variant}${state?.myVote ? ' dc-vote--on' : ''}`}
              aria-pressed={!!state?.myVote} aria-label={state?.myVote ? t('vote.withdraw') : t('vote.vote')}>
        <span aria-hidden="true">{state?.myVote ? '♥' : '♡'}</span>
        {state && <span className="dc-vote-count">{state.voteCount}</span>}
        {sub && variant !== 'tile' && <span className="dc-vote-sub">{sub}</span>}
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
        <img src={proof.thumbUrl || proof.photoUrl} alt={proof.caption || ''} loading="lazy" />
        {proof.worldRank !== null && proof.worldRank <= 3 && <span className="dc-tile-medal">{MEDALS[proof.worldRank - 1]}</span>}
      </div>
      <div className="dc-tile-meta">
        <span className="dc-tile-name">{name} {proof.user.localPass && <LocalPassBadge />}</span>
        <span className="dc-tile-sub">
          {proof.isLocal ? `🌍 ${t('local')}` : `🧭 ${t('traveler')}`}
          {proof.city ? ` · ${localizeCityName(proof.city.name)}` : ''}
        </span>
        {proof.validatedByLocal && <span className="dc-tile-badge">✓ {t('validatedByLocal')}</span>}
        {proof.isEarly && <EarlyBadge />}
        {proof.caption && <span className="dc-tile-caption">{proof.caption}</span>}
        <VoteButton proof={proof} variant="tile" />
      </div>
    </div>
  )
}

const REPORT_REASONS = ['inappropriate', 'person_without_consent', 'dangerous', 'spam', 'other']

/** Full-screen photo of one proof: author, badges, caption, price, place, vote, report. */
export function ProofViewer({ proof, onClose }) {
  const { t, i18n } = useDc()
  const { account, needAccount, openSpot } = useDaily()
  const [reporting, setReporting] = useState(false)
  const [notice, setNotice] = useState(null)
  if (!proof) return null
  const name = personName(proof.user)

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
      <button type="button" className="dc-viewer-close" onClick={onClose} aria-label={t('back')}>✕</button>
      <img className="dc-viewer-photo" src={proof.photoUrl} alt={proof.caption || ''} />
      <div className="dc-viewer-meta">
        <div className="dc-viewer-name">
          {name} · {proof.isLocal ? `🌍 ${t('local')}` : `🧭 ${t('traveler')}`}
          {proof.city ? ` · ${localizeCityName(proof.city.name)}` : ''}
          {proof.user.localPass && <LocalPassBadge label onDark />}
          {proof.isEarly && <EarlyBadge onDark />}
        </div>
        {(proof.validatedByLocal || (proof.worldRank !== null && proof.worldRank <= 3)) && (
          <div className="dc-viewer-badge">
            {proof.worldRank !== null && proof.worldRank <= 3 ? `${MEDALS[proof.worldRank - 1]} ${t('results.worldRank', { rank: proof.worldRank })}` : ''}
            {proof.worldRank !== null && proof.worldRank <= 3 && proof.validatedByLocal ? '  ·  ' : ''}
            {proof.validatedByLocal ? `✓ ${t('validatedByLocal')}` : ''}
          </div>
        )}
        {proof.caption && <p className="dc-viewer-caption">{proof.caption}</p>}
        {(proof.price || proof.place || proof.spot) && (
          <p className="dc-viewer-extra">
            {proof.price ? `💸 ${formatAmount(proof.price.amount, i18n.language)} ${proof.price.currency}   ` : ''}
            {proof.spot ? (
              <button type="button" className="dc-viewer-spot" onClick={() => { onClose(); openSpot(proof.spot.id) }}>📍 {proof.spot.name}</button>
            ) : proof.place ? `📍 ${proof.place.name || t('unnamedPlace')}` : ''}
          </p>
        )}
        <div className="dc-viewer-actions">
          {proof.status === 'approved' && <VoteButton proof={proof} variant="viewer" />}
          {!proof.isMine && (
            <button type="button" className="dc-viewer-report" onClick={() => (account ? setReporting(true) : needAccount('view_profile'))}>
              {t('report.title')}
            </button>
          )}
        </div>
        {notice && <p className="dc-viewer-notice" role="status">{notice}</p>}
      </div>
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
