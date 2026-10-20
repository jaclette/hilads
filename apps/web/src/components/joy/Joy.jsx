import Icon from '../Icon'
import { themeIcon } from '../../lib/icons'

/**
 * The joyful layer on the web (docs/daily-challenge/DESIGN.md), twin of the
 * app's src/ui/joy.tsx: theme colors, flag stickers, answer bubbles,
 * highlighted key words, the tangerine button, stamps, the dashed route and
 * the official wordmark. Styles in index.css (.joy-*).
 */
export const THEME_COLORS = {
  hidden_gem: { fill: '#1FB5A8', onFill: '#2A1C13', light: '#157E75', dark: '#1FB5A8' },
  taste:      { fill: '#FF6F61', onFill: '#2A1C13', light: '#B74F45', dark: '#FF6F61' },
  ask_local:  { fill: '#3D9BF0', onFill: '#2A1C13', light: '#2E75B6', dark: '#3D9BF0' },
  local_find: { fill: '#FF7EB0', onFill: '#2A1C13', light: '#AD5577', dark: '#FF7EB0' },
  night_out:  { fill: '#5B5BD6', onFill: '#FFFFFF', light: '#5B5BD6', dark: '#9A9AF5' },
  sip:        { fill: '#FFC93C', onFill: '#2A1C13', light: '#896C20', dark: '#FFC93C' },
  only_here:  { fill: '#FF8A3D', onFill: '#2A1C13', light: '#A85B28', dark: '#FF8A3D' },
  special:    { fill: '#FF7A3D', onFill: '#2A1C13', light: '#B2552A', dark: '#FF7A3D' },
}
export const ACCENTS = ['#FFC93C', '#FF6F61', '#1FB5A8', '#3D9BF0', '#FF7EB0', '#FF7A3D']
export const themeColor = (key) => THEME_COLORS[key] ?? THEME_COLORS.special

export function FlagSticker({ country, size = 28 }) {
  if (!country) return null
  return (
    <span className="joy-flag" style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 14)) }} aria-hidden="true">
      <img src={`/flags/${country.toLowerCase()}.svg`} alt="" />
    </span>
  )
}

export function AnswerBubble({ text, tail = 'left', onPhoto = false, size = 'md' }) {
  return <span className={`joy-bubble joy-bubble--${size} joy-bubble--tail-${tail}${onPhoto ? ' joy-bubble--photo' : ''}`}>{text}</span>
}

/** A title whose key word ("*word*" in the copy) sits on a colored block. */
export function HighlightText({ text, color = '#FF7A3D', as: Tag = 'span', className }) {
  const on = color === THEME_COLORS.night_out.fill ? '#FFFFFF' : '#2A1C13'
  return (
    <Tag className={className}>
      {text.split('*').map((p, i) => (i % 2 ? <mark key={i} className="joy-hl" style={{ background: color, color: on }}>{p}</mark> : p))}
    </Tag>
  )
}

export function JoyButton({ label, icon, onPhoto = false, onClick }) {
  return (
    <button type="button" className={`joy-btn${onPhoto ? ' joy-btn--photo' : ''}`} onClick={onClick}>
      {icon && <Icon name={icon} size={20} />}{label}
    </button>
  )
}

export function ThemeChipJoy({ theme, label }) {
  const c = themeColor(theme)
  return <span className="joy-chip" style={{ background: c.fill, color: c.onFill }}><Icon name={themeIcon(theme)} size={15} />{label}</span>
}

export function Stamp({ theme, label, earned = true }) {
  const c = themeColor(theme)
  return (
    <span className={`joy-stamp${earned ? '' : ' joy-stamp--off'}`} style={{ '--c': c.fill, '--ct': c.light, '--ctd': c.dark }}>
      <span className="joy-stamp-ring"><Icon name={themeIcon(theme)} size={26} /></span>
      {label && <span className="joy-stamp-label">{label}</span>}
    </span>
  )
}

export function DashedRoute() {
  return (
    <svg className="joy-route" viewBox="0 0 340 70" preserveAspectRatio="none" aria-hidden="true">
      <path d="M 4 56 C 85 7, 153 77, 238 28 S 330 14, 336 35" fill="none" stroke="currentColor" strokeOpacity=".3" strokeWidth="1.5" strokeDasharray="6 6" strokeLinecap="round" />
    </svg>
  )
}

/** The official lockup: the app icon mark and the "hilads" wordmark (never plain UI text). */
export function Wordmark({ height = 28 }) {
  return (
    <span className="joy-lockup" role="img" aria-label="Hilads" style={{ '--h': `${height}px` }}>
      <img src="/logo/icon.svg" alt="" /><span className="joy-word">hilads</span>
    </span>
  )
}
