import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { proposeDate, withdrawProposal, approveDate } from '../api'
import ConfirmDialog from './ConfirmDialog'
import DatePickerModal from './DatePickerModal'

/**
 * PR3 - schedule band that sits between the thread chat feed and composer.
 * Web parity for mobile's ThreadScheduleBlock. Same state machine:
 *
 *   phase='accepted', no proposal              → "📅 Propose a date" button
 *   phase='accepted', I proposed               → "⏳ Awaiting approval" + Withdraw
 *   phase='accepted', they proposed (creator)  → "📅 They proposed …" + Approve + Counter-propose
 *   phase='accepted', they proposed (acceptor) → "📅 They proposed …" + Counter-propose
 *   phase='scheduled'                          → "✅ Meet on …" (locked card)
 *   phase ∈ {debrief, approved, rejected}     → nothing (PR4)
 */
export default function ThreadScheduleBlock({ thread, myUserId, onChange, hideEmptyCta = false }) {
  const { t, i18n } = useTranslation('challenge')
  const locale = i18n.language
  const [busy, setBusy] = useState(null)            // 'propose' | 'approve' | 'withdraw' | null
  const [pickerOpen, setPickerOpen] = useState(false)
  // Replaces the four window.alert / two window.confirm calls below.
  const [dialog, setDialog] = useState(null)

  const hasProposal = thread.proposed_starts_at != null
  const iProposed   = hasProposal && thread.proposed_by_user_id === myUserId
  const iAmCreator  = thread.i_am_creator
  // PR4 - render off effective_phase ('scheduled' → 'debrief' once meetup ends).
  const phase       = thread.effective_phase ?? thread.phase

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleApprove() {
    setBusy('approve')
    try { await approveDate(thread.id); onChange?.() }
    catch { setDialog({ emoji: '😬', title: t('schedule.err.approveFailed') }) }
    finally { setBusy(null) }
  }

  function handleWithdraw() {
    setDialog({
      emoji: '↩️',
      title: t('schedule.withdraw.title'),
      body:  t('schedule.withdraw.body'),
      primary: {
        label: t('schedule.withdraw.confirm'),
        destructive: true,
        onPress: async () => {
          setBusy('withdraw')
          try { await withdrawProposal(thread.id); onChange?.() }
          catch { setDialog({ emoji: '😬', title: t('schedule.err.withdrawFailed') }) }
          finally { setBusy(null) }
        },
      },
      secondary: {},
    })
  }

  async function handlePickerSubmit(startsAt, endsAt, venue) {
    setBusy('propose'); setPickerOpen(false)
    try { await proposeDate(thread.id, startsAt, endsAt, venue); onChange?.() }
    catch { setDialog({ emoji: '😬', title: t('schedule.err.proposeFailed') }) }
    finally { setBusy(null) }
  }

  // ── Render: phase='scheduled' ─────────────────────────────────────────────
  // Either party can tap ✏️ to reschedule - the backend flips phase back to
  // 'accepted', clears date_approved_at, and the other party re-approves the
  // new proposal.
  if (phase === 'scheduled' && thread.proposed_starts_at) {
    return (
      <>
        {/* The whole band is the touch target - the small icon button
            was too easy to miss. The pencil stays as a visual cue. */}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={busy !== null}
          aria-label={t('schedule.editCta')}
          style={{ ...bandBase, ...bandScheduled, background: bandScheduled.background, border: 0, padding: bandBase.padding, cursor: 'pointer', textAlign: 'left', width: '100%' }}
        >
          <span style={{ fontSize: 16 }}>✅</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#22c55e' }}>{t('schedule.scheduled.title')}</div>
            <div style={{ fontSize: 12, color: 'var(--muted, #b3b3b3)', marginTop: 2 }}>
              {formatDateLine(thread.proposed_starts_at, thread.proposed_ends_at, thread.proposed_venue, locale, t)}
            </div>
          </div>
          <span style={{ ...iconBtnSecondary, pointerEvents: 'none' }} aria-hidden="true">✏️</span>
        </button>
        {pickerOpen && (
          <DatePickerModal
            onClose={() => setPickerOpen(false)}
            onSubmit={handlePickerSubmit}
            submitLabel={t('schedule.editCta')}
            initialStartsAt={thread.proposed_starts_at}
            initialVenue={thread.proposed_venue}
          />
        )}
        <ConfirmDialog dialog={dialog} onClose={() => setDialog(null)} />
      </>
    )
  }

  // PR6 - the manual creator-verdict block that used to live here was retired
  // when the mutual-rating flow shipped. The DB trigger on challenge_ratings
  // now flips phase to 'approved' on the second rating, so 'debrief' is a
  // transient phase the user resolves by tapping the rate-prompt banner on
  // /threads (see RateSheet). No band rendered while in 'debrief'.

  if (phase === 'approved') {
    return (
      <div style={{ ...bandBase, ...bandScheduled }}>
        <span style={{ fontSize: 18 }}>🎉</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#22c55e' }}>{t('debrief.approved.title')}</div>
          {thread.approved_at && (
            <div style={{ fontSize: 12, color: 'var(--muted, #b3b3b3)', marginTop: 2 }}>
              {formatVerdictDate(thread.approved_at, locale)}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (phase === 'rejected') {
    return (
      <div style={{ ...bandBase, ...bandRejected }}>
        <span style={{ fontSize: 16 }}>✕</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text, #fff)' }}>{t('debrief.rejected.title')}</div>
          {thread.rejected_at && (
            <div style={{ fontSize: 12, color: 'var(--muted, #b3b3b3)', marginTop: 2 }}>
              {formatVerdictDate(thread.rejected_at, locale)}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Defensive - unknown future phase. Hide rather than crash.
  if (phase !== 'accepted' && phase !== 'scheduled') return null

  // ── Render: phase='accepted', no proposal ─────────────────────────────────
  // When hideEmptyCta is set, render nothing - the parent owns the propose
  // action (via the pipeline sub-CTA) so we don't duplicate the button.
  if (!hasProposal) {
    if (hideEmptyCta) return null
    return (
      <>
        <div style={bandBase}>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            disabled={busy !== null}
            style={{
              flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '10px 14px', borderRadius: 999,
              background: 'rgba(255,122,60,0.14)',
              border: '1px solid rgba(255,122,60,0.30)',
              color: '#FF7A3C', fontWeight: 800, fontSize: 13, letterSpacing: 0.2,
              cursor: 'pointer',
            }}
          >
            {t('schedule.proposeCta')}
          </button>
        </div>
        {pickerOpen && (
          <DatePickerModal
            onClose={() => setPickerOpen(false)}
            onSubmit={handlePickerSubmit}
            submitLabel={t('schedule.proposeCta')}
          />
        )}
        <ConfirmDialog dialog={dialog} onClose={() => setDialog(null)} />
      </>
    )
  }

  // ── Render: phase='accepted', proposal exists ─────────────────────────────
  return (
    <>
      <div style={{ ...bandBase, ...bandProposal }}>
        <span style={{ fontSize: 16 }}>{iProposed ? '⏳' : '📅'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text, #fff)' }}>
            {iProposed
              ? t('schedule.iProposedTitle')
              : t('schedule.theyProposedTitle', { name: thread.counterparty.displayName })}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted, #b3b3b3)', marginTop: 2 }}>
            {formatDateLine(thread.proposed_starts_at, thread.proposed_ends_at, thread.proposed_venue, locale, t)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {/* The party who did NOT propose signs off. Previously gated
              on iAmCreator, which meant the challenger could approve
              their OWN proposal (defeating the mutual-agreement point)
              and the taker had no way to approve a creator-side
              proposal at all. */}
          {!iProposed && (
            <button
              type="button"
              onClick={handleApprove}
              disabled={busy !== null}
              title="Approve"
              style={iconBtnPrimary}
            >
              {busy === 'approve' ? '…' : '✓'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            disabled={busy !== null}
            title={t('schedule.counterCta')}
            style={iconBtnSecondary}
          >
            ✏️
          </button>
          {iProposed && (
            <button
              type="button"
              onClick={handleWithdraw}
              disabled={busy !== null}
              title={t('schedule.withdraw.title')}
              style={iconBtnSecondary}
            >
              {busy === 'withdraw' ? '…' : '✕'}
            </button>
          )}
        </div>
      </div>
      {pickerOpen && (
        <DatePickerModal
          onClose={() => setPickerOpen(false)}
          onSubmit={handlePickerSubmit}
          submitLabel={t('schedule.counterCta')}
          initialStartsAt={thread.proposed_starts_at}
          initialVenue={thread.proposed_venue}
        />
      )}
      <ConfirmDialog dialog={dialog} onClose={() => setDialog(null)} />
    </>
  )
}


// ── Helpers + inline styles ─────────────────────────────────────────────────

function formatVerdictDate(unixSeconds, locale) {
  const d = new Date(unixSeconds * 1000)
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' }) + ' · ' +
         d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

// `locale` + `t` threaded in so dates render in the i18n language. Today/
// Tomorrow read from existing schedule.today / schedule.tomorrow keys.
function formatDateLine(startsAt, endsAt, venue, locale, t) {
  if (!startsAt) return ''
  const d = new Date(startsAt * 1000)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const dayMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  let dayLabel
  if (dayMidnight.getTime() === today.getTime())         dayLabel = t('schedule.today')
  else if (dayMidnight.getTime() === tomorrow.getTime()) dayLabel = t('schedule.tomorrow')
  else dayLabel = d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })
  const timeLabel = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const base = `${dayLabel} · ${timeLabel}`
  return venue ? `${base} · ${venue}` : base
}

const bandBase = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '10px 16px',
  background: 'rgba(255,122,60,0.06)',
  borderTop:    '1px solid rgba(255,122,60,0.18)',
  borderBottom: '1px solid rgba(255,122,60,0.18)',
}
const bandProposal  = { background: 'rgba(255,122,60,0.10)' }
const bandScheduled = {
  background:   'rgba(34,197,94,0.08)',
  borderTop:    '1px solid rgba(34,197,94,0.20)',
  borderBottom: '1px solid rgba(34,197,94,0.20)',
}
const bandRejected = {
  background:   'rgba(255,255,255,0.03)',
  borderTop:    '1px solid rgba(255,255,255,0.08)',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
}

const iconBtnPrimary = {
  width: 36, height: 36, borderRadius: 18, border: 'none',
  background: '#22c55e', color: '#fff', cursor: 'pointer',
  fontSize: 16, fontWeight: 800,
}
const iconBtnSecondary = {
  width: 32, height: 32, borderRadius: 16,
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)',
  color: 'var(--muted, #b3b3b3)', cursor: 'pointer', fontSize: 14,
}

