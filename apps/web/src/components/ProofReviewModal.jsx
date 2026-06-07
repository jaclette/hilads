import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchProofs, approveProof, rejectProof } from '../api'

/**
 * Web mirror of mobile's ProofReviewModal. Opens from the lifecycle
 * pipeline's "Review the proof" sub-CTA on intl challenges when the
 * creator's acceptance is at phase='proof_submitted'.
 *
 * Surfaces the proof photo big + Approve / Reject. Reject swaps the
 * sheet into a reason-prompt face (1-200 chars, mandatory). On
 * success the modal calls onVerdict + closes; the backend also fires
 * a WS broadcast (challenge_accepted event) to both sides so the
 * other party's screen refreshes without a manual reload.
 */
export default function ProofReviewModal({ visible, onClose, acceptanceId, onVerdict }) {
  const { t } = useTranslation('challenge')

  const [proof,        setProof]        = useState(null)
  const [attemptsLeft, setAttemptsLeft] = useState(3)
  const [loading,      setLoading]      = useState(true)
  const [busy,         setBusy]         = useState(null) // 'approve' | 'reject' | null
  const [mode,         setMode]         = useState('verdict') // 'verdict' | 'reason'
  const [reason,       setReason]       = useState('')
  const [error,        setError]        = useState(null)

  useEffect(() => {
    if (!visible) return
    setMode('verdict'); setReason(''); setError(null); setBusy(null); setLoading(true)
    ;(async () => {
      try {
        const data = await fetchProofs(acceptanceId)
        const latestPending = data.proofs.find(p => p.status === 'pending') ?? null
        setProof(latestPending)
        setAttemptsLeft(Math.max(0, data.maxAttempts - data.attempts))
      } catch {
        setProof(null)
      } finally {
        setLoading(false)
      }
    })()
  }, [visible, acceptanceId])

  const handleApprove = useCallback(async () => {
    if (!proof || busy) return
    setBusy('approve'); setError(null)
    try {
      await approveProof(proof.id)
      onVerdict?.()
      onClose()
    } catch (e) {
      setError(e?.message || t('intl.proof.reviewFailTitle'))
    } finally {
      setBusy(null)
    }
  }, [proof, busy, onClose, onVerdict, t])

  const handleReject = useCallback(async () => {
    if (!proof || busy) return
    const r = reason.trim()
    if (r.length === 0 || r.length > 200) {
      setError(t('intl.proof.reasonRequiredBody'))
      return
    }
    setBusy('reject'); setError(null)
    try {
      await rejectProof(proof.id, r)
      onVerdict?.()
      onClose()
    } catch (e) {
      setError(e?.message || t('intl.proof.reviewFailTitle'))
    } finally {
      setBusy(null)
    }
  }, [proof, busy, reason, onClose, onVerdict, t])

  if (!visible) return null

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal-panel proof-review-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            {mode === 'verdict'
              ? t('intl.proof.reviewModalTitle', { defaultValue: 'Review the proof' })
              : t('intl.proof.rejectModalTitle')}
          </span>
          <button className="going-modal-close" onClick={onClose} disabled={!!busy} aria-label="Close">✕</button>
        </div>

        <div className="proof-review-body">
          {loading ? (
            <div className="proof-review-loading">…</div>
          ) : !proof ? (
            <div className="proof-review-empty">{t('intl.proof.waitingVerdict')}</div>
          ) : (
            <>
              <img src={proof.media_url} alt="" className="proof-review-media" />

              {mode === 'verdict' ? (
                <div className="proof-review-actions">
                  <button
                    type="button"
                    className="proof-review-btn proof-review-btn--reject"
                    onClick={() => { setError(null); setMode('reason') }}
                    disabled={!!busy}
                  >
                    ✕ {t('intl.proof.rejectCta')}
                  </button>
                  <button
                    type="button"
                    className="proof-review-btn proof-review-btn--approve"
                    onClick={handleApprove}
                    disabled={!!busy}
                  >
                    {busy === 'approve' ? '…' : `✓ ${t('intl.proof.approveCta')}`}
                  </button>
                </div>
              ) : (
                <div className="proof-review-reason">
                  <p className="proof-review-hint">{t('intl.proof.rejectModalHint', { count: attemptsLeft })}</p>
                  <textarea
                    className="proof-review-reason-input"
                    rows={3}
                    maxLength={200}
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder={t('intl.proof.reasonPlaceholder')}
                    autoFocus
                  />
                  <span className="proof-review-charcount">{reason.length} / 200</span>
                  <div className="proof-review-actions">
                    <button
                      type="button"
                      className="proof-review-btn proof-review-btn--secondary"
                      onClick={() => { setReason(''); setError(null); setMode('verdict') }}
                      disabled={!!busy}
                    >
                      {t('cancel', { defaultValue: 'Back' })}
                    </button>
                    <button
                      type="button"
                      className="proof-review-btn proof-review-btn--reject"
                      onClick={handleReject}
                      disabled={!reason.trim() || busy === 'reject'}
                    >
                      {busy === 'reject' ? '…' : t('intl.proof.rejectConfirm')}
                    </button>
                  </div>
                </div>
              )}

              {error ? <p className="proof-review-error">{error}</p> : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
