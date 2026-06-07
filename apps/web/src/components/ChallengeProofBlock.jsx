import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fetchProofs, submitProof, approveProof, rejectProof,
} from '../api'

/**
 * Web mirror of mobile's ChallengeProofBlock — proof submission +
 * verdict surface for International challenges.
 *
 * Three faces (same as mobile):
 *   - Acceptor with no pending proof → "Submit your proof" CTA
 *     (file input + browser geolocation; mandatory both).
 *   - Acceptor with pending proof → media preview + waiting line.
 *   - Creator with pending proof → preview + Approve / Reject buttons.
 *     Reject opens a reason input (1–200 chars, mandatory).
 *   - Terminal (approved/closed) → compact status line.
 *
 * Media upload uses the existing /uploads POST (same as chat images).
 */
export default function ChallengeProofBlock({
  acceptanceId, iAmCreator, iAmAcceptor, proofRequirements, acceptancePhase,
}) {
  const { t } = useTranslation('challenge')
  const [proofs,      setProofs]      = useState([])
  const [attempts,    setAttempts]    = useState(0)
  const [maxAttempts, setMaxAttempts] = useState(3)
  const [loading,     setLoading]     = useState(true)
  const [busy,        setBusy]        = useState(null)  // 'submit' | 'approve' | 'reject' | null
  const [rejectOpen,  setRejectOpen]  = useState(false)
  const [rejectReason, setRejectReason] = useState('')
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

  // PR57 — re-fetch when the parent's acceptancePhase changes. The
  // parent's WS-driven loadMyAcceptance flips the phase string
  // (proof_submitted → approved, etc.), and that's the signal that
  // the proof list / verdict-row state probably needs to refresh too.
  useEffect(() => { load() }, [load, acceptancePhase])

  const latest = proofs[0] ?? null
  const attemptsLeft = Math.max(0, maxAttempts - attempts)
  const isFinal = latest?.status === 'rejected' && attemptsLeft === 0

  // ── Acceptor: submit proof ──────────────────────────────────────────────
  // PR59 — geolocation prompt removed. Camera-only capture (mobile) +
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
      const form = new FormData()
      form.append('file', file)
      const uploadRes = await fetch('/api/v1/uploads', {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      if (!uploadRes.ok) throw new Error('upload failed')
      const { url } = await uploadRes.json()

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

  // ── Creator: approve / reject ───────────────────────────────────────────
  const handleApprove = useCallback(async () => {
    if (!latest || busy) return
    setBusy('approve')
    try {
      await approveProof(latest.id)
      await load()
    } catch (err) {
      setError(err?.message || t('intl.proof.reviewFailTitle'))
    } finally {
      setBusy(null)
    }
  }, [latest, busy, load, t])

  const handleReject = useCallback(async () => {
    if (!latest || busy) return
    const reason = rejectReason.trim()
    if (reason.length === 0 || reason.length > 200) {
      setError(t('intl.proof.reasonRequiredBody'))
      return
    }
    setBusy('reject')
    try {
      await rejectProof(latest.id, reason)
      setRejectOpen(false)
      setRejectReason('')
      await load()
    } catch (err) {
      setError(err?.message || t('intl.proof.reviewFailTitle'))
    } finally {
      setBusy(null)
    }
  }, [latest, busy, rejectReason, load, t])

  // ── Render ──────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="proof-block proof-block--loading">…</div>
  }

  if (latest?.status === 'approved') {
    return <div className="proof-block"><span className="proof-terminal">🎉 {t('intl.proof.approvedLine')}</span></div>
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
    // PR62 — creator's verdict UI moved into ProofReviewModal (opens
    // from the pipeline's "Review the proof" sub-CTA). The photo lives
    // in the chat thread above already, so leaving a duplicate photo +
    // button pair here was noise. Skip the card entirely for creators;
    // acceptors still see the "Waiting for verdict" line.
    if (iAmCreator) return null
    return (
      <div className="proof-block">
        <img src={latest.media_url} alt="" className="proof-media" />
        {/* PR59 — geotag chip removed; we no longer ask the client for
            coordinates, so a "geotag verified" badge would be misleading. */}
        {iAmCreator ? (
          <div className="proof-verdict-row">
            <button
              type="button"
              className="proof-verdict-btn proof-verdict-btn--approve"
              onClick={handleApprove}
              disabled={!!busy}
            >
              {busy === 'approve' ? '…' : `✓ ${t('intl.proof.approveCta')}`}
            </button>
            <button
              type="button"
              className="proof-verdict-btn proof-verdict-btn--reject"
              onClick={() => setRejectOpen(true)}
              disabled={!!busy}
            >
              ✕ {t('intl.proof.rejectCta')}
            </button>
          </div>
        ) : (
          <span className="proof-terminal">{t('intl.proof.waitingVerdict')}</span>
        )}
        {error ? <p className="proof-error">{error}</p> : null}

        {rejectOpen && (
          <div className="modal-overlay" onClick={() => !busy && setRejectOpen(false)}>
            <div className="modal-panel proof-reject-modal" onClick={e => e.stopPropagation()}>
              <p className="proof-reject-title">{t('intl.proof.rejectModalTitle')}</p>
              <p className="proof-reject-hint">{t('intl.proof.rejectModalHint', { count: attemptsLeft })}</p>
              <textarea
                className="proof-reason-input"
                rows={3}
                maxLength={200}
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder={t('intl.proof.reasonPlaceholder')}
                autoFocus
              />
              <span className="proof-charcount">{rejectReason.length} / 200</span>
              <button
                type="button"
                className="proof-reject-submit"
                onClick={handleReject}
                disabled={!rejectReason.trim() || busy === 'reject'}
              >
                {busy === 'reject' ? '…' : t('intl.proof.rejectConfirm')}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // No pending — submission CTA (acceptor) or nothing (creator). The
  // creator's "Waiting for the proof" line is gone — the pipeline pill
  // already says it. Block returns null for creators with no action,
  // so we don't surface an empty card.
  const lastRejected = latest?.status === 'rejected' ? latest : null
  if (!iAmAcceptor && !lastRejected) return null
  return (
    <div className="proof-block">
      {lastRejected ? (
        <span className="proof-reason">{t('intl.proof.lastReason', { reason: lastRejected.rejection_reason ?? '' })}</span>
      ) : null}
      {iAmAcceptor && (
        <label className={`proof-submit-btn${busy ? ' is-busy' : ''}`}>
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
