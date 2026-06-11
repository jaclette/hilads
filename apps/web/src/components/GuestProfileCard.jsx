import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import BackButton from './BackButton'
import { localizeCityName } from '../i18n/cityName'
import { submitReport, fetchReportStatus, DuplicateReportError } from '../api'

// ── Avatar palette - mirrors App.jsx / PublicProfileScreen ────────────────────

const AVATAR_PALETTES = [
  ['#7c6aff', '#c084fc'], ['#ff6a9f', '#fb7185'], ['#22d3ee', '#38bdf8'],
  ['#4ade80', '#34d399'], ['#fb923c', '#fbbf24'], ['#f472b6', '#e879f9'],
  ['#818cf8', '#60a5fa'], ['#2dd4bf', '#a3e635'],
]

function avatarColors(name) {
  const hash = (name || '?').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GuestProfileCard({ guestId, nickname, cityName, account, guest, onBack }) {
  const { t, i18n } = useTranslation()
  const name    = nickname || 'Ghost'
  const initial = name[0].toUpperCase()
  const [c1, c2] = avatarColors(name)

  // Report state - mirrors PublicProfileScreen, but targets a guest_id so the
  // report lands in the moderation queue as a guest target (→ "Ban guest" in BO).
  const [showReportForm, setShowReportForm] = useState(false)
  const [reportReason,   setReportReason]   = useState('')
  const [reportBusy,     setReportBusy]     = useState(false)
  const [reportSent,     setReportSent]     = useState(false)
  const [reportError,    setReportError]    = useState(null)
  const [existingReport, setExistingReport] = useState(null) // { id, created_at, status } | null

  // Preflight: has this viewer already reported this guest?
  useEffect(() => {
    let alive = true
    setExistingReport(null)
    setShowReportForm(false)
    setReportReason('')
    setReportError(null)
    if (!guestId) return
    fetchReportStatus({
      guestId:       account ? undefined : guest?.guestId,
      targetGuestId: guestId,
    })
      .then(r => { if (alive) setExistingReport(r?.reported ? (r.existing_report ?? null) : null) })
      .catch(() => { /* status preflight is best-effort */ })
    return () => { alive = false }
  }, [guestId, account, guest])

  async function handleSubmitReport(e) {
    e.preventDefault()
    const reason = reportReason.trim()
    if (reason.length < 10 || reportBusy) return
    setReportBusy(true)
    setReportError(null)
    try {
      await submitReport({
        reason,
        guestId:        account ? undefined : guest?.guestId,
        targetGuestId:  guestId,
        targetNickname: name,
      })
      setReportSent(true)
      setReportReason('')
      setTimeout(() => { setShowReportForm(false); setReportSent(false) }, 2500)
    } catch (err) {
      if (err instanceof DuplicateReportError) {
        setExistingReport(err.existing)
        setReportReason('')
      } else {
        setReportError(err?.message ?? t('report.error'))
      }
    } finally {
      setReportBusy(false)
    }
  }

  return (
    <div className="full-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">Profile</span>
      </div>

      <div className="pub-profile-body">
        <div className="pub-profile-hero">
          <span
            className="msg-avatar pub-profile-avatar"
            style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
          >
            {initial}
          </span>
          <div className="pub-profile-name">{name}</div>
          <div className="guest-profile-badge">👻 Ghost</div>
          {cityName && (
            <div className="guest-profile-city">Visiting {localizeCityName(cityName)}</div>
          )}
        </div>

        <p className="guest-profile-note">
          Floating around as a ghost 👻
        </p>

        {/* Report a guest - the only moderation action available on a ghost
            (guests have no account, so no friend/DM/block on web yet). */}
        <div className="pub-profile-actions" style={{ justifyContent: 'center', marginTop: 8 }}>
          <button
            className="pub-profile-report-btn"
            onClick={() => { setShowReportForm(f => !f); setReportSent(false); setReportError(null) }}
            title={t('actions.reportTitle')}
          >
            🚩
          </button>
        </div>

        {showReportForm && (
          <div className="pub-profile-report-form-wrap">
            {existingReport ? (
              <p className="pub-profile-report-sent">
                {t('report.existing', { date: new Date(existingReport.created_at).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric', year: 'numeric' }) })}
              </p>
            ) : reportSent ? (
              <p className="pub-profile-report-sent">{t('report.sent')}</p>
            ) : (
              <form className="pub-profile-report-form" onSubmit={handleSubmitReport}>
                <textarea
                  className="pub-profile-report-textarea"
                  placeholder={t('report.placeholder')}
                  value={reportReason}
                  onChange={e => setReportReason(e.target.value)}
                  maxLength={500}
                  rows={3}
                  disabled={reportBusy}
                />
                {reportError && <p className="pub-profile-report-error">{reportError}</p>}
                <div className="pub-profile-report-actions">
                  <button type="submit" className="pub-profile-report-submit" disabled={reportReason.trim().length < 10 || reportBusy}>
                    {reportBusy ? t('report.sending') : t('report.submit')}
                  </button>
                  <button type="button" className="pub-profile-report-cancel" onClick={() => setShowReportForm(false)} disabled={reportBusy}>
                    {t('report.cancel')}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
