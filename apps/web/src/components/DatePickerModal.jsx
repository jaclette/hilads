import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Shared date+time+venue picker. Used by ThreadScheduleBlock (counter-propose)
 * and ChallengeChatPage (initial propose from the pipeline sub-CTA). Each
 * caller instantiates its own — state isolation by design.
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
}) {
  const { t } = useTranslation('challenge')
  const [dayOffset, setDayOffset] = useState(0)
  const [timeKey,   setTimeKey]   = useState('19:00')
  const [venue,     setVenue]     = useState(initialVenue ?? '')

  useEffect(() => {
    if (!initialStartsAt) return
    const d = new Date(initialStartsAt * 1000)
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0)
    const offset = Math.round(
      (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - todayMidnight.getTime()) / 86400000,
    )
    if (offset >= 0 && offset <= 7) setDayOffset(offset)
    const matched = TIME_PRESETS.find(p => p.h === d.getHours() && p.m === d.getMinutes())
    if (matched) setTimeKey(matched.key)
    if (initialVenue) setVenue(initialVenue)
  }, [initialStartsAt, initialVenue])

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
        zIndex: 2000,  // above the bottom-nav (z-index ~1000 in app shell)
      }}
    >
      {/* Sheet — flex column: handle/header pinned top, content scrolls in
          the middle, Submit pinned bottom. paddingBottom clears the safe-area
          home indicator (and the bottom-nav if the modal is shown over it). */}
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
                key={d.offset} type="button" onClick={() => setDayOffset(d.offset)}
                style={d.offset === dayOffset ? pillSelected : pill}
              >{d.label}</button>
            ))}
          </div>

          <div style={sectionLabel}>{t('schedule.picker.timeLabel')}</div>
          <div style={pillsGrid}>
            {TIME_PRESETS.map(p => (
              <button
                key={p.key} type="button" onClick={() => setTimeKey(p.key)}
                style={p.key === timeKey ? pillSelected : pill}
              >{p.key}</button>
            ))}
          </div>

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

        {/* Pinned submit — flexShrink: 0 keeps it visible even when content scrolls */}
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
  )
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
