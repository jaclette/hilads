import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fetchChallengePrivacy,
  voteChallengePrivacy,
  clearChallengePrivacyVote,
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
  const [busy,    setBusy]    = useState(null) // 'vote' | 'withdraw'
  const [error,   setError]   = useState(null)

  const challengeId = challenge?.id ?? null
  const mode        = challenge?.mode ?? 'local'

  // Initial load — also re-runs when the panel becomes relevant.
  const loadPrivacy = useCallback(async () => {
    if (!challengeId) return
    const data = await fetchChallengePrivacy(challengeId)
    setPrivacy(data) // null is fine; UI hides the vote block
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

  // Non-participants get a 200 with isParticipant=false (the route used
  // to 403; we keep the gate but stop logging a red error in the console).
  // The Anonymize section is participants-only anyway, so the entire
  // panel collapses to nothing for visitors and friends-only viewers.
  if (!privacy) return null
  if (privacy.isParticipant === false) return null
  if (!currentUserId) return null

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

      {error && <p className="challenge-privacy-error" role="alert">{error}</p>}
    </section>
  )
}
