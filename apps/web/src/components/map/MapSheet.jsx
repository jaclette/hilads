import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from '../Icon'
import { themeIcon } from '../../lib/icons'
import { track } from '../../lib/analytics'
import { thumbFallback } from '../../lib/thumbFallback'
import { thumbUrl } from '../../lib/imageThumb'
import { placeholderStyle } from '../../lib/thumbhash'
import { themeName, compactPrice, formatDistance, sortSpots } from './spotsShared'

/** Peek height before the head is measured: the handle and one line ("23 spots in Saigon · nearest first"). */
export const SHEET_PEEK = 84
const HINT_KEY = 'hilads_map_sheet_hint_seen'
const SNAPS = ['peek', 'half', 'full']
const ROW = { display: 'inline-flex', alignItems: 'center', gap: 6 }

/** A spot of the list: proof photo, name, theme, distance, median price, likes. */
function SpotRow({ spot: s, me, km, onPick }) {
  const { t, i18n } = useTranslation('challenge')
  const th = s.themes?.[0] ?? null
  const p = s.priceRange
  const median = p ? (p.median ?? (p.min === p.max ? p.min : null)) : null
  const meta = [
    me ? formatDistance(km(me, [s.lat, s.lng]) * 1000, i18n.language) : null,
    median != null ? compactPrice(median, p.currency, i18n.language) : null,
  ].filter(Boolean).join(' · ')
  return (
    <button type="button" className="wm-row" onClick={() => onPick(s)}>
      {s.cover?.thumbUrl || s.cover?.photoUrl
        ? <img className="wm-row-photo" src={thumbUrl(s.cover.thumbUrl || s.cover.photoUrl)} style={placeholderStyle(s.cover.thumbHash)} onError={thumbFallback(s.cover.photoUrl)} alt="" loading="lazy" />
        : <span className="wm-row-photo wm-row-photo--empty"><Icon name={th ? themeIcon(th) : 'location-outline'} size={22} /></span>}
      <span className="wm-row-body">
        <span className="wm-row-name">{s.name}</span>
        <span className="wm-row-chips">
          {th && <span className="wm-row-theme" style={ROW}><Icon name={themeIcon(th)} size={12} />{themeName(th)}</span>}
          {s.validatedByLocal && <span className="wm-row-local" style={ROW}><Icon name="checkmark" size={12} />{t('map.validated')}</span>}
        </span>
        <span className="wm-row-meta">
          {meta && <span>{meta}</span>}
          <span style={ROW}><Icon name="heart" size={12} />{s.votes}</span>
        </span>
      </span>
    </button>
  )
}

/**
 * The map's sticky bottom sheet (V6, as in the app; replaces the List button):
 * peek (a line about the visible area), half (the list) and full. Drag the
 * handle, or tap it to go up / back down. It lists the visible area's spots
 * with the active filters, Nearest · Most liked · Newest; a selected pin's
 * card leads it. The first visit shows a "swipe up" hint.
 * The peek is the head as measured (that one line, wrapped when a language
 * needs it, and the hint), so nothing shows half cut at its edge; the sort
 * chips (one row scrolling sideways) come under the head from half. The map
 * page ends above the bottom nav, so the sheet never goes under it.
 */
