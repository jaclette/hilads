import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { proposeDate, withdrawProposal, approveDate, approveChallenge, rejectChallenge } from '../api'

/**
 * PR3 — schedule band that sits between the thread chat feed and composer.
 * Web parity for mobile's ThreadScheduleBlock. Same state machine:
 *
 *   phase='accepted', no proposal              → "📅 Propose a date" button
 *   phase='accepted', I proposed               → "⏳ Awaiting approval" + Withdraw
 *   phase='accepted', they proposed (creator)  → "📅 They proposed …" + Approve + Counter-propose
 *   phase='accepted', they proposed (acceptor) → "📅 They proposed …" + Counter-propose
 *   phase='scheduled'                          → "✅ Meet on …" (locked card)
 *   phase ∈ {debrief, approved, rejected}     → nothing (PR4)
 */
export default function ThreadScheduleBlock({ thread, myUserId, onChange }) {
  const { t } = useTranslation('challenge')
  const [busy, setBusy] = useState(null)            // 'propose' | 'approve' | 'withdraw' | null
  const [pickerOpen, setPickerOpen] = useState(false)

  const hasProposal = thread.proposed_starts_at != null
  const iProposed   = hasProposal && thread.proposed_by_user_id === myUserId
  const iAmCreator  = thread.i_am_creator
  // PR4 — render off effective_phase ('scheduled' → 'debrief' once meetup ends).
  const phase       = thread.effective_phase ?? thread.phase

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleApprove() {
    setBusy('approve')
    try { await approveDate(thread.id); onChange?.() }
    catch { window.alert(t('schedule.err.approveFailed')) }
    finally { setBusy(null) }
  }

  async function handleWithdraw() {
    if (!window.confirm(`${t('schedule.withdraw.title')}\n\n${t('schedule.withdraw.body')}`)) return
    setBusy('withdraw')
    try { await withdrawProposal(thread.id); onChange?.() }
    catch { window.alert(t('schedule.err.withdrawFailed')) }
    finally { setBusy(null) }
  }

  async function handlePickerSubmit(startsAt, endsAt, venue) {
    setBusy('propose'); setPickerOpen(false)
    try { await proposeDate(thread.id, startsAt, endsAt, venue); onChange?.() }
    catch { window.alert(t('schedule.err.proposeFailed')) }
    finally { setBusy(null) }
  }

  // PR4 — verdict (creator only, in debrief phase).
  async function handleVerdict(kind) {
    const ok = window.confirm(`${t(`debrief.confirm.${kind}.title`)}\n\n${t(`debrief.confirm.${kind}.body`)}`)
    if (!ok) return
    setBusy('verdict')
    try {
      if (kind === 'approve') await approveChallenge(thread.id)
      else                    await rejectChallenge(thread.id)
      onChange?.()
    } catch {
      window.alert(t(`debrief.err.${kind}Failed`))
    } finally {
      setBusy(null)
    }
  }

  // ── Render: phase='scheduled' ─────────────────────────────────────────────
  if (phase === 'scheduled' && thread.proposed_starts_at) {
    return (
      <div style={{ ...bandBase, ...bandScheduled }}>
        <span style={{ fontSize: 16 }}>✅</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#22c55e' }}>{t('schedule.scheduled.title')}</div>
          <div style={{ fontSize: 12, color: 'var(--muted, #b3b3b3)', marginTop: 2 }}>
            {formatDateLine(thread.proposed_starts_at, thread.proposed_ends_at, thread.proposed_venue)}
          </div>
        </div>
      </div>
    )
  }

  // ── PR4: debrief (meetup over, creator decides) ─────────────────────────
  if (phase === 'debrief') {
    if (iAmCreator) {
      return (
        <div style={{ ...bandBase, ...bandDebrief }}>
          <span style={{ fontSize: 16 }}>❓</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text, #fff)' }}>{t('debrief.creatorPrompt.title')}</div>
            <div style={{ fontSize: 12, color: 'var(--muted, #b3b3b3)', marginTop: 2 }}>
              {t('debrief.creatorPrompt.body', { name: thread.counterparty.displayName })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => handleVerdict('reject')} disabled={busy !== null}
              title={t('debrief.confirm.reject.confirm')} style={iconBtnSecondary}>
              {busy === 'verdict' ? '…' : '✕'}
            </button>
            <button type="button" onClick={() => handleVerdict('approve')} disabled={busy !== null}
              title={t('debrief.confirm.approve.confirm')} style={iconBtnPrimary}>
              {busy === 'verdict' ? '…' : '✓'}
            </button>
          </div>
        </div>
      )
    }
    return (
      <div style={{ ...bandBase, ...bandDebrief }}>
        <span style={{ fontSize: 16 }}>⏳</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text, #fff)' }}>{t('debrief.acceptorWaiting.title')}</div>
          <div style={{ fontSize: 12, color: 'var(--muted, #b3b3b3)', marginTop: 2 }}>
            {t('debrief.acceptorWaiting.body', { name: thread.counterparty.displayName })}
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'approved') {
    return (
      <div style={{ ...bandBase, ...bandScheduled }}>
        <span style={{ fontSize: 18 }}>🎉</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#22c55e' }}>{t('debrief.approved.title')}</div>
          {thread.approved_at && (
            <div style={{ fontSize: 12, color: 'var(--muted, #b3b3b3)', marginTop: 2 }}>
              {formatVerdictDate(thread.approved_at)}
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
              {formatVerdictDate(thread.rejected_at)}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Defensive — unknown future phase. Hide rather than crash.
  if (phase !== 'accepted' && phase !== 'scheduled') return null

  // ── Render: phase='accepted', no proposal ─────────────────────────────────
  if (!hasProposal) {
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
            {formatDateLine(thread.proposed_starts_at, thread.proposed_ends_at, thread.proposed_venue)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {iAmCreator && (
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
    </>
  )
}

// ── Picker modal ────────────────────────────────────────────────────────────

const TIME_PRESETS = [
  { key: '10:00', h: 10, m: 0  },
  { key: '12:30', h: 12, m: 30 },
  { key: '14:00', h: 14, m: 0  },
  { key: '17:00', h: 17, m: 0  },
  { key: '19:00', h: 19, m: 0  },
  { key: '21:30', h: 21, m: 30 },
]

function DatePickerModal({ onClose, onSubmit, submitLabel, initialStartsAt, initialVenue }) {
  const { t } = useTranslation('challenge')
  const [dayOffset, setDayOffset] = useState(0)
  const [timeKey,   setTimeKey]   = useState('19:00')
  const [venue,     setVenue]     = useState(initialVenue ?? '')

  // Pre-fill from existing proposal on counter-propose.
  useEffect(() => {
    if (!initialStartsAt) return
    const d = new Date(initialStartsAt * 1000)
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0)
    const offset = Math.round(
      (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - todayMidnight.getTime()) / 86400000
    )
    if (offset >= 0 && offset <= 7) setDayOffset(offset)
    const matched = TIME_PRESETS.find(p => p.h === d.getHours() && p.m === d.getMinutes())
    if (matched) setTimeKey(matched.key)
  }, [initialStartsAt])

  // Build day-pill labels at render time (no useMemo — cheap).
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dayLabels = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(today); d.setDate(today.getDate() + i)
    if (i === 0) return { offset: i, label: t('schedule.today') }
    if (i === 1) return { offset: i, label: t('schedule.tomorrow') }
    return { offset: i, label: d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) }
  })

  function submit() {
    const preset = TIME_PRESETS.find(p => p.key === timeKey)
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + dayOffset)
    d.setHours(preset.h, preset.m, 0, 0)
    const startsAt = Math.floor(d.getTime() / 1000)
    onSubmit(startsAt, startsAt + 2 * 3600, venue.trim() || null)
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg, #161210)', width: '100%', maxWidth: 480,
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          padding: 16, maxHeight: '85vh', overflowY: 'auto',
        }}
      >
        {/* Handle + header */}
        <div style={{ width: 40, height: 4, background: 'rgba(255,255,255,0.20)', borderRadius: 2, margin: '0 auto 12px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted, #b3b3b3)', fontSize: 22, cursor: 'pointer' }}>×</button>
          <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text, #fff)' }}>{t('schedule.picker.title')}</span>
          <span style={{ width: 22 }} />
        </div>

        {/* When */}
        <div style={sectionLabel}>{t('schedule.picker.whenLabel')}</div>
        <div style={pillsRow}>
          {dayLabels.map(d => (
            <button
              key={d.offset}
              type="button"
              onClick={() => setDayOffset(d.offset)}
              style={d.offset === dayOffset ? pillSelected : pill}
            >{d.label}</button>
          ))}
        </div>

        {/* Time */}
        <div style={sectionLabel}>{t('schedule.picker.timeLabel')}</div>
        <div style={pillsGrid}>
          {TIME_PRESETS.map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => setTimeKey(p.key)}
              style={p.key === timeKey ? pillSelected : pill}
            >{p.key}</button>
          ))}
        </div>

        {/* Where */}
        <div style={sectionLabel}>{t('schedule.picker.whereLabel')}</div>
        <input
          type="text"
          value={venue}
          onChange={e => setVenue(e.target.value)}
          placeholder={t('schedule.picker.wherePlaceholder')}
          maxLength={200}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--bg-2, #1f1a17)', border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 10, padding: '10px 12px', color: 'var(--text, #fff)', fontSize: 14,
          }}
        />

        <button
          type="button"
          onClick={submit}
          style={{
            marginTop: 16, width: '100%',
            background: '#FF7A3C', color: '#fff', border: 'none',
            borderRadius: 999, padding: '13px', fontSize: 15, fontWeight: 800, cursor: 'pointer',
          }}
        >{submitLabel}</button>
      </div>
    </div>
  )
}

