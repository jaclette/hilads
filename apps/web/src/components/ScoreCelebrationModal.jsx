import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { countryToFlag } from '../lib/countryFlag'
import { themeIcon } from '../lib/icons'
import { thumbUrl } from '../lib/imageThumb'
import { useBackLayer } from '../lib/backLayers'
import { shortCityName } from '../i18n/cityName'
import { themeName } from './map/spotsShared'
import { themeColor } from './joy/Joy'
import Icon from './Icon'

// The mockup's timeline (ms), as the app (docs/mockups/hilads_reward_mockup.html).
const T = { coins: 850, coinGap: 90, coinDur: 650, odo: 1150, odoDur: 1100, medals: [2000, 2250, 2500], end: 4100 }
const CONFETTI = ['#F2783A', '#FFC93C', '#2E6FD8', '#1A9E6B', '#F27AA8', '#7C5CE0', '#FFFFFF']

function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [p(a), p(b)]
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`
}

/** The victory screen data from the API, or built from an older API's fields. */
function winOf(d) {
  if (d.win) return d.win
  const medals = []
  const city = d.city_name ? { id: 0, name: d.city_name, country: d.city_country ?? null } : null
  const cityRank = d.rank_month?.city ?? d.rank_alltime?.city ?? null
  const worldRank = d.rank_month?.global ?? d.rank_alltime?.global ?? null
  const cities = d.city_rank_month ?? d.city_rank_alltime ?? null
  if (cityRank) medals.push({ key: 'city', rank: cityRank, prevRank: cityRank, city })
  if (worldRank) medals.push({ key: 'world', rank: worldRank, prevRank: worldRank })
  if (cities && city) medals.push({ key: 'cities', rank: cities, prevRank: cities, city })
  return { period: 'alltime', theme: null, challenge: null, proof: null, sources: [{ source: 'other', points: d.points }], medals, goal: null }
}

const buzz = (p) => { try { navigator.vibrate?.(p) } catch { /* not supported */ } }

/**
 * The points reward (as the app's): a victory card in the day's theme color with slowly turning
 * light rays and doodles, confetti, the trophy dropping in and wobbling, "+10" bouncing, coins
 * flying into the total, which rolls from the old to the new value, then what earned it, three
 * medals popping one by one (▲ when the reward moved me up; a click opens that ranking), the next
 * goal's bar filling, and the two buttons. A short vibration per step where the browser has one.
 * A click anywhere jumps to the end; with reduced motion everything is simply there.
 */
export default function ScoreCelebrationModal({ data, visible, onClose, onOpenRanks, onShare }) {
  const { t } = useTranslation('challenge')
  const win = useMemo(() => (data ? winOf(data) : null), [data])
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [done, setDone] = useState(false)
  const [rolled, setRolled] = useState(false)
  const card = useRef(null)
  const total = useRef(null)
  const timers = useRef([])

  const totalPts = data ? ((data.total_month ?? 0) > 0 ? data.total_month : data.total_alltime ?? 0) : 0
  const delta = data?.points ?? 0
  const from = Math.max(0, totalPts - delta)

  const clear = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  const finish = () => {
    clear()
    card.current?.querySelectorAll('.win-flycoin').forEach(n => n.remove())
    setRolled(true); setDone(true)
  }

  useEffect(() => {
    if (!visible || !win) return undefined
    clear(); setDone(false); setRolled(false)
    if (reduced) { finish(); buzz([12, 40, 18]); return clear }
    const at = (ms, fn) => { timers.current.push(setTimeout(fn, ms)) }
    buzz(8)
    at(670, () => buzz(8))
    // Coins: from "+10" to the total's coin (Web Animations, as the mockup).
    at(T.coins - 20, () => {
      const c = card.current, tt = total.current
      if (!c || !tt) return
      const cr = c.getBoundingClientRect(), tr = tt.getBoundingClientRect()
      for (let i = 0; i < 5; i++) {
        const coin = document.createElement('div')
        coin.className = 'win-flycoin'
        const sx = cr.width / 2 - 11 + (i - 2) * 26, sy = 150
        const ex = tr.left - cr.left + 10, ey = tr.top - cr.top
        coin.style.left = `${sx}px`; coin.style.top = `${sy}px`
        c.appendChild(coin)
        coin.animate([
          { opacity: 1, transform: 'translate(0,0) scale(1)' },
          { opacity: 1, transform: `translate(${(ex - sx) / 2}px,-40px) scale(1.2)` },
          { opacity: 0, transform: `translate(${ex - sx}px,${ey - sy}px) scale(.6)` },
        ], { duration: T.coinDur, delay: 20 + i * T.coinGap, easing: 'ease-in-out', fill: 'forwards' }).onfinish = () => coin.remove()
        at(20 + i * T.coinGap + T.coinDur, () => buzz(6))
      }
    })
    at(T.odo, () => setRolled(true))
    at(T.odo + T.odoDur, () => buzz([12, 40, 18]))
    T.medals.forEach(ms => at(ms + 40, () => buzz(5)))
    at(T.end, () => setDone(true))
    return clear
  }, [visible, win]) // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { clear(); onClose() }
  useBackLayer(visible && !!win, close)
  useEffect(() => {
    if (!visible) return undefined
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  const confetti = useMemo(() => Array.from({ length: 70 }, (_, i) => ({
    left: `${Math.random() * 100}%`, bg: CONFETTI[i % CONFETTI.length],
    dx: `${Math.random() * 120 - 60}px`, r: `${Math.random() * 720 - 360}deg`,
    anim: `win-fall ${1.6 + Math.random() * 1.4}s ${0.2 + Math.random() * 0.6}s ease-in forwards`,
  })), [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible || !win || delta <= 0) return null

  const skip = () => { if (!done) { finish(); buzz([12, 40, 18]) } }
  const tc = themeColor(win.theme)
  const light = tc.onFill === '#FFFFFF'
  const vars = {
    '--win-top': mix(tc.fill, '#FFFFFF', 0.45), '--win-fill': tc.fill, '--win-end': mix(tc.fill, '#F2783A', 0.18),
    '--win-tag': light ? '#FFFFFF' : mix(tc.fill, '#000000', 0.62),
  }
  const medals = win.medals.slice(0, 3)
  const target = (m) => ({ tab: m.key === 'cities' ? 'cities' : 'players', scope: m.key === 'city' ? 'city' : 'world', period: win.period })
  const mainTarget = { tab: 'players', scope: medals.some(m => m.key === 'city') ? 'city' : 'world', period: win.period }
  const cityMedal = medals.find(m => m.city?.name)?.city ?? null
  const city = cityMedal ? shortCityName(cityMedal.name) : null
  const themeKey = win.challenge?.theme?.key ?? win.theme
  const themeLabel = themeKey ? themeName(themeKey, { special: win.challenge?.special, city: win.proof?.city?.name }) : null
  const sub = [win.proof ? t('scoreWin.yourPhoto') : null, win.challenge?.headline ?? null].filter(Boolean).join(' · ')
    || win.sources.map(s => t(`scoreWin.source.${s.source}`)).join(' · ')
  const best = [...medals].sort((a, b) => a.rank - b.rank)[0] ?? null
  const g = win.goal
  const goalLeft = !g ? null
    : g.type === 'pass' ? t('scoreWin.goal.pass', { gap: g.gap, name: g.username ? `@${g.username}` : (g.displayName ?? '') })
    : g.type === 'streak' ? t('scoreWin.goal.streak', { day: g.day })
    : t('scoreWin.goal.stamp', { city: shortCityName(g.city?.name ?? '') })
  const goalRight = !g ? null : g.type === 'streak' ? `${g.day - 1} / ${g.milestone}` : g.type === 'stamp' ? `${g.done} / ${g.total}` : null
  const digits = String(totalPts).length

  return (
    <div className="win-dim" onClick={done ? close : skip}>
      <div ref={card} className={`win${done ? ' is-done' : ''}`} style={vars} role="dialog" aria-modal="true" aria-label={t('scoreWin.a11yPoints', { count: delta })}
           onClick={(e) => { e.stopPropagation(); skip() }}>
        <div className="win-rays" aria-hidden="true" />
        <span className="win-doodle" style={{ left: 16, top: 120 }} aria-hidden="true">✦</span>
        <span className="win-doodle" style={{ right: 20, top: 170 }} aria-hidden="true"><Icon name={themeIcon(themeKey, win.challenge?.special)} size={22} /></span>
        <span className="win-doodle" style={{ left: 24, top: 200 }} aria-hidden="true">〰</span>
        <button type="button" className="win-close" onClick={(e) => { e.stopPropagation(); close() }} aria-label={t('scoreWin.close')}>✕</button>

        <div className="win-trophy" aria-hidden="true">🏆</div>
        <div className="win-plus">+{delta}<small>{t('scoreWin.pts')}</small></div>
        <div className="win-total" ref={total} aria-label={t('scoreWin.a11yTotal', { total: totalPts })}>
          <span className="win-coin">H</span>
          <span className="win-odo" aria-hidden="true">
            {String(rolled ? totalPts : from).padStart(digits, ' ').split('').map((_, i) => {
              const startCh = String(from).padStart(digits, ' ')[i]
              const endCh = String(totalPts).padStart(digits, ' ')[i]
              const row = (ch) => (ch === ' ' ? 0 : Number(ch) + 1)
              return (
                <span key={i} className="win-digit" style={{ transform: `translateY(-${(rolled ? row(endCh) : row(startCh)) * 22}px)`, transition: rolled && !done ? undefined : 'none' }}>
                  <span>&nbsp;</span>{Array.from({ length: 10 }, (_, n) => <span key={n}>{n}</span>)}
                </span>
              )
            })}
          </span>
          <span className="win-unit">{t('scoreWin.pts')}</span>
        </div>
        <div className="win-tag">{city ? `${t('scoreWin.proud', { city })} ${countryToFlag(cityMedal?.country ?? null) ?? ''}`.trim() : t('scoreWin.proudNoCity')}</div>

        <div className="win-chip">
          {win.proof && <img className="win-th" src={thumbUrl(win.proof.thumbUrl ?? win.proof.photoUrl) ?? win.proof.photoUrl} alt="" />}
          <div className="win-chip-body">
            <b>{themeKey && <Icon name={themeIcon(themeKey, win.challenge?.special)} size={13} />}{themeLabel ?? t('scoreWin.source.other')}</b>
            {sub && <em>{sub}</em>}
          </div>
          <span className="win-pills">
            {win.sources.map(s => (
              <span key={s.source} className="win-pts">{win.sources.length > 1 ? `+${s.points} ${t(`scoreWin.source.${s.source}`)}` : `+${s.points}`}</span>
            ))}
          </span>
        </div>

        {medals.length > 0 && (
          <div className="win-medals">
            {medals.map(m => {
              const c = shortCityName(m.city?.name ?? '')
              const label = m.key === 'world' ? t('scoreWin.medal.world')
                : m.key === 'cities' ? (m.rank === 1 ? t('scoreWin.medal.citiesTop', { city: c }) : t('scoreWin.medal.cities', { city: c }))
                : t('scoreWin.medal.city', { city: c })
              const up = m.prevRank === null || m.prevRank === undefined ? null : m.prevRank - m.rank
              const icon = m.key === 'world' ? '🌍' : m.key === 'cities' ? '🏙️' : (countryToFlag(m.city?.country ?? null) || '📍')
              return (
                <button key={m.key} type="button" className={`win-medal win-medal--${m.key}`} onClick={(e) => { e.stopPropagation(); onOpenRanks(target(m)) }}
                        aria-label={`#${m.rank}, ${label}${up > 0 ? `, ${t('scoreWin.up', { count: up })}` : ''}`}>
                  <span className="win-m">{icon}</span>
                  <span className="win-r">#{m.rank}</span>
                  <span className="win-l">{label}</span>
                  {up > 0 ? <span className="win-up">▲ {up}</span> : m.prevRank == null ? <span className="win-up">{t('scoreWin.new')}</span> : null}
                </button>
              )
            })}
          </div>
        )}

        {goalLeft && (
          <div className="win-goal">
            <div className="win-goal-t"><span>{goalLeft}</span>{goalRight && <span>{goalRight}</span>}</div>
            <div className="win-bar"><i style={{ '--p': `${Math.round(Math.max(0, Math.min(1, g.progress ?? 0)) * 100)}%` }} /></div>
          </div>
        )}

        <div className="win-ctas">
          <button type="button" className="win-btn win-btn--p" onClick={(e) => { e.stopPropagation(); onOpenRanks(mainTarget) }}>{t('scoreWin.ranks')}</button>
          {onShare && win.proof && (
            <button type="button" className="win-btn win-btn--s" onClick={(e) => { e.stopPropagation(); onShare(win, best) }}>{t('scoreWin.share')}</button>
          )}
        </div>
      </div>
      {!reduced && !done && (
        <div className="win-confetti" aria-hidden="true">
          {confetti.map((p, i) => <i key={i} style={{ left: p.left, background: p.bg, '--dx': p.dx, '--r': p.r, animation: p.anim }} />)}
        </div>
      )}
    </div>
  )
}
