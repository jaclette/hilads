import { answerText } from './compareShared'

/** An answer's words: the question's answer, else the caption, else the place (the app's worldAnswers). */
export function answerWords(a, locale) {
  if (a.answer && !a.backHome) return answerText(a.answer, locale)
  return (a.caption ?? a.spot ?? a.place ?? '').trim()
}

/** The same answer twice: case, accents, emoji and punctuation left out ("Hảo Hảo!" = "hao hao 🍜"). */
export function answerKey(s) {
  return s.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[\uD800-\uDFFF\u2600-\u27BF\uFE0F\u200D\u20E3]/g, ' ')
    .replace(/[.,!?;:'"’‘“”()[\]{}\-–—…·*~_/\\|#@&+=<>^`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A group's words: the spelling written most often; on a tie, not ALL CAPS, then the most liked (first). */
function spelling(list) {
  const n = new Map()
  for (const s of list) n.set(s, (n.get(s) ?? 0) + 1)
  const shouty = s => (s === s.toUpperCase() && s !== s.toLowerCase() ? 1 : 0)
  return [...n.keys()].sort((a, b) => n.get(b) - n.get(a) || shouty(a) - shouty(b) || list.indexOf(a) - list.indexOf(b))[0]
}

/**
 * Every photo of the day as chips {key, city, text ('' = 📷), ids (most liked first), mine}: one per city
 * and answer, identical answers grouped. My city first, then the cities with the most answers; inside a
 * city, my answer first, then the most given. Without `answers` (an older server): one chip per country.
 */
export function answerChips(data, myCityId, locale) {
  if (!data) return []
  const list = data.answers ?? (data.items ?? []).map(g => ({
    id: g.top.id, city: g.city, caption: g.top.caption ?? null, answer: g.top.answer ?? null, backHome: !!g.top.backHome,
    spot: g.top.spot?.name ?? null, place: g.top.place?.name ?? null, mine: !!g.top.isMine, votes: g.top.voteCount ?? 0,
  }))
  const chips = new Map()
  const cities = new Map()
  for (const a of [...list].sort((x, y) => y.votes - x.votes)) {
    const text = answerWords(a, locale)
    const key = `${a.city.id}|${answerKey(text) || '📷'}`
    const c = chips.get(key)
    if (c) { c.ids.push(a.id); c.mine = c.mine || a.mine; c.spellings.push(text) }
    else chips.set(key, { key, city: a.city, text: answerKey(text) ? text : '', ids: [a.id], mine: a.mine, best: a.votes, spellings: [text] })
    const ct = cities.get(a.city.id) ?? { n: 0, votes: 0 }
    ct.n += 1; ct.votes += a.votes
    cities.set(a.city.id, ct)
  }
  const mineFirst = id => (id === myCityId ? 1 : 0)
  return [...chips.values()].sort((a, b) => {
    if (a.city.id !== b.city.id) {
      const ca = cities.get(a.city.id), cb = cities.get(b.city.id)
      return mineFirst(b.city.id) - mineFirst(a.city.id) || cb.n - ca.n || cb.votes - ca.votes || a.city.name.localeCompare(b.city.name)
    }
    return Number(b.mine) - Number(a.mine) || b.ids.length - a.ids.length || b.best - a.best
  }).map(({ spellings, ...c }) => ({ ...c, text: c.text ? spelling(spellings) : '' }))
}
