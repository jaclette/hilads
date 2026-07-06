/**
 * Featured-city config for the ad-landing "stories" experience.
 *
 * The stories landing (StoriesLanding.jsx) features ONE city by default with no
 * geo-detection - almost all traffic is Instagram/TikTok ad clicks pointed at a
 * specific city creative. Swap the featured city here (or later drive it from a
 * per-creative param / IP) without touching the landing components.
 *
 *   slug        - resolves the channel via fetchCityBySlug() for the anonymous join
 *   displayName - short punchy name shown in CTAs / headlines ("Saigon")
 */
export const FEATURED_CITY = {
  slug:        'ho-chi-minh-city',
  displayName: 'Saigon',
}

/**
 * People-online display threshold. The live count is real (channel activeUsers),
 * but below this we HIDE the people-online line entirely and lead with the
 * persistent challenges/events counts instead - never a fake number, never an
 * embarrassingly low one.
 */
export const MIN_LIVE_COUNT = 10
