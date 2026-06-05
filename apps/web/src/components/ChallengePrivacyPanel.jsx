import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fetchChallengePrivacy,
  voteChallengePrivacy,
  clearChallengePrivacyVote,
  setChallengeCloseToJoins,
} from '../api'

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

  const [privacy, setPrivacy] = useState(null) // { currentVisibility, myVote, ... }
  const [busy,    setBusy]    = useState(null) // 'vote' | 'withdraw' | 'close'
  const [error,   setError]   = useState(null)

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

  useEffect(() => { loadPrivacy() }, [loadPrivacy])

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

  // Panel narrows to creator + active taker only. Regular channel
  // participants see the compact notifications toggle alongside the
  // members bar instead — the visibility line + per-message radio that
  // used to live here added noise without value for them.
  //
  // ORDER MATTERS: guard before any `privacy.*` read or the panel
  // crashes the whole page while the GET /privacy request is still
  // in flight on first mount.
  if (!privacy)                  return null
  if (!currentUserId)            return null
  const v          = privacy.currentVisibility ?? 'public'
  const isCreator  = challenge?.created_by  === currentUserId
  const isAcceptor = privacy.acceptorUserId === currentUserId
  if (!isCreator && !isAcceptor) return null

  const showVote = mode === 'local' && v !== 'private'

  return (
    <section className="challenge-privacy">
      <h3 className="challenge-privacy-title">{t('privacy.panelTitle')}</h3>

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

      {/* Notification preference moved out of this panel. Channel
          participants get the compact on/off pill in the toolbar above
          (ChallengeNotificationToggle); creator/taker access it the
          same way. */}

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
