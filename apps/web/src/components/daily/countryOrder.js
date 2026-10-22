/**
 * The shared country orders, the same as the app's (src/features/daily/countryOrder.ts):
 * a country's photos best first, and countries best first wherever they're compared.
 */

/** A country's photos: the most liked, then the most recent (the server's top photo rule). */
export function compareCountryProofs(a, b) {
  return (b.voteCount - a.voteCount) || ((b.approvedAt ?? b.createdAt ?? 0) - (a.approvedAt ?? a.createdAt ?? 0))
}

/** A country's photos in that order, its top photo (the mosaic tile's) always first. */
export function rankCountryProofs(list, topId) {
  const top = list.find(p => p.id === topId)
  const rest = list.filter(p => p.id !== topId).sort(compareCountryProofs)
  return top ? [top, ...rest] : rest
}

/**
 * Countries (Today's mosaic, the challenge's bubbles, "See all"): my country
 * first, then the top photo's likes, the number of photos, the most recent.
 * (Today's stories row keeps its own order: unseen first.)
 */
export function compareCountryGroups(a, b, myCountry) {
  const mine = (myCountry ?? '').toUpperCase()
  return Number(b.country === mine) - Number(a.country === mine)
    || (b.top.voteCount - a.top.voteCount) || (b.count - a.count) || (b.latestAt - a.latestAt)
}

let last = null
/** The last country list Today showed: Today's photos follows its story order. */
export function rememberCountries(data) { last = data }
export function lastCountries() { return last }
