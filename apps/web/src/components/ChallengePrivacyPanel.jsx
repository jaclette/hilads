import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fetchChallengePrivacy,
  voteChallengePrivacy,
  clearChallengePrivacyVote,
  fetchMyChallengeParticipation,
  setChallengeNotificationPreference,
  setChallengeCloseToJoins,
} from '../api'

const NOTIF_OPTIONS = ['milestones', 'all', 'off']

/**
 * Per-challenge privacy controls. Visible only to participants (creator or
 * acceptor) — non-participants get isParticipant=false and we render nothing.
 *
 * Sections:
 *   1. Current visibility line (Public / Friends / Private) — trust signal.
 *   2. Mutual go-private vote (Local only; Intl is locked Public with a note).
 *
 * Retroactive anonymization was dropped — pseudonymous-by-default identities
 * (chosen username + avatar) already serve that need, and the SSR layer keeps
 * member usernames out of indexable HTML/JSON-LD.
 *
 * Props:
 *   challenge — full challenge object (we read visibility + mode + created_by)
 *   currentUserId — logged-in user id (null = anon; component shouldn't render)
 *   onVisibilityChanged — callback after a successful flip to private so the
 *                         parent can re-fetch the challenge (visibility badge,
 *                         comment lane gating).
 */
export default function ChallengePrivacyPanel({ challenge, currentUserId, onVisibilityChanged }) {
  const { t } = useTranslation('challenge')

  const [privacy,        setPrivacy]        = useState(null) // { currentVisibility, myVote, ... }
  const [participation,  setParticipation]  = useState(null) // { isIn, notificationPreference }
  const [busy,           setBusy]           = useState(null) // 'vote' | 'withdraw' | 'notif' | 'close'
  const [error,          setError]          = useState(null)

  // Local mirror of the close-to-joins flag so the toggle reflects state
  // immediately on flip without waiting for the parent to re-fetch the
  // challenge row.
  const [closedToJoins, setClosedToJoins] = useState(() => !!challenge?.closed_to_new_joins)
  useEffect(() => { setClosedToJoins(!!challenge?.closed_to_new_joins) }, [challenge?.closed_to_new_joins])

  const challengeId = challenge?.id ?? null
  const mode        = challenge?.mode ?? 'local'

  const loadPrivacy = useCallback(async () => {
    if (!challengeId) return
    const data = await fetchChallengePrivacy(challengeId)
    setPrivacy(data)
  }, [challengeId])

  const loadParticipation = useCallback(async () => {
    if (!challengeId || !currentUserId) { setParticipation(null); return }
    const data = await fetchMyChallengeParticipation(challengeId)
    setParticipation(data ?? null)
  }, [challengeId, currentUserId])

  useEffect(() => { loadPrivacy() },       [loadPrivacy])
  useEffect(() => { loadParticipation() }, [loadParticipation])

  async function handleVote(vote) {
    if (busy) return
    setBusy('vote')
    setError(null)
    try {
      const res = await voteChallengePrivacy(challengeId, vote)
      // Re-read so myVote/creatorVote/acceptorVote stay aligned even when
      // the server's silent flip resets the rows.
      await loadPrivacy()
      if (res?.flippedToPrivate) onVisibilityChanged?.('private')
    } catch (err) {
      setError(err?.message || t('privacy.errVote'))
    } finally {
      setBusy(null)
    }
  }

  async function handleWithdraw() {
    if (busy) return
    setBusy('withdraw')
    setError(null)
    try {
      await clearChallengePrivacyVote(challengeId)
      await loadPrivacy()
    } catch (err) {
      setError(err?.message || t('privacy.errVote'))
    } finally {
      setBusy(null)
    }
  }

  async function handleNotifChange(pref) {
    if (busy) return
    setBusy('notif')
    setError(null)
    try {
      await setChallengeNotificationPreference(challengeId, pref)
      // Optimistic; the server already validated the enum.
      setParticipation(prev => prev ? { ...prev, notificationPreference: pref } : prev)
    } catch (err) {
      setError(err?.message || t('privacy.errSave'))
    } finally {
      setBusy(null)
    }
  }

  async function handleToggleClosed() {
    if (busy) return
    const next = !closedToJoins
    setBusy('close')
    setError(null)
    try {
      await setChallengeCloseToJoins(challengeId, next)
      setClosedToJoins(next)
      onVisibilityChanged?.(privacy?.currentVisibility ?? null)
    } catch (err) {
      setError(err?.message || t('privacy.errSave'))
    } finally {
      setBusy(null)
    }
  }

  // The panel renders for anyone in the channel — creator + active taker
  // (privacy.isParticipant=true) get the mutual-vote block; channel joiners
  // also see the visibility line + notification preference. Non-channel
  // viewers collapse the whole surface.
  const isInChannel = !!participation?.isIn
  if (!privacy)         return null
  if (!currentUserId)   return null
  if (!isInChannel)     return null

  const v = privacy.currentVisibility ?? 'public'
  const isCreator  = challenge?.created_by === currentUserId
  // Acceptor inference — the server returns acceptorUserId on the privacy
  // payload so we don't have to fetch acceptances here.
  const isAcceptor = privacy.acceptorUserId === currentUserId
  const showVote   = (isCreator || isAcceptor) && mode === 'local' && v !== 'private'

  return (
    <section className="challenge-privacy">
      <h3 className="challenge-privacy-title">{t('privacy.panelTitle')}</h3>

      {/* Current state — a single line that mirrors what visitors see. */}
      <p className={`challenge-privacy-line challenge-privacy-line--${v}`}>
        {t(v === 'private' ? 'privacy.currentPrivate'
            : v === 'friends' ? 'privacy.currentFriends'
            : 'privacy.currentPublic')}
      </p>

      {/* International note — the mutual flow is locked off. */}
      {mode === 'international' && (
        <p className="challenge-privacy-hint">{t('privacy.intlNote')}</p>
      )}

      {/* Vote panel — Local rows only, both sides need to agree. */}
      {showVote && (
        <div className="challenge-privacy-vote">
          {!privacy.canVote && (
            <p className="challenge-privacy-hint">{t('privacy.needCounterparty')}</p>
          )}
          {privacy.canVote && (
            <>
              {/* What's already happened — tell the user where the dance
                  stands without making them parse the raw vote rows. */}
              {privacy.myVote === 'agreed' && (
                <p className="challenge-privacy-status">{t('privacy.myVoteAgreed')}</p>
              )}
              {privacy.myVote === 'denied' && (
                <p className="challenge-privacy-status">{t('privacy.myVoteDenied')}</p>
              )}
              {/* The other side's vote message only renders when it's
                  meaningful (i.e. they've actually voted). */}
              {(() => {
                const otherVote = isCreator ? privacy.acceptorVote : privacy.creatorVote
                if (otherVote === 'agreed' && privacy.myVote !== 'agreed') {
                  return <p className="challenge-privacy-status challenge-privacy-status--prompt">{t('privacy.otherVoteAgreed')}</p>
                }
                if (otherVote === 'denied') {
                  return <p className="challenge-privacy-status">{t('privacy.otherVoteDenied')}</p>
                }
                return null
              })()}

              <div className="challenge-privacy-actions">
                {privacy.myVote !== 'agreed' && (
                  <button
                    type="button"
                    className="challenge-privacy-btn challenge-privacy-btn--primary"
                    onClick={() => handleVote('agreed')}
                    disabled={busy !== null}
                  >
                    {busy === 'vote' ? '…' : t('privacy.voteAgreedCta')}
                  </button>
                )}
                {privacy.myVote !== 'denied' && (
                  <button
                    type="button"
                    className="challenge-privacy-btn challenge-privacy-btn--ghost"
                    onClick={() => handleVote('denied')}
                    disabled={busy !== null}
                  >
                    {t('privacy.voteDeniedCta')}
                  </button>
                )}
                {privacy.myVote && (
                  <button
                    type="button"
                    className="challenge-privacy-btn challenge-privacy-btn--ghost"
                    onClick={handleWithdraw}
                    disabled={busy !== null}
                  >
                    {busy === 'withdraw' ? '…' : t('privacy.withdrawCta')}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Notification preference — any channel participant can tune this.
          'milestones' (default) = taker accept + proof submit + final
          validation. 'all' = every message. 'off' = silent (still has
          read access). */}
      <div className="challenge-privacy-notif">
        <h4 className="challenge-privacy-subtitle">{t('privacy.notifTitle')}</h4>
        <div className="challenge-privacy-notif-options" role="radiogroup">
          {NOTIF_OPTIONS.map(opt => {
            const selected = (participation?.notificationPreference ?? 'milestones') === opt
            return (
              <button
                key={opt}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={busy === 'notif'}
                className={`challenge-privacy-notif-opt ${selected ? 'challenge-privacy-notif-opt--active' : ''}`}
                onClick={() => handleNotifChange(opt)}
              >
                <span className="challenge-privacy-notif-opt-label">{t(`privacy.notif.${opt}`)}</span>
                <span className="challenge-privacy-notif-opt-hint">{t(`privacy.notifHint.${opt}`)}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Close-to-new-joins — creator-only toggle. Existing participants
          stay; the Join CTA on the public detail page refuses new joins
          while this is on. */}
      {isCreator && (
        <div className="challenge-privacy-closed">
          <h4 className="challenge-privacy-subtitle">{t('privacy.closedTitle')}</h4>
          <p className="challenge-privacy-hint">{t('privacy.closedBody')}</p>
          <button
            type="button"
            className={`challenge-privacy-btn ${closedToJoins ? 'challenge-privacy-btn--primary' : 'challenge-privacy-btn--ghost'}`}
            disabled={busy === 'close'}
            onClick={handleToggleClosed}
          >
            {busy === 'close'
              ? '…'
              : (closedToJoins ? t('privacy.closedReopenCta') : t('privacy.closedCloseCta'))}
          </button>
        </div>
      )}

      {error && <p className="challenge-privacy-error" role="alert">{error}</p>}
    </section>
  )
}
