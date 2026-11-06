import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
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

/**
 * The wave (as the app): one asymmetric swell in a 360×30 box, the higher hump at 140, the
 * lower at the right edge. `p` (0..1) undulates it a little: the crest and the trough breathe
 * in opposite ways, the control points drift. Frames of a 5 s loop for the SVG animation.
 */
function wavePath(p) {
  const a = Math.sin(p * Math.PI * 2) * 1.6
  const d = Math.cos(p * Math.PI * 2) * 5
  const n = (v) => +v.toFixed(2)
  return `M0 ${n(24 - a / 2)} C${n(55 + d)} 26 ${n(85 + d)} ${n(2 + a)} 140 ${n(3 + a)}`
    + ` C${n(195 - d)} ${n(4 + a)} ${n(215 - d)} ${n(20 - a)} 262 ${n(19 - a)}`
    + ` C${n(302 + d)} ${n(18 - a)} ${n(328 + d)} ${n(9 + a / 2)} 360 ${n(12 + a / 2)} L360 31 L0 31Z`
}
const WAVE_D = wavePath(0)
const WAVE_FRAMES = Array.from({ length: 9 }, (_, i) => wavePath(i / 8)).join(';')
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** The orange wave across the top of the sheet; it undulates while `moving`. */
function Wave({ moving }) {
  return (
    <svg className="wm-wave" viewBox="0 0 360 30" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="wm-wave-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--peek-top)" />
          <stop offset="0.82" stopColor="var(--peek-mid)" />
          <stop offset="1" stopColor="var(--peek-mid)" />
        </linearGradient>
      </defs>
      <path d={WAVE_D} fill="url(#wm-wave-fill)">
        {moving && <animate attributeName="d" dur="5s" repeatCount="indefinite" values={WAVE_FRAMES} />}
      </path>
    </svg>
  )
}

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
 * The peek (V6.3, as the app) is an orange wave: a gradient from the brand
 * orange to terracotta, the white handle on its higher hump, the polaroids,
 * "📍 [6] spots to explore" on one line (shrinking when needed), "Nearest
 * 120 m away · swipe up 👆" and a white chevron; the wave undulates and the
 * chevron bounces until the sheet is opened once (remembered), neither with
 * reduced motion. Open, the wave header stays on top, the list keeps the light
 * ground. The peek is the head as measured, so nothing shows half cut at its edge; the sort
 * chips (one row scrolling sideways) come under the head from half. The map
 * page ends above the bottom nav, so the sheet never goes under it.
 */
