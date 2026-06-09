import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * ArrivalsBar - slim strip between the chat header and the messages list.
 *
 * Two visual states (crossfaded in place, fixed height):
 *   - default: "Recent arrivals" + chevron, tap → opens sheet
 *   - live:    "{name} just landed" using the same feedJoin.* variants
 *              already used by the in-feed pill today, tap → opens profile
 *
 * A new arrival displays for 3s. Up to 3 queued arrivals wait their turn.
 * If a 4th comes in, the oldest queued (NOT the currently displayed one)
 * is dropped - perceived timing stays stable.
 */

const LIVE_DURATION_MS = 3000
const QUEUE_MAX        = 3

function arrivalKey(a) {
  return a.id ?? `${a.guestId ?? ''}:${a.createdAt}`
}

function capQueue(q) {
  return q.length > QUEUE_MAX ? q.slice(q.length - QUEUE_MAX) : q
}

export function ArrivalsBar({ arrivals, onOpen, onTapUser }) {
  const { t } = useTranslation('city')
  const seenRef = useRef(new Set())
  const queueRef = useRef([])
  const [current, setCurrent] = useState(null)

  // Mount time in seconds (matches a.createdAt). Only arrivals stamped
  // AFTER we mounted count as "live" — historical joins from the
  // initial fetch (or from a WS catchup batch on reconnect) get seeded
  // silently so the bar stays in its default "Recent arrivals" state
  // until somebody actually arrives in real time. The previous
  // "seededRef on first render" gate broke when the parent fed `[]`
  // first and the fetched feed arrived later: that whole second batch
  // was treated as fresh and replayed in the bar.
  const mountedAtRef = useRef(Date.now() / 1000)

  // Detect new arrivals. arrivals is newest-first; walk oldest→newest so the
  // queue preserves chronological order. The createdAt threshold + dedup
  // set together guarantee historical messages never trigger the live
  // banner — regardless of when the parent populates the list.
  useEffect(() => {
    const fresh = []
    for (let i = arrivals.length - 1; i >= 0; i--) {
      const a = arrivals[i]
      const key = arrivalKey(a)
      if (seenRef.current.has(key)) continue
      seenRef.current.add(key)
      const ts = typeof a.createdAt === 'number' ? a.createdAt : 0
      if (ts >= mountedAtRef.current) fresh.push(a)
    }
    if (fresh.length === 0) return
    if (current === null) {
      const [head, ...rest] = fresh
      queueRef.current = capQueue([...queueRef.current, ...rest])
      setCurrent(head)
    } else {
      queueRef.current = capQueue([...queueRef.current, ...fresh])
    }
  }, [arrivals]) // eslint-disable-line react-hooks/exhaustive-deps

  // Hold current for LIVE_DURATION_MS, then promote the next queued item.
  useEffect(() => {
    if (current === null) return
    const id = setTimeout(() => {
      const [next, ...rest] = queueRef.current
      queueRef.current = rest
      setCurrent(next ?? null)
    }, LIVE_DURATION_MS)
    return () => clearTimeout(id)
  }, [current])

  function handleClick() {
    if (current) {
      onTapUser?.(current)
      return
    }
    onOpen?.()
  }

  const liveText = current
    ? t(`feedJoin.${current.joinVariant ?? 0}`, { name: current.nickname })
    : ''

  return (
    <button
      type="button"
      className="arrivals-bar"
      onClick={handleClick}
      aria-live="polite"
      aria-label={current ? liveText : t('arrivalsBar.label')}
    >
      <span className={`arrivals-bar-layer arrivals-bar-default ${current ? 'is-hidden' : ''}`}>
        <span className="arrivals-bar-text">{t('arrivalsBar.label')}</span>
        <span className="arrivals-bar-chevron" aria-hidden="true">›</span>
      </span>
      <span className={`arrivals-bar-layer arrivals-bar-live ${current ? '' : 'is-hidden'}`}>
        <span className="arrivals-bar-live-text">{liveText}</span>
      </span>
    </button>
  )
}

/**
 * ArrivalsSheet - bottom-sheet list of recent arrivals. Same chronology and
 * wording as the in-feed pill it replaces. Tapping a row opens the user's
 * profile.
 */
export function ArrivalsSheet({ open, arrivals, onClose, onTapUser, formatTime }) {
  const { t } = useTranslation('city')
  if (!open) return null
  return (
    <>
      <div className="arrivals-sheet-backdrop" onClick={onClose} />
      <div className="arrivals-sheet" role="dialog" aria-modal="true" aria-label={t('arrivalsBar.sheetTitle')}>
        <div className="arrivals-sheet-handle" />
        <div className="arrivals-sheet-header">
          <span className="arrivals-sheet-title">{t('arrivalsBar.sheetTitle')}</span>
          <button type="button" className="arrivals-sheet-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="arrivals-sheet-list">
          {arrivals.length === 0 ? (
            <p className="arrivals-sheet-empty">{t('arrivalsBar.empty')}</p>
          ) : (
            // Newest at the top → oldest at the bottom. Mirrors the
            // chat feed's reading order; spec was the inverse of
            // the previous chronological dump.
            [...arrivals]
              .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
              .map(a => {
              const tappable = !!a.userId || !!a.guestId
              return (
                <button
                  key={arrivalKey(a)}
                  type="button"
                  className={`arrivals-sheet-row${tappable ? ' is-tappable' : ''}`}
                  onClick={tappable ? () => onTapUser?.(a) : undefined}
                  disabled={!tappable}
                >
                  <span className="arrivals-sheet-row-text">
                    {t(`feedJoin.${a.joinVariant ?? 0}`, { name: a.nickname })}
                  </span>
                  {a.createdAt && formatTime && (
                    <span className="arrivals-sheet-row-time">{formatTime(a.createdAt)}</span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
