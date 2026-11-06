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

/** Unseen first, then by day. */
export function sectionOf(item, now = new Date()) {
  if (!item.seen && !item.read) return 'new'
  const at = new Date(item.created_at)
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((day(now) - day(at)) / 86400000)
  return diff <= 0 ? 'today' : diff === 1 ? 'yesterday' : diff < 7 ? 'week' : 'earlier'
}

/** Unseen items as one fun line ("🏆 #2 in the world yesterday · 💬 Lan commented on your photo · ❤️ +12"). */
export function awayLine(items, t, max = 3) {
  const parts = []
  for (const g of items.filter(i => i.category === 'game')) {
    const d = g.data ?? {}
    if (g.type === 'daily_result') {
      const city = shortCityName(d.cityName)
      parts.push(d.worldRank ? t('away.rankWorld', { rank: d.worldRank })
        : d.cityBest ? t('away.cityBest', { city })
        : d.cityRank ? t('away.rankCity', { rank: d.cityRank, city })
        : t('away.votes', { count: d.votes ?? 0 }))
    } else if (g.type === 'daily_local_pass') {
      parts.push(t('away.localPass', { city: shortCityName(d.cityName ?? '') }))
    }
  }
  const comments = items.filter(i => i.type === 'photo_comment')
  if (comments.length === 1 && comments[0].count === 1 && comments[0].actors[0]) parts.push(t('away.comment', { name: comments[0].actors[0].name }))
  else if (comments.length) parts.push(t('away.comments'))
  const likes = items.filter(i => i.type === 'daily_vote').reduce((n, i) => n + i.count, 0)
  if (likes > 0) parts.push(t('away.likes', { count: likes }))
  for (const i of items) {
    const name = i.actors?.[0]?.name
    if (!name) continue
    if (i.type === 'mention' || i.type === 'photo_mention') parts.push(t('away.mention', { name }))
    else if (i.type === 'friend_request_received') parts.push(t('away.friend', { name }))
    else if (i.type === 'profile_view') parts.push(t('away.view', { name }))
  }
  if (!parts.length) parts.push(t('away.other'))
  return parts.slice(0, max).join(' · ')
}
