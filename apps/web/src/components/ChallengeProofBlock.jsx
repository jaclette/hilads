import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fetchProofs, submitProof, uploadImage,
} from '../api'
import Icon from './Icon'
import { mediumUrl } from '../lib/imageThumb'
import { thumbFallback } from '../lib/thumbFallback'

/**
 * Web mirror of mobile's ChallengeProofBlock - photo submission surface for a
 * GROUP photo-proof challenge (the joined taker's side; the challenger picks
 * the winner from the submissions gallery).
 *
 * Faces (same as mobile):
 *   - Acceptor with no pending proof → "Submit your proof" CTA (file input).
 *   - Acceptor with pending proof → media preview + waiting line.
 *   - Terminal (approved/closed) → compact status line.
 *
 * Media upload uses the existing /uploads POST (same as chat images).
 */
export default function ChallengeProofBlock({
  acceptanceId, iAmCreator, iAmAcceptor, proofRequirements, acceptancePhase, compact = false,
}) {
  const { t } = useTranslation('challenge')
  const [proofs,      setProofs]      = useState([])
  const [attempts,    setAttempts]    = useState(0)
  const [maxAttempts, setMaxAttempts] = useState(3)
  const [loading,     setLoading]     = useState(true)
  const [busy,        setBusy]        = useState(null)  // 'submit' | null
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const data = await fetchProofs(acceptanceId)
      setProofs(data.proofs)
      setAttempts(data.attempts)
      setMaxAttempts(data.maxAttempts)
    } catch {
      setProofs([])
    } finally {
      setLoading(false)
    }
  }, [acceptanceId])

  // PR57 - re-fetch when the parent's acceptancePhase changes. The
  // parent's WS-driven loadMyAcceptance flips the phase string
  // (proof_submitted → approved, etc.), and that's the signal that
  // the proof list / verdict-row state probably needs to refresh too.
  useEffect(() => { load() }, [load, acceptancePhase])

  const latest = proofs[0] ?? null
  const attemptsLeft = Math.max(0, maxAttempts - attempts)
  const isFinal = latest?.status === 'rejected' && attemptsLeft === 0

  // ── Acceptor: submit proof ──────────────────────────────────────────────
  // PR59 - geolocation prompt removed. Camera-only capture (mobile) +
  // file picker (web) are enough; asking the browser for GPS at submit
  // time was extra friction with no real upside, so the flow is now
  // just: pick → upload → submit.
  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setBusy('submit')

    try {
      // Use the shared helper - it posts to ${BASE}/uploads (the API host).
      // The old inline fetch used a relative '/api/v1/uploads', which hit the
      // web origin (Vercel) instead of the API → 405 Method Not Allowed.
      const { url } = await uploadImage(file)

      await submitProof(acceptanceId, {
        mediaUrl:  url,
        mediaType: 'image',
      })
      await load()
    } catch (err) {
      setError(err?.message || t('intl.proof.submitFailBody'))
    } finally {
      setBusy(null)
    }
  }, [acceptanceId, load, t])

  // ── Render ──────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="proof-block proof-block--loading">…</div>
  }

  if (latest?.status === 'approved') {
    return <div className="proof-block"><span className="proof-terminal"><Icon name="checkmark-circle-outline" size={16} /> {t('intl.proof.approvedLine')}</span></div>
  }
  if (latest?.status === 'rejected' && isFinal) {
    return (
      <div className="proof-block">
        <span className="proof-terminal">{t('intl.proof.closedLine')}</span>
        {latest.rejection_reason
          ? <span className="proof-reason">{t('intl.proof.lastReason', { reason: latest.rejection_reason })}</span>
          : null}
      </div>
    )
  }

  if (latest?.status === 'pending') {
    // The challenger has nothing to do here (they pick the winner from the
    // submissions gallery); the taker sees their photo + the waiting line.
    if (iAmCreator) return null
    return (
      <div className="proof-block">
        <img src={mediumUrl(latest.media_url)} onError={thumbFallback(latest.media_url)} alt="" className="proof-media" />
        <span className="proof-terminal">{t('intl.proof.waitingVerdict')}</span>
        {error ? <p className="proof-error">{error}</p> : null}
      </div>
    )
  }

  // No pending - submission CTA (acceptor) or nothing (creator). The
  // creator's "Waiting for the proof" line is gone - the pipeline pill
  // already says it. Block returns null for creators with no action,
  // so we don't surface an empty card.
  const lastRejected = latest?.status === 'rejected' ? latest : null
  if (!iAmAcceptor && !lastRejected) return null
  return (
    <div className={`proof-block${compact ? ' proof-block--compact' : ''}`}>
      {lastRejected ? (
        <span className="proof-reason">{t('intl.proof.lastReason', { reason: lastRejected.rejection_reason ?? '' })}</span>
      ) : null}
      {iAmAcceptor && (
        <label className={`proof-submit-btn${compact ? ' proof-submit-btn--compact' : ''}${busy ? ' is-busy' : ''}`}>
          {busy === 'submit' ? '…' : (lastRejected
            ? t('intl.proof.tryAgainCta', { count: attemptsLeft })
            : t('intl.proof.submitCta'))}
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
            disabled={!!busy}
          />
        </label>
      )}
      {error ? <p className="proof-error">{error}</p> : null}
    </div>
  )
}
