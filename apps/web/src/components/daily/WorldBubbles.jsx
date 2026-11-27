import { FlagSticker, ACCENTS } from '../joy/Joy'
import { useState } from 'react'
import { useDc } from './dailyShared'

const MAX = 8

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
 * Each city's tint: from the city and the day (the same all day, another the next), moved to the
 * next accent when it would match the city before it. A city's chips share its tint.
 */
function cityTints(cityIds, seed) {
  const n = ACCENTS.length
  const out = new Map()
  let prev = -1
  for (const id of cityIds) {
    if (out.has(id)) continue
    let k = hash(`${id}|${seed}`) % n
    if (k === prev) k = (k + 1) % n   // a city steps away from the one before
    prev = k
    out.set(id, tint(ACCENTS[k], 0.22))
  }
  return out
}

/**
 * "The world says" (the app's WorldBubbles): one speech bubble per answer (a city's flag and the
 * answer, identical answers of a city grouped "×3"), my city first with my answer marked "You", then
 * the cities with the most answers; a city's chips side by side in its tint. Slightly rotated, the
 * tail corner alternating; 8 shown, then "+N more" opens the rest in place. They pop in one after the
 * other (none with "reduce motion", in CSS). Nobody yet: one dashed "Be the first to play".
 * `onOpen(ids)`: a chip's photos (most liked first).
 */
export default function WorldBubbles({ chips, seed, onOpen, onFirst }) {
  const { t } = useDc()
  const [open, setOpen] = useState(false)
  if (chips.length === 0) {
    return (
      <div className="wb">
        <button type="button" className="wb-bubble wb-bubble--empty" style={{ '--r': '-1deg' }} onClick={onFirst} disabled={!onFirst}>
          {t('worldSays.first')}
        </button>
      </div>
    )
  }
  const shown = open ? chips : chips.slice(0, MAX)
  const more = chips.length - shown.length
  const colors = cityTints(chips.map(c => c.city.id), seed)
  return (
    <div className="wb">
      {shown.map((c, i) => {
        const text = c.text || '📷'
        return (
          <button key={c.key} type="button" className={`wb-bubble wb-bubble--${i % 2 === 0 ? 'left' : 'right'}${c.mine ? ' wb-bubble--mine' : ''}`}
                  style={{ background: colors.get(c.city.id), '--r': `${(hash(c.key) % 41) / 10 - 2}deg`, '--d': `${(open && i >= MAX ? i - MAX : i) * 40}ms` }}
                  onClick={() => onOpen(c.ids)}
                  aria-label={`${c.city.name}: ${text}${c.ids.length > 1 ? `, ×${c.ids.length}` : ''}${c.mine ? `, ${t('worldSays.you')}` : ''}`}>
            <FlagSticker country={c.city.country} size={18} />
            <span className="wb-text">{text}</span>
            {c.ids.length > 1 && <span className="wb-count">×{c.ids.length}</span>}
            {c.mine && <span className="wb-you">{t('worldSays.you')}</span>}
          </button>
        )
      })}
      {more > 0 && (
        <button type="button" className="wb-bubble wb-bubble--more" style={{ '--r': '1deg', '--d': `${shown.length * 40}ms` }} onClick={() => setOpen(true)}>
          {t('worldSays.more', { count: more })}
        </button>
      )}
    </div>
  )
}
