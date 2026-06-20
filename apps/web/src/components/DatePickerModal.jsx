import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

/**
 * Shared date+time+venue picker. Used by ThreadScheduleBlock (counter-propose)
 * and ChallengeChatPage (initial propose from the pipeline sub-CTA). Each
 * caller instantiates its own - state isolation by design.
 *
 * Mirror of apps/mobile/src/features/challenge/DatePickerModal.tsx.
 */

const TIME_PRESETS = [
  { key: '10:00', h: 10, m: 0  },
  { key: '12:30', h: 12, m: 30 },
  { key: '14:00', h: 14, m: 0  },
  { key: '17:00', h: 17, m: 0  },
  { key: '19:00', h: 19, m: 0  },
  { key: '21:30', h: 21, m: 30 },
]

export default function DatePickerModal({
  onClose,
  onSubmit,
  submitLabel,
  initialStartsAt,
  initialVenue,
  // When false, no end time is derived (only the start counts - group create).
  requireEndTime = true,
}) {
  const { t } = useTranslation('challenge')
  // Chip selections - fast path for the common case (within the next
  // 8 days, at one of the 6 preset times).
  const [dayOffset, setDayOffset] = useState(0)
  const [timeKey,   setTimeKey]   = useState('19:00')
  // Free-form selections - escape hatch when the user wants a day past
  // the chip horizon, OR a time the presets don't cover. When either
  // is non-null it WINS over the chip on submit, and the chip
  // de-highlights so it's clear which value's in play.
  const [customDate, setCustomDate] = useState(null) // 'YYYY-MM-DD' or null
  const [customTime, setCustomTime] = useState(null) // 'HH:MM'      or null
  const [venue,     setVenue]     = useState(initialVenue ?? '')

  useEffect(() => {
    if (!initialStartsAt) return
    const d = new Date(initialStartsAt * 1000)
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0)
    const offset = Math.round(
      (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - todayMidnight.getTime()) / 86400000,
    )
    if (offset >= 0 && offset <= 7) {
      setDayOffset(offset)
      setCustomDate(null)
    } else {
      // Outside the chip horizon → drop into the date input so the
      // initial value round-trips faithfully.
      setCustomDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
    }
    const matched = TIME_PRESETS.find(p => p.h === d.getHours() && p.m === d.getMinutes())
    if (matched) {
      setTimeKey(matched.key)
      setCustomTime(null)
    } else {
      setCustomTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
    }
    if (initialVenue) setVenue(initialVenue)
  }, [initialStartsAt, initialVenue])

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dayLabels = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(today); d.setDate(today.getDate() + i)
    if (i === 0) return { offset: i, label: t('schedule.today') }
    if (i === 1) return { offset: i, label: t('schedule.tomorrow') }
    return { offset: i, label: d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) }
  })

  // Min/max bounds for the native date input - never let the user
  // propose a meet-up in the past, and cap at +90 days so an
  // accidental keystroke doesn't book something a decade out.
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const minDateAttr = fmt(today)
  const maxDate = new Date(today); maxDate.setDate(today.getDate() + 90)
  const maxDateAttr = fmt(maxDate)

  function submit() {
    // Resolve the day: custom > chip. Custom is a YYYY-MM-DD string
    // (local midnight); chip is an offset from today.
    let d
    if (customDate) {
      const [y, m, day] = customDate.split('-').map(Number)
      d = new Date(y, (m || 1) - 1, day || 1)
      d.setHours(0, 0, 0, 0)
    } else {
      d = new Date(today); d.setDate(today.getDate() + dayOffset)
    }
    // Resolve the time: custom > chip. Custom is HH:MM; chip is a key.
    let h = 19, mn = 0
    if (customTime) {
      const [hh, mm] = customTime.split(':').map(Number)
      h = isFinite(hh) ? hh : 19
      mn = isFinite(mm) ? mm : 0
    } else {
      const preset = TIME_PRESETS.find(p => p.key === timeKey)
      if (preset) { h = preset.h; mn = preset.m }
    }
    d.setHours(h, mn, 0, 0)
    const startsAt = Math.floor(d.getTime() / 1000)
    onSubmit(startsAt, requireEndTime ? startsAt + 2 * 3600 : null, venue.trim() || null)
  }

  // Portal to document.body so we escape the .full-page (z-index 200)
  // stacking context - otherwise our z-index 2000 is contained within that
  // context and the bottom-nav (z-index 300, sibling of .full-page in the
  // body) ends up rendering ON TOP of the modal, hiding the Submit button.
  return createPortal((
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        zIndex: 2000,
      }}
    >
      {/* Sheet - flex column: handle/header pinned top, content scrolls in
          the middle, Submit pinned bottom. paddingBottom clears the safe-area
          home indicator AND the mobile bottom-nav (74px) so the Submit button
          stays visible on phone-width layouts. */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg, #161210)', width: '100%', maxWidth: 480,
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
        }}
      >
        <div style={{ padding: '8px 16px 0' }}>
          <div style={{ width: 40, height: 4, background: 'rgba(255,255,255,0.20)', borderRadius: 2, margin: '0 auto 12px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted, #b3b3b3)', fontSize: 22, cursor: 'pointer' }}>×</button>
            <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text, #fff)' }}>{t('schedule.picker.title')}</span>
            <span style={{ width: 22 }} />
          </div>
        </div>

        {/* Scroll region */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 8px' }}>
          <div style={sectionLabel}>{t('schedule.picker.whenLabel')}</div>
          <div style={pillsRow}>
            {dayLabels.map(d => (
              <button
                key={d.offset} type="button"
                onClick={() => { setDayOffset(d.offset); setCustomDate(null) }}
                style={d.offset === dayOffset && !customDate ? pillSelected : pill}
              >{d.label}</button>
            ))}
          </div>
          {/* Or pick a specific day. Native <input type=date> for
              free locale-aware UI + keyboard input. Setting it
              de-selects the day chip; clearing it falls back to the
              chip selection. */}
          <input
            type="date"
            value={customDate ?? ''}
            min={minDateAttr}
            max={maxDateAttr}
            onChange={e => setCustomDate(e.target.value || null)}
            style={specificInput}
            aria-label={t('schedule.picker.specificDate', { defaultValue: 'Pick a specific date' })}
          />

          <div style={sectionLabel}>{t('schedule.picker.timeLabel')}</div>
          <div style={pillsGrid}>
            {TIME_PRESETS.map(p => (
              <button
                key={p.key} type="button"
                onClick={() => { setTimeKey(p.key); setCustomTime(null) }}
                style={p.key === timeKey && !customTime ? pillSelected : pill}
              >{p.key}</button>
            ))}
          </div>
          {/* Or pick a specific time. */}
          <input
            type="time"
            value={customTime ?? ''}
            onChange={e => setCustomTime(e.target.value || null)}
            style={specificInput}
            aria-label={t('schedule.picker.specificTime', { defaultValue: 'Pick a specific time' })}
          />

          <div style={sectionLabel}>{t('schedule.picker.whereLabel')}</div>
          <input
            type="text" value={venue} onChange={e => setVenue(e.target.value)}
            placeholder={t('schedule.picker.wherePlaceholder')} maxLength={200}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--bg-2, #1f1a17)', border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 10, padding: '10px 12px', color: 'var(--text, #fff)', fontSize: 14,
            }}
          />
        </div>

        {/* Pinned submit - flexShrink: 0 keeps it visible even when content scrolls */}
        <div style={{ padding: '8px 16px 0', flexShrink: 0 }}>
          <button
            type="button" onClick={submit}
            style={{
              width: '100%',
              background: '#FF7A3C', color: '#fff', border: 'none',
              borderRadius: 999, padding: '13px', fontSize: 15, fontWeight: 800, cursor: 'pointer',
            }}
          >{submitLabel}</button>
        </div>
      </div>
    </div>
  ), document.body)
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
// Free-form date / time inputs - sit below their chip rows and act as
// an escape hatch when none of the chips match. Visually tertiary
// (small, muted border) so they read as "or, pick exactly". Native
// inputs carry locale-aware UI on every modern browser.
const specificInput = {
  marginTop: 8,
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--bg-2, #1f1a17)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 10,
  padding: '8px 10px',
  color: 'var(--text, #fff)',
  fontSize: 13,
  colorScheme: 'dark',
}
