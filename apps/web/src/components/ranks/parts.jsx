import { useEffect, useState } from 'react'
import { useDc } from '../daily/dailyShared'

/** Podium block colors: gold, silver, bronze. */
export const MEDAL = ['#FFC93C', '#C9CED6', '#E3A06B']
export const MEDAL_EMOJI = ['🥇', '🥈', '🥉']
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** A number counting up from 0 (once); plain with reduced motion. */
export function CountUp({ value, format, className }) {
  const [n, setN] = useState(() => (reduced() ? value : 0))
  useEffect(() => {
    if (reduced()) { setN(value); return undefined }
    const start = performance.now()
    let raf = 0
    const step = (now) => {
      const p = Math.min(1, (now - start) / 700)
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <span className={className}>{format ? format(n) : n}</span>
}

/** ▲2 (green), ▼1, "new", or – when unchanged; nothing when the period has no movement. */
export function Movement({ rank, prevRank, show }) {
  const { t } = useDc()
  if (!show) return null
  if (prevRank == null) return <span className="r6-new">{t('ranks.new')}</span>
  const d = prevRank - rank
  if (d === 0) return <span className="r6-move">–</span>
  return <span className={`r6-move ${d > 0 ? 'r6-move--up' : 'r6-move--down'}`}>{d > 0 ? `▲${d}` : `▼${-d}`}</span>
}

/** A little confetti burst (CSS only), skipped with reduced motion. */
export function Confetti({ run }) {
  if (!run || reduced()) return null
  return (
    <span className="r6-confetti" aria-hidden="true">
      {Array.from({ length: 28 }, (_, i) => (
        <i key={i} style={{ left: `${(i * 37) % 100}%`, background: ['#FFC93C', '#FF6F61', '#1FB5A8', '#3D9BF0', '#FF7EB0', '#FF7A3D'][i % 6],
                            animationDelay: `${(i * 53) % 300}ms`, '--drift': `${((i * 29) % 60) - 30}px` }} />
      ))}
    </span>
  )
}

let celebrated = false   // confetti once per session, the first podium shown

/** The top 3 on gold, silver and bronze blocks (2-1-3), a crown on #1, rising blocks, counting numbers. */
export function Podium({ items }) {
  const [party] = useState(() => { const first = !celebrated && items.length > 0; if (first) celebrated = true; return first })
  const order = [items[1], items[0], items[2]]
  return (
    <div className="r6-podium">
      {order.map((it, i) => (it ? (
        <button key={it.key} type="button" className="r6-step" onClick={it.onClick} disabled={!it.onClick} aria-label={`#${it.rank} ${it.label}`}
                style={{ animationDelay: `${[120, 0, 240][i]}ms` }}>
          <span className="r6-lead">{it.rank === 1 && <span className="r6-crown">👑</span>}{it.lead}</span>
          <span className="r6-podium-name">{it.label}</span>
          <CountUp value={it.value} format={it.format} className="r6-podium-value" />
          <span className={`r6-block r6-block--${it.rank}`} style={{ background: MEDAL[it.rank - 1] }}><span>{it.rank}</span></span>
        </button>
      ) : <span key={`e${i}`} className="r6-step" />))}
      <Confetti run={party} />
    </div>
  )
}

/** A row from #4: rank, leading visual, name and sub line, movement, value pill. */
export function RankRow({ rank, lead, title, sub, movement, value, mine, onClick, extra, rowRef }) {
  return (
    <button type="button" ref={rowRef} className={`r6-row${mine ? ' r6-row--mine' : ''}`} onClick={onClick} disabled={!onClick} aria-label={`#${rank} ${title}, ${value}`}>
      <span className="r6-rank">{rank}</span>
      {lead}
      <span className="r6-row-body">
        <span className="r6-row-title">{title}</span>
        {sub && <span className="r6-row-sub">{sub}</span>}
        {extra}
      </span>
      {movement}
      <span className="r6-pill">{value}</span>
    </button>
  )
}

/** The sticky "You" bar: where you stand and who's next; a click scrolls to your row. */
export function YouBar({ text, onClick }) {
  return <button type="button" className="r6-you" onClick={onClick}>{text}</button>
}

/** A bar filling to `ratio` (0..1) when it appears: the city race. */
export function RaceBar({ ratio, color, delay = 0 }) {
  const [w, setW] = useState(reduced() ? ratio : 0)
  useEffect(() => { const id = setTimeout(() => setW(ratio), reduced() ? 0 : 40 + delay); return () => clearTimeout(id) }, [ratio, delay])
  return <span className="r6-track"><span className="r6-fill" style={{ width: `${Math.max(4, w * 100)}%`, background: color }} /></span>
}
