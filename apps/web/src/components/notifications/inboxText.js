import { shortCityName } from '../../i18n/cityName'

/** "Lan", "Lan and Minh", "Lan and 3 others" (notifications:inbox.names). */
export function namesOf(item, t) {
  const a = item.actors ?? []
  if (!a.length) return ''
  if (item.count <= 1) return a[0].name
  if (item.count === 2 && a[1]) return t('inbox.names.two', { a: a[0].name, b: a[1].name })
  return t('inbox.names.many', { a: a[0].name, count: item.count - 1 })
}

function keyOf(item) {
  const d = item.data ?? {}
  switch (item.type) {
    case 'daily_vote': return 'like'
    case 'photo_comment': return d.kind === 'author' ? 'comment' : null
    case 'photo_mention': return 'photoMention'
    case 'mention': case 'city_here': return 'mention'
    case 'friend_request_received': return 'friendRequest'
    case 'friend_request_accepted': case 'friend_added': return 'friendAccepted'
    case 'profile_view': return 'profileView'
    case 'vibe_received': return 'vibe'
    case 'event_join': return d.eventTitle ? 'planJoin' : null
    case 'join_request': return d.topicTitle ? 'joinRequest' : null
    case 'join_request_accepted': return d.topicTitle ? 'joinAccepted' : null
    case 'city_join': return item.count > 1 ? 'landedMany' : 'landed'
    case 'world_arrival': return 'landed'
    default: return null
  }
}

const MARK = '\u0001'

/** A row's sentence split so names render bold: {parts: [{text, bold}], quote}. Same rules as the app. */
export function rowText(item, t) {
  const d = item.data ?? {}
  const city = shortCityName(d.cityName ?? '')
  const plain = (text) => ({ parts: [{ text, bold: false }], quote: null })
  if (item.type === 'daily_result') return { parts: [{ text: t('inbox.row.result'), bold: true }], quote: item.body }
  if (item.type === 'daily_local_pass') return plain(t('inbox.row.localPass', { city }))
  if (item.type === 'daily_rank') {
    return plain(d.scope === 'world' ? t('inbox.row.rankUpWorld', { rank: d.rank }) : t('inbox.row.rankUp', { rank: d.rank, where: city }))
  }
  const key = keyOf(item)
  const names = namesOf(item, t)
  if (key === null || (!names && key !== 'joinAccepted' && key !== 'landedMany')) {
    return { parts: [{ text: item.title, bold: true }], quote: item.body }
  }
  const sentence = t(`inbox.row.${key}`, { names: MARK, count: item.count, city, plan: d.eventTitle ?? d.topicTitle ?? '' })
  const parts = []
  sentence.split(MARK).forEach((chunk, i) => {
    if (i > 0) parts.push({ text: names, bold: true })
    if (chunk) parts.push({ text: chunk, bold: false })
  })
  return { parts, quote: ['comment', 'photoMention', 'mention'].includes(key) ? item.body : null }
}

/**
 * A server time as epoch ms: ISO 8601 or Postgres' "2026-11-05 14:00:00.123+00" (Safari can't
 * parse the space or the short offset). NaN when unknown.
 */
export function parseTime(raw) {
  if (raw === null || raw === undefined || raw === '') return NaN
  if (typeof raw === 'number') return raw < 1e10 ? raw * 1000 : raw
  let ms = Date.parse(raw)
  if (isNaN(ms)) {
    const iso = String(raw).trim().replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00').replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
    ms = Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`)
  }
  return ms
}

/** Calendar days between that moment and now, in the reader's time zone (0 = today, 1 = yesterday). */
export function calendarDaysAgo(ms, now = new Date()) {
  const at = new Date(ms)
  const day = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((day(now) - day(at)) / 86400000)
}

/** Unseen first, then by calendar day in the reader's time zone (the same count as the row's "1d"). */
export function sectionOf(item, now = new Date()) {
  if (!item.seen && !item.read) return 'new'
  const ms = parseTime(item.created_at)
  if (isNaN(ms)) return 'earlier'
  const diff = calendarDaysAgo(ms, now)
  return diff <= 0 ? 'today' : diff === 1 ? 'yesterday' : diff < 7 ? 'week' : 'earlier'
}

// What counts most, first (as the app): results, comments, mentions, likes, friends, the Local Pass, profile views.
const PRIORITY = ['daily_result', 'daily_rank', 'photo_comment', 'photo_mention', 'mention', 'daily_vote',
  'friend_request_received', 'daily_local_pass', 'profile_view']
const prio = (i) => { const r = PRIORITY.indexOf(i.type); return r < 0 ? PRIORITY.length : r }

/** The unseen items, the most important first (newest first within a type). */
export function byImportance(items) {
  return [...items].sort((a, b) => prio(a) - prio(b) || String(b.created_at).localeCompare(String(a.created_at)))
}

function fragment(i, items, t) {
  const d = i.data ?? {}
  const name = i.actors?.[0]?.name
  switch (i.type) {
    case 'daily_result': {
      const city = shortCityName(d.cityName)
      return d.worldRank ? t('away.rankWorld', { rank: d.worldRank })
        : d.cityBest ? t('away.cityBest', { city })
        : d.cityRank ? t('away.rankCity', { rank: d.cityRank, city })
        : t('away.votes', { count: d.votes ?? 0 })
    }
    case 'daily_local_pass': return t('away.localPass', { city: shortCityName(d.cityName ?? '') })
    case 'photo_comment': {
      const all = items.filter(x => x.type === 'photo_comment')
      return all.length === 1 && i.count === 1 && name ? t('away.comment', { name }) : t('away.comments')
    }
    case 'daily_vote': return t('away.likes', { count: items.filter(x => x.type === 'daily_vote').reduce((n, x) => n + x.count, 0) })
    case 'mention': case 'photo_mention': return name ? t('away.mention', { name }) : null
    case 'friend_request_received': return name ? t('away.friend', { name }) : null
    case 'profile_view': return name ? t('away.view', { name }) : null
    default: return null
  }
}

/** Unseen items as one line, most important first, each kind once ("💬 New comments on your photo · ❤️ +12"). */
export function awayLine(items, t, max = 3) {
  const parts = []
  for (const i of byImportance(items)) {
    const f = fragment(i, items, t)
    if (f && !parts.includes(f)) parts.push(f)
  }
  if (!parts.length) parts.push(t('away.other'))
  return parts.slice(0, max).join(' · ')
}

/** The object (photo, plan) every item is about, when they all are about the same one. */
export function sameObject(items) {
  const keys = items.map(i => (i.object?.id ? `${i.object.kind}:${i.object.id}` : null))
  return keys[0] && keys.every(k => k === keys[0]) ? keys[0] : null
}
