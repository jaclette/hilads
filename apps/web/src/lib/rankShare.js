/**
 * Web twin of mobile's constants.buildLeaderboardUrl + lib/buildRankShareMessage.
 * Builds the "share my rank" message (+ @mention list so neighbours get a push)
 * and the leaderboard deeplink carrying the current scope+period filter.
 *
 * Two variants, driven by scope:
 *   - user  (city / world): subject is ME; neighbours are @mentioned users.
 *   - city  (cities scope): subject is MY CITY; neighbours are other cities,
 *     NO @mentions (a city isn't a pushable user).
 * Mention offsets are computed against the built string (indexOf the "@name"
 * token) so localized templates read naturally. Returns null when there isn't
 * enough context (subject or the two neighbours missing) → CTA hidden.
 */

import { countryToFlag } from './countryFlag'

export function buildLeaderboardUrl(scope, period) {
  // No locale prefix: the shared message is English-only and the leaderboard is
  // an in-app overlay (not an SSR page), so the prefix would be dead weight.
  return `${window.location.origin}/leaderboard?scope=${encodeURIComponent(scope)}&period=${encodeURIComponent(period)}`
}

function pushMention(text, mentions, name, userId, from) {
  if (!userId || !name) return from
  const token = '@' + name
  const offset = text.indexOf(token, from)
  if (offset === -1) return from
  mentions.push({ userId, offset, length: token.length })
  return offset + token.length
}

// args: { scope, period, entries, me, myCityId, placeCityName, url, t }
export function buildRankShareMessage({ scope, period, entries, me, myCityId, placeCityName, url, t }) {
  const isCities = scope === 'cities'

  // The shared text is a CHAT message read by people of every language, so it's
  // always built in English (not the sharer's locale) - force lng:'en'.
  const tEn = (key, opts) => t(key, { ...(opts || {}), lng: 'en' })

  let subjectRank = null
  let subjectPoints = 0
  if (isCities) {
    const mine = (entries || []).find(e =>
      (myCityId && e.city_id === myCityId) || (!!placeCityName && e.cityName === placeCityName))
    if (!mine || mine.rank == null) return null
    subjectRank = mine.rank; subjectPoints = mine.points
  } else {
    if (!me || me.rank == null) return null
    subjectRank = me.rank; subjectPoints = me.points
  }

  const byRank = (r) => (entries || []).find(e => e.rank === r) ?? null
  const label  = (e) => isCities
    ? `${countryToFlag(e.cityCountry ?? null) ?? ''} ${e.cityName ?? ''}`.trim()
    : (e.displayName ?? '')

  const periodStr = period === 'alltime' ? tEn('leaderboard.share.periodAll') : tEn('leaderboard.share.periodMonth')
  // {place} carries its own preposition ("in Saigon"/"in the World") so the
  // template stays preposition-free. Cities variant uses the bare city name.
  const place = isCities
    ? (placeCityName ?? '')
    : (scope === 'world'
        ? tEn('leaderboard.share.placeWorld')
        : tEn('leaderboard.share.placeCity', { city: placeCityName ?? '' }))

  const mentions = []
  let text

  if (subjectRank === 1) {
    const b1 = byRank(2), b2 = byRank(3)
    if (!b1 || !b2) return null
    text = tEn(isCities ? 'leaderboard.share.cityTop' : 'leaderboard.share.userTop', {
      rank: subjectRank, pts: subjectPoints, place, period: periodStr,
      below1: label(b1), b1Pts: b1.points, below2: label(b2), b2Pts: b2.points,
    })
    if (!isCities) {
      const i = pushMention(text, mentions, label(b1), b1.user_id, 0)
      pushMention(text, mentions, label(b2), b2.user_id, i)
    }
  } else {
    const above = byRank(subjectRank - 1), below = byRank(subjectRank + 1)
    if (!above || !below) return null
    text = tEn(isCities ? 'leaderboard.share.cityNotTop' : 'leaderboard.share.userNotTop', {
      rank: subjectRank, pts: subjectPoints, place, period: periodStr,
      above: label(above), aPts: above.points, below: label(below), bPts: below.points,
    })
    if (!isCities) {
      const i = pushMention(text, mentions, label(above), above.user_id, 0)
      pushMention(text, mentions, label(below), below.user_id, i)
    }
  }

  return { text: `${text}\n${url}`, mentions }
}