const MapSheet = forwardRef(function MapSheet({ spots, me, origin, km, place, filterLabel, selectedCard, topNote, emptyArea, onPick, onPeek }, ref) {
  const { t } = useTranslation('challenge')
  const [snap, setSnap] = useState('peek')
  const [sort, setSort] = useState('near')
  const [drag, setDrag] = useState(null)   // { start, dy } while the handle is dragged
  const [hint, setHint] = useState(() => { try { return localStorage.getItem(HINT_KEY) !== '1' } catch { return false } })
  const box = useRef(null)
  const head = useRef(null)
  const moved = useRef(false)
  // The peek = the head's height (measured; it changes with the language, the hint and the width).
  const [peek, setPeek] = useState(SHEET_PEEK)
  useEffect(() => {
    const el = head.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => setPeek(Math.ceil(el.getBoundingClientRect().height)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => { onPeek?.(peek) }, [peek, onPeek])

  const go = (next) => {
    setSnap(next)
    track('web_map_sheet_snap', { snap: next })
    if (next !== 'peek' && hint) { setHint(false); try { localStorage.setItem(HINT_KEY, '1') } catch { /* private mode */ } }
  }
  useImperativeHandle(ref, () => ({ snapTo: go }))

  const onDown = (e) => { moved.current = false; setDrag({ start: e.clientY, dy: 0 }); e.currentTarget.setPointerCapture?.(e.pointerId) }
  const onMove = (e) => {
    if (!drag) return
    const dy = e.clientY - drag.start
    if (Math.abs(dy) > 6) moved.current = true
    setDrag(d => d && { ...d, dy })
  }
  const onUp = () => {
    if (!drag) return
    const dy = drag.dy
    setDrag(null)
    const i = SNAPS.indexOf(snap)
    if (!moved.current) { go(snap === 'peek' ? 'half' : 'peek'); return }
    // One step per short drag, two for a long one.
    const steps = Math.abs(dy) > 260 ? 2 : Math.abs(dy) > 40 ? 1 : 0
    const next = Math.max(0, Math.min(SNAPS.length - 1, i + (dy < 0 ? steps : -steps)))
    if (next !== i) go(SNAPS[next])
  }

  const data = sortSpots(spots, sort, me ?? origin, km)
  const sortLabel = t(sort === 'near' ? 'dc.map.sheet.byNear' : sort === 'liked' ? 'dc.map.sheet.byLiked' : 'dc.map.sheet.byNew')
  const headline = emptyArea ? t('dc.map.sheet.emptyArea')
    : place ? t('dc.map.sheet.count', { count: spots.length, city: place }) : t('dc.map.sheet.countHere', { count: spots.length })
  // The peek's one line: "24 spots in Saigon · Taste · nearest first".
  const line = [headline, filterLabel, emptyArea ? null : sortLabel].filter(Boolean).join(' · ')
  const sorts = [['near', t('map.sortNearest')], ['liked', t('dc.map.sheet.sortLiked')], ['new', t('dc.map.sheet.sortNew')]]

  return (
    <div ref={box} className={`wm-msheet wm-msheet--${snap}${drag ? ' wm-msheet--drag' : ''}`}
         style={{ '--wm-peek': `${peek}px`, ...(drag ? { '--wm-drag': `${drag.dy}px` } : null) }} data-testid="map-sheet">
      <div ref={head} className="wm-msheet-head" role="button" tabIndex={0} aria-expanded={snap !== 'peek'}
           onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}
           onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(snap === 'peek' ? 'half' : 'peek') } }}>
        <span className="wm-msheet-handle" aria-hidden="true" />
        <span className="wm-msheet-headline">{line}</span>
        {hint && <span className="wm-msheet-hint"><Icon name="chevron-up" size={14} />{t('dc.map.sheet.hint')}</span>}
      </div>
      {data.length > 1 && (
        <div className="wm-msheet-sorts" aria-hidden={snap === 'peek'}>
          {sorts.map(([k, label]) => (
            <button key={k} type="button" tabIndex={snap === 'peek' ? -1 : 0} className={`wm-chip${sort === k ? ' wm-chip--on' : ''}`}
                    onClick={() => { setSort(k); track('web_map_list_sorted', { sort: k }) }}>{label}</button>
          ))}
        </div>
      )}
      <div className="wm-msheet-body">
        {selectedCard}
        {topNote}
        {data.map(s => <SpotRow key={s.id} spot={s} me={me} km={km} onPick={onPick} />)}
      </div>
    </div>
  )
})

export default MapSheet
