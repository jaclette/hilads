import { FlagSticker, ACCENTS } from '../joy/Joy'
import { answerText } from './compareShared'
import { useDc } from './dailyShared'

const MAX = 6

/** A stable number from a string (rotation and tint never change between renders). */
function hash(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

/** A hex accent as a translucent tint. */
function tint(hex, alpha) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * Each bubble's tint: from its country and the day (the same all day, another
 * the next), moved to the next accent when it would match the bubble before
 * it, so two neighbours never share a color.
 */
function tints(countries, seed) {
  const n = ACCENTS.length
  const out = []
  countries.forEach((c, i) => {
    let k = hash(`${c}|${seed}`) % n
    while (i > 0 && k === out[i - 1]) k = (k + 1) % n   // each bubble steps away from the one before
    out.push(k)
  })
  return out.map(k => tint(ACCENTS[k], 0.22))
}

/** A photo's line in its bubble: its answer, else its caption, else its place. */
function bubbleText(g, locale) {
  const p = g.top
  if (p.answer && !p.backHome) return answerText(p.answer, locale)
  return p.caption ?? p.spot?.name ?? p.place?.name ?? ''
}

/**
 * "The world says" (the app's WorldBubbles): one speech bubble per country
 * (its flag and its top photo's answer), wrapping, slightly rotated (-2° to
 * +2°, fixed per country) on a joyful tint never shared with its neighbour,
 * the tail corner alternating; up to 6, then "+N more". They pop in one after
 * the other (none with "reduce motion", in CSS). Nobody yet: one dashed "Be
 * the first to answer". `items` in the shared country order.
 */
export default function WorldBubbles({ items, seed, onOpen, onFirst }) {
  const { t, i18n } = useDc()
  if (items.length === 0) {
    return (
      <div className="wb">
        <button type="button" className="wb-bubble wb-bubble--empty" style={{ '--r': '-1deg' }} onClick={onFirst} disabled={!onFirst}>
          {t('worldSays.first')}
        </button>
      </div>
    )
  }
  const shown = items.slice(0, MAX)
  const more = items.length - shown.length
  const colors = tints(shown.map(g => g.country), seed)
  return (
    <div className="wb">
      {shown.map((g, i) => {
        const text = bubbleText(g, i18n.language)
        return (
          <button key={g.country} type="button" className={`wb-bubble wb-bubble--${i % 2 === 0 ? 'left' : 'right'}`}
                  style={{ background: colors[i], '--r': `${(hash(g.country) % 41) / 10 - 2}deg`, '--d': `${i * 40}ms` }}
                  onClick={() => onOpen(g.country)} aria-label={`${g.city.name}: ${text}`}>
            <FlagSticker country={g.country} size={18} />
            <span className="wb-text">{text}</span>
          </button>
        )
      })}
      {more > 0 && (
        <button type="button" className="wb-bubble wb-bubble--more" style={{ '--r': '1deg', '--d': `${shown.length * 40}ms` }} onClick={() => onOpen(null)}>
          {t('worldSays.more', { count: more })}
        </button>
      )}
    </div>
  )
}