// ── Helpers + inline styles ─────────────────────────────────────────────────

function formatVerdictDate(unixSeconds) {
  const d = new Date(unixSeconds * 1000)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' +
         d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function formatDateLine(startsAt, endsAt, venue) {
  if (!startsAt) return ''
  const d = new Date(startsAt * 1000)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const dayMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  let dayLabel
  if (dayMidnight.getTime() === today.getTime())         dayLabel = 'Today'
  else if (dayMidnight.getTime() === tomorrow.getTime()) dayLabel = 'Tomorrow'
  else dayLabel = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  const timeLabel = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
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
const bandDebrief   = { background: 'rgba(255,122,60,0.10)' }
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

const sectionLabel = {
  fontSize: 11, fontWeight: 700, color: 'var(--muted, #b3b3b3)',
  letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 14, marginBottom: 6,
}
const pillsRow  = { display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }
const pillsGrid = { display: 'flex', flexWrap: 'wrap', gap: 8 }

const pill = {
  padding: '8px 14px', borderRadius: 999,
  background: 'var(--bg-2, #1f1a17)',
  border: '1px solid rgba(255,255,255,0.10)',
  color: 'var(--muted, #b3b3b3)', fontWeight: 600, fontSize: 13,
  cursor: 'pointer', whiteSpace: 'nowrap',
}
const pillSelected = {
  ...pill,
  background: 'rgba(255,122,60,0.14)',
  borderColor: '#FF7A3C',
  color: '#FF7A3C', fontWeight: 800,
}
