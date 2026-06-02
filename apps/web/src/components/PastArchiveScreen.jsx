import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import BackButton from './BackButton'
import AttendeeAvatars from './AttendeeAvatars'
import { fetchPastArchive } from '../api'
import { getEventLocation } from '../eventUtils'

const EVENT_ICONS = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
}
const CATEGORY_ICONS = { general: '🗣️', tips: '💡', food: '🍴', drinks: '🍺', help: '🙋', meetup: '👋' }

const MAX_SPAN_DAYS = 14
const MONTHS_BACK    = 12
const PAGE           = 12
const DOW_TINY       = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

// ── Date helpers ────────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0') }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
function addDays(d, n) { const c = new Date(d); c.setDate(c.getDate() + n); return c }
function isSameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate() }
function cityTodayYmd(tz) { return new Date().toLocaleDateString('en-CA', { timeZone: tz }) }
function prettyRange(from, to) {
  const opt = { month: 'short', day: 'numeric' }
  return `${parseYmd(from).toLocaleDateString(i18n.language, opt)} – ${parseYmd(to).toLocaleDateString(i18n.language, opt)}`
}
function pastWhen(ts, tz) {
  return new Date(ts * 1000).toLocaleDateString(i18n.language, { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz })
}

// ── Custom range picker — tap start then end, clamped to 14 days ─────────────
function RangeModal({ tz, initial, onApply, onClose }) {
  const { t } = useTranslation('archive')
  const today = parseYmd(cityTodayYmd(tz))
  const [view, setView]   = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [start, setStart] = useState(initial.from ? parseYmd(initial.from) : null)
  const [end, setEnd]     = useState(initial.to ? parseYmd(initial.to) : null)

  const minDate  = addDays(today, -(MONTHS_BACK * 31))
  const monthLbl = view.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' })

  const firstDow    = new Date(view.getFullYear(), view.getMonth(), 1).getDay()
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(view.getFullYear(), view.getMonth(), d))
  while (cells.length % 7 !== 0) cells.push(null)

  const prevDisabled = view.getFullYear() === minDate.getFullYear() && view.getMonth() === minDate.getMonth()
  const nextDisabled = view.getFullYear() === today.getFullYear() && view.getMonth() === today.getMonth()

  function pick(d) {
    if (!start || (start && end)) { setStart(d); setEnd(null); return }
    if (d < start) { setStart(d); setEnd(null); return }
    const span = Math.round((d.getTime() - start.getTime()) / 86400000)
    if (span > MAX_SPAN_DAYS - 1) { setStart(d); setEnd(null); return }
    setEnd(d)
  }
  function inRange(d) { if (!start) return false; const hi = end ?? start; return d >= start && d <= hi }

  return (
    <div className="upc-modal-overlay" onClick={onClose}>
      <div className="upc-modal-box" onClick={e => e.stopPropagation()}>
        <div className="upc-modal-header">
          <button type="button" className="upc-modal-nav" disabled={prevDisabled}
            onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}>‹</button>
          <span className="upc-modal-title">{monthLbl}</span>
          <button type="button" className="upc-modal-nav" disabled={nextDisabled}
            onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}>›</button>
        </div>
        <p className="archive-range-hint">
          {start && end ? prettyRange(ymd(start), ymd(end))
            : start ? t('picker.pickEnd')
            : t('picker.pickStart', { max: MAX_SPAN_DAYS })}
        </p>
        <div className="upc-modal-row">
          {DOW_TINY.map(d => <span key={d} className="upc-modal-dow">{d}</span>)}
        </div>
        {Array.from({ length: cells.length / 7 }).map((_, row) => (
          <div className="upc-modal-row" key={row}>
            {cells.slice(row * 7, row * 7 + 7).map((cell, i) => {
              if (!cell) return <span key={i} className="upc-modal-cell" />
              const disabled = cell > today || cell < minDate
              const sel  = inRange(cell)
              const edge = (start && isSameDay(cell, start)) || (end && isSameDay(cell, end))
              return (
                <button key={i} type="button"
                  className={`upc-modal-cell${sel ? ' in-range' : ''}${edge ? ' selected' : ''}${disabled ? ' disabled' : ''}`}
                  disabled={disabled} onClick={() => pick(cell)}>
                  <span className="upc-modal-cell-num">{cell.getDate()}</span>
                </button>
              )
            })}
          </div>
        ))}
        <button type="button" className="upc-modal-close" disabled={!start}
          onClick={() => { if (start) onApply(ymd(start), ymd(end ?? start)) }}>
          {t('picker.apply')}
        </button>
      </div>
    </div>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

