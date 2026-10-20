import { useEffect, useRef, useState } from 'react'
import { shortCityName } from '../../i18n/cityName'
import { AnswerBubble, FlagSticker } from '../joy/Joy'

const TICK_MS = 2200

/**
 * True while the world block may move: `el` on screen, the tab visible and
 * no "reduce motion" preference. `reduced` alone says whether reduce motion
 * is on (the static fallback).
 */
export function useLiveMotion(el) {
  const [onScreen, setOnScreen] = useState(true)
  const [visibleTab, setVisibleTab] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [el])
  useEffect(() => {
    const onVis = () => setVisibleTab(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onVis)
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const onMq = (e) => setReduced(e.matches)
    mq?.addEventListener?.('change', onMq)
    return () => { document.removeEventListener('visibilitychange', onVis); mq?.removeEventListener?.('change', onMq) }
  }, [])
  return { live: onScreen && visibleTab && !reduced, reduced }
}

/** The "live" dot: a primary dot with a soft ring expanding every 1.8 s (no ring when still). */
export function LiveDot({ live }) {
  return <span className={`live-dot${live ? ' live-dot--on' : ''}`} aria-hidden="true" />
}

/**
 * The world's answers as a live feed: the flag stickers of up to 3 countries,
 * and "[city] [answer in a speech bubble]" (`bubble`; else "[city] · [place]") sliding up every 2.2 s through the cities that answered
 * (other cities first), the current city's flag scaled up and the others
 * dimmed. A city that newly answered joins with a bounce and comes next.
 * Reduce motion: `staticLine` (the first three answers).
 */
export function WorldTicker({ entries, flags, live, reduced, staticLine }) {
  const [index, setIndex] = useState(0)
  const [fresh, setFresh] = useState(null)
  const seen = useRef(null)
  // Up to 3 stickers (the current city's among them), so the answer's bubble has room.
  const all = [...new Set(flags.filter(Boolean))]
  const cur = entries.length > 0 ? entries[index % entries.length].country : null
  const stack = cur && all.indexOf(cur) >= 3 ? [...all.slice(0, 2), cur] : all.slice(0, 3)

  useEffect(() => {
    const ids = new Set(entries.map(e => e.cityId))
    if (seen.current) {
      const added = entries.find(e => !seen.current.has(e.cityId))
      if (added) {
        setIndex(entries.indexOf(added))
        if (added.country) {
          setFresh(added.country)
          setTimeout(() => setFresh(null), 700)
        }
      }
    }
    seen.current = ids
  }, [entries])

  useEffect(() => {
    if (!live || entries.length < 2) return
    const id = setInterval(() => setIndex(i => (i + 1) % entries.length), TICK_MS)
    return () => clearInterval(id)
  }, [live, entries.length])

  const current = entries.length > 0 ? entries[index % entries.length] : null
  const ticker = !reduced && !!current
  return (
    <span className="world-ticker">
      <span className="today-teaser-flags" aria-hidden="true">
        {stack.map(c => (
          <span key={c} className={`world-flag${ticker && current.country === c ? ' world-flag--on' : ticker ? ' world-flag--dim' : ''}${fresh === c ? ' world-flag--new' : ''}`}>
            <FlagSticker country={c} size={22} />
          </span>
        ))}
      </span>
      <span className="world-ticker-box">
        {ticker
          ? <span key={`${current.cityId}:${index}`} className={`world-ticker-line${live ? ' world-ticker-line--in' : ''}`}>
              {current.bubble
                ? <span className="world-ticker-entry"><strong>{shortCityName(current.city)}</strong><AnswerBubble text={current.answer} size="sm" onPhoto /></span>
                : <><strong>{shortCityName(current.city)}</strong>{` · ${current.answer}`}</>}
            </span>
          : <span className="world-ticker-line">{staticLine}</span>}
      </span>
    </span>
  )
}
