import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useDc } from './dailyShared'

// A Daily photo with its selfie (the app's ui/DualPhoto): the photo fills the
// frame, the selfie sits in a rounded inset (top-left, ~28 % wide, 3:4). A
// click on the inset swaps them (250 ms), again to swap back. `small`: a
// smaller inset as decoration (mosaic cards, tiles: `interactive` false, the
// card's click wins). `draggable`: drag the inset to another corner (stories).
// The big layer lets clicks through to what's under it (tap zones, the card).
// Callers render their usual <img> when there is no selfie.

const MARGIN = 10
const TIP_KEY = 'hilads_dual_swap_tip_v1'
let tipClaimed = false
function claimTip() {
  if (tipClaimed) return false
  try {
    if (localStorage.getItem(TIP_KEY) === '1') return false
    localStorage.setItem(TIP_KEY, '1')
  } catch { /* private mode: show it once this session */ }
  tipClaimed = true
  return true
}

export const selfieOf = (p) => (p?.selfieUrl ? { url: p.selfieUrl, thumb: p.selfieThumbUrl ?? null } : null)

export function DualPhoto({ main, selfie, className = '', fit = 'cover', small = false, interactive = true, draggable = false,
                            insetTop = 0, onLoadMain, alt = '', ...frameProps }) {
  const { t } = useDc()
  const frame = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [selfieBig, setSelfieBig] = useState(false)
  const [corner, setCorner] = useState(0)
  const [drag, setDrag] = useState(null)       // {x, y} while dragging
  const [tip, setTip] = useState(false)
  const start = useRef(null)

  useLayoutEffect(() => {
    const el = frame.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => { setSelfieBig(false); setCorner(0) }, [main.url, selfie?.url])
  useEffect(() => {
    if (!interactive || !selfie || !claimTip()) return
    setTip(true)
    const id = setTimeout(() => setTip(false), 4000)
    return () => clearTimeout(id)
  }, [interactive, selfie])

  const m = small ? 6 : MARGIN
  const iw = Math.round(size.w * (small ? 0.24 : 0.28))
  const ih = Math.min(Math.round(iw * 4 / 3), Math.max(0, size.h - 2 * m - insetTop))
  const insetRect = { left: corner % 2 === 0 ? m : size.w - iw - m, top: corner < 2 ? m + insetTop : size.h - ih - m, width: iw, height: ih }
  const bigRect = { left: 0, top: 0, width: size.w, height: size.h }

  const swap = () => {
    setTip(false)
    setSelfieBig(v => !v)
    navigator.vibrate?.(8)
  }

  // Click = swap; drag (stories) = the nearest corner where it's let go.
  const down = (e) => {
    if (!interactive) return
    e.stopPropagation()
    start.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const move = (e) => {
    if (!start.current || !draggable) return
    setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y })
  }
  const up = (e) => {
    if (!start.current) return
    e.stopPropagation()
    const dx = e.clientX - start.current.x
    const dy = e.clientY - start.current.y
    start.current = null
    setDrag(null)
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) { swap(); return }
    if (!draggable) return
    const cx = insetRect.left + iw / 2 + dx
    const cy = insetRect.top + ih / 2 + dy
    setCorner((cy > size.h / 2 ? 2 : 0) + (cx > size.w / 2 ? 1 : 0))
  }

  const layer = (which) => {
    const isInset = which === 'main' ? selfieBig : !selfieBig
    const src = which === 'main' ? main : selfie
    const rect = isInset ? insetRect : bigRect
    const style = {
      ...rect,
      transform: isInset && drag ? `translate(${drag.x}px, ${drag.y}px)` : undefined,
      transition: drag ? 'none' : undefined,
      zIndex: isInset ? 2 : 1,
    }
    const handlers = isInset && interactive
      ? { onPointerDown: down, onPointerMove: move, onPointerUp: up, onClick: (e) => e.stopPropagation(),
          role: 'button', 'aria-label': t('dual.swapA11y'), tabIndex: 0,
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); swap() } } }
      : {}
    return (
      <span key={which} className={`dp-layer${isInset ? ' dp-inset' : ''}${isInset && small ? ' dp-inset--small' : ''}${isInset && interactive ? ' dp-inset--live' : ''}`}
            style={style} {...handlers}>
        <img src={src.url} alt={which === 'main' ? alt : ''} draggable={false}
             style={{ objectFit: isInset ? 'cover' : fit, backgroundImage: src.thumb ? `url("${src.thumb}")` : undefined }}
             onLoad={which === 'main' && onLoadMain ? (e) => onLoadMain({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight }) : undefined} />
      </span>
    )
  }

  return (
    <span ref={frame} className={`dp ${className}`} {...frameProps}>
      {size.w > 0 && <>{layer('main')}{layer('selfie')}</>}
      {tip && size.w > 0 && (
        <span className="dp-tip" style={{ top: insetRect.top + 6, left: insetRect.left + iw + 8 }}>{t('dual.swapHint')}</span>
      )}
    </span>
  )
}
