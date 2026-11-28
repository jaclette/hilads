import { shortCityName } from '../../i18n/cityName'
import { COMMENT_TYPES, commentLine } from '../../lib/commentLine'

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
    case 'mention': case 'city_here': return 'mention'
    case 'friend_request_received': return 'friendRequest'
    case 'friend_request_accepted': case 'friend_added': return 'friendAccepted'
    case 'profile_view': return 'profileView'
    case 'vibe_received': return 'vibe'
    case 'wave': return 'wave'
    case 'wave_back': return 'waveBack'
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
    // Scoring v2: rank-ups are in this season's ranking (period: 'season'); older rows were weekly.
    const season = d.period === 'season'
    return plain(d.scope === 'world'
      ? t(season ? 'inbox.row.rankUpWorldSeason' : 'inbox.row.rankUpWorld', { rank: d.rank })
      : t(season ? 'inbox.row.rankUpSeason' : 'inbox.row.rankUp', { rank: d.rank, where: city }))
  }
  // Scoring v2: seasons and the new rewards (as the app).
  if (item.type === 'daily_season_result') {
    return plain(d.variant === 'medal' ? t('inbox.row.seasonMedal', { rank: d.rank }) : t('inbox.row.seasonResult', { rank: d.rank, count: d.points ?? 0 }))
  }
  if (item.type === 'daily_season_ending') {
    return plain(d.rank === 1 ? t('inbox.row.seasonEndingFirst', { count: d.days ?? 3 }) : t('inbox.row.seasonEnding', { count: d.days ?? 3, rank: d.rank }))
  }
  if (item.type === 'daily_perfect_week') return plain(t('inbox.row.perfectWeek', { points: d.points ?? 30 }))
  if (item.type === 'daily_friend_signed_up') {
    return { parts: [{ text: d.name ?? (d.username ? '@' + d.username : ''), bold: true }, { text: ' ' + t('inbox.row.friendSignedUp', { points: d.points ?? 10 }), bold: false }], quote: null }
  }
  if (item.type === 'daily_friend_joined') {
    return { parts: [{ text: d.name ?? (d.username ? '@' + d.username : ''), bold: true }, { text: ' ' + t('inbox.row.friendJoined', { points: d.points ?? 10, count: d.count ?? 1, max: d.max ?? 5 }), bold: false }], quote: null }
  }
  if (item.type === 'daily_crew_bonus') return plain(t('inbox.row.crewBonus', { points: d.points ?? 50, max: d.max ?? 5 }))
  // Comments on Daily photos: the same line as the Today card and the push (commentLine), the actor's name in bold.
  if (COMMENT_TYPES.includes(item.type)) {
    const parts = []
    commentLine(item, t, MARK).split(MARK).forEach((chunk, i) => {
      if (i > 0) parts.push({ text: item.actors?.[0]?.name ?? d.actorName ?? '', bold: true })
      if (chunk) parts.push({ text: chunk, bold: false })
    })
    return { parts, quote: item.body }
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
  return { parts, quote: key === 'mention' ? item.body : null }
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
    // Comments and photo mentions: the same line as the Notifications rows and the push (commentLine).
    case 'photo_comment': case 'photo_mention': return commentLine(i, t)
    case 'daily_vote': return t('away.likes', { count: items.filter(x => x.type === 'daily_vote').reduce((n, x) => n + x.count, 0) })
    case 'mention': return name ? t('away.mention', { name }) : null
    case 'friend_request_received': return name ? t('away.friend', { name }) : null
    case 'profile_view': return name ? t('away.view', { name }) : null
    default: return null
  }
}

/** Unseen items as one line, most important first, each kind once ("💬 Lan also commented on Maxime's photo · ❤️ +12"). */
// The first fragment is always a readable sentence (likes alone: "❤️ 3 new likes on your photo", not
// "❤️ +3"); `race` (my rank changed in the campaign's race) comes right after yesterday's results.
export function awayLine(items, t, max = 3, race = null) {
  const parts = []
  for (const i of byImportance(items)) {
    if (race && i.type !== 'daily_result' && !parts.includes(race)) parts.push(race)
    let f = fragment(i, items, t)
    if (f && i.type === 'daily_vote' && parts.length === 0) {
      const likes = items.filter(x => x.type === 'daily_vote')
      const n = likes.reduce((sum, x) => sum + (x.count ?? 1), 0)
      f = sameObject(likes) !== null || likes.length === 1 ? t('away.likesLine', { count: n }) : t('away.likesLinePhotos', { count: n })
    }
    if (f && !parts.includes(f)) parts.push(f)
  }
  if (race && !parts.includes(race)) parts.push(race)
  if (!parts.length) parts.push(t('away.other'))
  return parts.slice(0, max).join(' · ')
}

/** The object (photo, plan) every item is about, when they all are about the same one. */
export function sameObject(items) {
  const keys = items.map(i => (i.object?.id ? `${i.object.kind}:${i.object.id}` : null))
  return keys[0] && keys.every(k => k === keys[0]) ? keys[0] : null
}