const CHALLENGE_TYPE_ICONS = { food: '🍜', place: '📍', culture: '🎭', help: '🤝' }

export default function PastArchiveScreen({ channelId, timezone, cityName, onBack, onSelectEvent, onSelectTopic, onSelectChallenge }) {
  const { t } = useTranslation('archive')
  const tz = timezone || 'UTC'

  const [type, setType]   = useState('both')          // both | hangouts | pulses
  const [range, setRange] = useState({ key: 'recent' }) // key: recent | 7 | 14 | custom
  const [items, setItems] = useState([])
  const [cursor, setCursor]   = useState(null)
  const [status, setStatus]   = useState('loading')   // loading | ok | error
  const [loadingMore, setLoadingMore] = useState(false)
  const [showPicker, setShowPicker]   = useState(false)
  const reqIdRef = useRef(0)

  const load = useCallback(async () => {
    if (!channelId) return
    const reqId = ++reqIdRef.current
    setStatus('loading')
    const { items: list, nextCursor } = await fetchPastArchive(channelId, {
      type, limit: PAGE, from: range.from, to: range.to,
    })
    if (reqId !== reqIdRef.current) return
    setItems(list)
    setCursor(nextCursor)
    setStatus('ok')
  }, [channelId, type, range.from, range.to])

  const loadMore = useCallback(async () => {
    if (!channelId || loadingMore || cursor == null) return
    setLoadingMore(true)
    const reqId = reqIdRef.current
    const { items: more, nextCursor } = await fetchPastArchive(channelId, {
      type, limit: PAGE, before: cursor, from: range.from, to: range.to,
    })
    if (reqId === reqIdRef.current) {
      setItems(prev => [...prev, ...more])
      setCursor(nextCursor)
    }
    setLoadingMore(false)
  }, [channelId, type, range.from, range.to, cursor, loadingMore])

  useEffect(() => { load() }, [load])

  function applyPreset(key) {
    const to   = cityTodayYmd(tz)
    const days = key === '7' ? 7 : 14
    const from = ymd(addDays(parseYmd(to), -(days - 1)))
    setRange({ key, from, to })
    if (typeof window !== 'undefined' && window.posthog) window.posthog.capture('past_archive_range', { range: `last${days}` })
  }
  function applyCustom(from, to) {
    setRange({ key: 'custom', from, to })
    setShowPicker(false)
    if (typeof window !== 'undefined' && window.posthog) window.posthog.capture('past_archive_range', { range: 'custom' })
  }

  function renderEventRow(event) {
    const isPublic = event.source === 'ticketmaster' || event.source_type === 'ticketmaster'
    const location = getEventLocation(event)
    const icon     = EVENT_ICONS[event.type ?? event.event_type] ?? '📌'
    const going    = event.participant_count ?? 0
    const whenTs   = event.starts_at ?? event.expires_at
    return (
      <button key={`event-${event.id}`} className="city-row event-row-card" onClick={() => onSelectEvent(event)}>
        <div className="er-header">
          <span className="er-title">{icon} {event.title}</span>
          {isPublic ? <span className="er-going er-going--public">{t('public')}</span>
            : going > 0 && <span className="er-going">{t('went', { count: going })}</span>}
        </div>
        <div className="er-badges">
          <span className="city-row-current">🕐 {pastWhen(whenTs, tz)}</span>
        </div>
        {location && <span className="er-location">📍 {location}</span>}
        {!isPublic && <AttendeeAvatars preview={event.participants_preview ?? []} total={going} />}
      </button>
    )
  }

  function renderChallengeRow(ch) {
    const icon = CHALLENGE_TYPE_ICONS[ch.challenge_type] ?? '🔥'
    return (
      <button key={`challenge-${ch.id}`} className="city-row event-row-card challenge-row-card"
        onClick={() => onSelectChallenge && onSelectChallenge(ch)}>
        <div className="er-header">
          <span className="er-title">{icon} {ch.title}</span>
          {/* Reuse keys from the challenge namespace to avoid duplicating
              30+ strings across 19 archive.json files for things that
              already live in challenge.json. */}
          <span className="er-going er-going--challenge">{t('noun', { ns: 'challenge' })}</span>
        </div>
        <div className="er-badges">
          <span className="challenge-badge challenge-badge--audience">
            {ch.audience === 'locals'
              ? t('forLocals',    { ns: 'challenge' })
              : t('forExplorers', { ns: 'challenge' })}
          </span>
          <span className="challenge-badge challenge-badge--validated">
            ✓ {t('validatedBadge', { ns: 'challenge' })}
          </span>
        </div>
      </button>
    )
  }

  function renderTopicRow(topic) {
    const icon    = CATEGORY_ICONS[topic.category] ?? '💬'
    const replies = topic.message_count ?? 0
    return (
      <button key={`topic-${topic.id}`} className="city-row event-row-card archive-pulse-row"
        onClick={() => onSelectTopic(topic)}>
        <div className="er-header">
          <span className="er-title">{icon} {topic.title}</span>
          <span className="er-going archive-pulse-tag">{t('hangoutTag')}</span>
        </div>
        {topic.description && <span className="er-location">{topic.description}</span>}
        <span className="city-row-current archive-pulse-meta">
          {replies > 0 ? t('replies', { count: replies }) : t('noReplies')}
        </span>
      </button>
    )
  }

  const chips = [
    { key: 'recent', tk: 'recent' },
    { key: '7',      tk: 'last7' },
    { key: '14',     tk: 'last14' },
  ]

  return (
    <div className="full-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{t('title')}</span>
        <span style={{ width: 40 }} />
      </div>

      {/* Type filter */}
      <div className="archive-filter-bar">
        {[['both', 'all'], ['hangouts', 'events'], ['pulses', 'pulses'], ['challenges', 'challenges']].map(([k, lk]) => (
          <button key={k} type="button"
            className={`archive-pill${type === k ? ' active' : ''}`}
            onClick={() => setType(k)}>{t(`filters.${lk}`)}</button>
        ))}
      </div>

      {/* Date range chips */}
      <div className="archive-range-bar">
        {chips.map(c => (
          <button key={c.key} type="button"
            className={`archive-range-chip${range.key === c.key ? ' active' : ''}`}
            onClick={() => (c.key === 'recent' ? setRange({ key: 'recent' }) : applyPreset(c.key))}>
            {t(`range.${c.tk}`)}
          </button>
        ))}
        <button type="button"
          className={`archive-range-chip${range.key === 'custom' ? ' active' : ''}`}
          onClick={() => setShowPicker(true)}>
          📅 {range.key === 'custom' && range.from && range.to ? prettyRange(range.from, range.to) : t('range.custom')}
        </button>
      </div>

      <div className="page-body">
        {status === 'loading' && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}>
            <div className="loading-spinner" />
          </div>
        )}

        {status === 'error' && (
          <div className="events-empty-state" style={{ marginTop: 40 }}>
            <p className="events-empty-title">{t('error')}</p>
            <button className="events-empty-cta" onClick={load}>{t('retry')}</button>
          </div>
        )}

        {status === 'ok' && items.length === 0 && (
          <div className="events-empty-state" style={{ marginTop: 40 }}>
            <p className="events-empty-title">{t('emptyTitle')}</p>
            <p className="events-empty-sub">
              {range.key === 'recent' ? t('emptyRecentSub') : t('emptyWindowSub')}
            </p>
          </div>
        )}

        {status === 'ok' && items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px' }}>
            {items.map(item =>
              item.kind === 'topic'     ? renderTopicRow(item)
              : item.kind === 'challenge' ? renderChallengeRow(item)
              :                             renderEventRow(item)
            )}
            {cursor != null && (
              <button type="button" className="archive-load-more" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? t('loading') : t('loadMore')}
              </button>
            )}
          </div>
        )}
      </div>

      {showPicker && (
        <RangeModal tz={tz} initial={{ from: range.from, to: range.to }}
          onApply={applyCustom} onClose={() => setShowPicker(false)} />
      )}
    </div>
  )
}
