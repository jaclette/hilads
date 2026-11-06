import { useEffect, useRef, useState } from 'react'
import { fetchMyProposals } from '../../api'
import { track } from '../../lib/analytics'
import Icon from '../Icon'
import { useDaily, useDc } from '../daily/dailyShared'

// ✕ hides the card for a week, then it comes back.
const HIDE_KEY = 'hilads_propose_card_hidden_until'
const HIDE_MS = 7 * 24 * 3600 * 1000
const hiddenNow = () => { try { return Number(localStorage.getItem(HIDE_KEY) ?? 0) > Date.now() } catch { return false } }

/** The lightbulb: glass, base and three rays (it wiggles from its base). */
function Bulb() {
  return (
    <svg viewBox="0 0 64 64" width="58" height="58" aria-hidden="true">
      <circle cx="32" cy="34" r="24" fill="var(--surface)" />
      <g stroke="#FFC93C" strokeWidth="3.5" strokeLinecap="round">
        <path d="M32 3v7" /><path d="M12 11l5 5" /><path d="M52 11l-5 5" />
      </g>
      <path d="M32 16c-8.3 0-14 6.1-14 13.6 0 5.2 2.9 8.3 5.3 10.8 1.6 1.7 2.7 3.4 2.7 5.6h12c0-2.2 1.1-3.9 2.7-5.6 2.4-2.5 5.3-5.6 5.3-10.8C46 22.1 40.3 16 32 16z" fill="#FFC93C" />
      <path d="M27.5 31.5c0-3.3 2-6 5-6.8" stroke="#FFF6D6" strokeWidth="3" strokeLinecap="round" fill="none" />
      <rect x="26" y="48" width="12" height="4" rx="2" fill="#8A6D2B" />
      <rect x="27.5" y="53" width="9" height="4" rx="2" fill="#8A6D2B" />
    </svg>
  )
}

/**
 * The bottom of Today (V6.1, as in the app; replaces the "Got a challenge idea?
 * Propose it" link): a small playful card on soft yellow. The lightbulb wiggles
 * gently when the card scrolls into view, "Your idea could become tomorrow's
 * challenge for the whole world", a real "Propose a challenge" button. Someone
 * whose proposal was already played sees it as proof ("Your idea "X" was played
 * in 4 cities"). ✕ hides it for 7 days. Guests get the sign-up sheet first.
 */
export default function ProposeCard() {
  const { t, i18n } = useDc()
  const { account, openDaily, needAccount } = useDaily()
  const [hidden, setHidden] = useState(hiddenNow)
  const [played, setPlayed] = useState(null)
  const [wiggle, setWiggle] = useState(0)
  const ref = useRef(null)

  useEffect(() => {
    if (!account) { setPlayed(null); return undefined }
    let alive = true
    fetchMyProposals(i18n.language).then(({ items }) => {
      const hit = (items ?? []).find(p => p.type === 'challenge' && (p.playedCities ?? 0) > 0)
      if (alive) setPlayed(hit ? { text: hit.text.length > 42 ? `${hit.text.slice(0, 40).trimEnd()}…` : hit.text, cities: hit.playedCities } : null)
    }).catch(() => {})
    return () => { alive = false }
  }, [account, i18n.language])

  // A gentle wiggle each time the card comes into view (at most every few seconds).
  useEffect(() => {
    const el = ref.current
    if (!el || hidden || typeof IntersectionObserver === 'undefined') return undefined
    let last = 0
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && Date.now() - last > 4000) { last = Date.now(); setWiggle(w => w + 1) }
    }, { threshold: 0.6 })
    io.observe(el)
    return () => io.disconnect()
  }, [hidden])

  if (hidden) return null
  const open = () => {
    navigator.vibrate?.(8)
    track('propose_card_tapped', { signed_in: !!account, played: !!played, platform_surface: 'web' })
    if (account) openDaily('propose', { source: 'today_card' })
    else needAccount('create_challenge')
  }
  const hide = () => {
    track('propose_card_hidden', { platform_surface: 'web' })
    setHidden(true)
    try { localStorage.setItem(HIDE_KEY, String(Date.now() + HIDE_MS)) } catch { /* private mode */ }
  }

  return (
    <div ref={ref} className="pc-card" data-testid="today-propose">
      <button type="button" className="pc-close" onClick={hide} aria-label={t('propose.cardHide')} title={t('propose.cardHide')}><Icon name="close" size={18} /></button>
      <div className="pc-top">
        <span key={wiggle} className={`pc-bulb${wiggle ? ' pc-bulb--wiggle' : ''}`}><Bulb /></span>
        <span className="pc-body">
          <span className="pc-title">💡 {t('propose.linkAsk')}</span>
          <span className="pc-text">{t('propose.cardBody')}</span>
        </span>
      </div>
      {played && <p className="pc-proof">{t('propose.cardPlayed', { text: played.text, count: played.cities })}</p>}
      <button type="button" className="pc-button" onClick={open}>{t('propose.cta')}</button>
    </div>
  )
}