const MapSheet = forwardRef(function MapSheet({ spots, me, origin, km, place, filterLabel, selectedCard, topNote, emptyArea, onPick, onPeek }, ref) {
  const { t, i18n } = useTranslation('challenge')
  const [snap, setSnap] = useState('peek')
  const [sort, setSort] = useState('near')
  const [drag, setDrag] = useState(null)   // { start, dy } while the handle is dragged
  const [hint, setHint] = useState(() => { try { return localStorage.getItem(HINT_KEY) !== '1' } catch { return false } })
  const box = useRef(null)
  const head = useRef(null)
  const title = useRef(null)
  const [reduced] = useState(reducedMotion)
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

  // The title stays on one line: its font shrinks (to 70 % at most) when it doesn't fit.
  const [titleScale, setTitleScale] = useState(1)
  const [titleWrap, setTitleWrap] = useState(false)
  const scaleNow = useRef(1)
  scaleNow.current = titleScale
  const titleKey = `${spots.length}|${emptyArea}|${i18n.language}`
  useLayoutEffect(() => {
    const el = title.current
    if (!el) return undefined
    const measure = () => {
      // The parts' natural widths (each part ellipsizes rather than overflow, so the row's own scrollWidth can't tell).
      const kids = [...el.children]
      const need = kids.reduce((n, k) => n + k.scrollWidth, 0) + 6 * Math.max(0, kids.length - 1), room = el.clientWidth
      // Measured at the current scale: the width at full size is about need / scale.
      const full = need / scaleNow.current
      // Down to 72 %; past that (German on a 320 px screen), the words after the count wrap to a second line rather than being cut.
      const fit = full > room && full > 0 ? Math.floor((room / full) * 100) / 100 : 1
      setTitleScale(Math.max(0.72, fit))
      setTitleWrap(fit < 0.72)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(el.parentElement)
    return () => ro.disconnect()
  }, [titleKey])

  const data = sortSpots(spots, sort, me ?? origin, km)
  // The ticket (as in the app): "📍 [6] spots to explore", the number in its pill (§ marks where it goes in each language).
  const count = emptyArea ? 0 : spots.length
  const [before, after = ''] = t('dc.map.sheet.peekTitle', { count, num: '§' }).split('§')
  const nearest = me && count ? sortSpots(spots, 'near', me, km)[0] : null
  const sub = count === 0 ? t('dc.map.sheet.peekEmpty')
    : [filterLabel, nearest ? t('dc.map.sheet.peekNearest', { distance: formatDistance(km(me, [nearest.lat, nearest.lng]) * 1000, i18n.language) }) : null,
       snap === 'peek' ? t('dc.map.sheet.peekSwipe') : null].filter(Boolean).join(' · ')
  // The three nearest with a photo: the polaroids.
  const near = sortSpots(spots, 'near', me ?? origin, km).filter(s => s.cover?.thumbUrl || s.cover?.photoUrl).slice(0, 3)
  const sorts = [['near', t('map.sortNearest')], ['liked', t('dc.map.sheet.sortLiked')], ['new', t('dc.map.sheet.sortNew')]]

  return (
    <div ref={box} className={`wm-msheet wm-msheet--${snap}${drag ? ' wm-msheet--drag' : ''}`}
         style={{ '--wm-peek': `${peek}px`, ...(drag ? { '--wm-drag': `${drag.dy}px` } : null) }} data-testid="map-sheet">
      <div ref={head} className="wm-msheet-head" role="button" tabIndex={0} aria-expanded={snap !== 'peek'}
           onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}
           onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(snap === 'peek' ? 'half' : 'peek') } }}>
        <Wave moving={hint && snap === 'peek' && !reduced} />
        <span className="wm-msheet-handle" aria-hidden="true" />
        <span className="wm-ticket" aria-label={`${before}${count}${after}${place ? ` (${place})` : ''}. ${sub}`}>
          {near.length ? (
            <span className="wm-polaroids" style={{ width: 40 + [0, 12, 22][near.length - 1] }} aria-hidden="true">
              {near.map((s, i) => (
                <span key={i} className={`wm-polaroid wm-polaroid--${i}`}>
                  <img key={s.id} src={thumbUrl(s.cover.thumbUrl || s.cover.photoUrl)} onError={thumbFallback(s.cover.photoUrl)} alt="" decoding="async" />
                </span>
              ))}
            </span>
          ) : <span className="wm-ticket-pin" aria-hidden="true">📍</span>}
          <span className="wm-ticket-text" aria-hidden="true">
            <span ref={title} className={`wm-ticket-title${titleWrap ? ' wm-ticket-title--wrap' : ''}`} style={titleScale < 1 ? { '--wm-title-scale': titleScale } : undefined}>
              {before.trim() && <span>{before.trim()}</span>}
              <span className="wm-ticket-count"><span key={count} className="wm-ticket-num">{count}</span></span>
              {after.trim() && <span>{after.trim()}</span>}
            </span>
            <span className="wm-ticket-sub">{sub}</span>
          </span>
          <span className={`wm-ticket-chevron${hint && snap === 'peek' ? ' wm-ticket-chevron--bounce' : ''}`} aria-hidden="true"><Icon name="chevron-up" size={20} /></span>
        </span>
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
