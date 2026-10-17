// Icon names (see components/Icon.jsx) per product concept, the same ones
// the mobile app uses so both clients show the same stroke icons.

/** Daily Challenge themes (mobile: features/today/format THEME_ICON). */
export const THEME_ICON = {
  language:     'chatbubbles-outline',
  street_food:  'fast-food-outline',
  coffee:       'cafe-outline',
  market:       'basket-outline',
  night_out:    'moon-outline',
  neighborhood: 'storefront-outline',
  traditions:   'flower-outline',
}

/** Plan categories plus imported-event types (mobile: EventPill eventIcon). */
const EVENT_ICONS = {
  drinks: 'wine-outline', party: 'sunny-outline', nightlife: 'moon-outline', music: 'musical-note-outline',
  'live music': 'musical-notes-outline', culture: 'business-outline', art: 'color-palette-outline', food: 'restaurant-outline',
  coffee: 'cafe-outline', sport: 'flash-outline', meetup: 'chatbubble-outline', other: 'grid-outline',
}
export function eventIcon(type) {
  return (type && EVENT_ICONS[type]) || 'calendar-outline'
}

/** Hangout (topic) categories (mobile: TopicCard). */
export const TOPIC_ICONS = {
  general: 'chatbubbles-outline', tips: 'bulb-outline', food: 'restaurant-outline',
  drinks: 'wine-outline', help: 'help-buoy-outline', meetup: 'people-outline',
}

/** Challenge types (mobile: challenge/[id] TYPE_ICONS). */
export const CHALLENGE_TYPE_ICONS = {
  food: 'restaurant-outline', place: 'location-outline', culture: 'color-palette-outline', help: 'happy-outline',
}

/** Vibes (mobile: features/profile/vibes). */
export const VIBE_ICONS = {
  party: 'sparkles-outline', board_games: 'dice-outline', coffee: 'cafe-outline', music: 'headset-outline', food: 'restaurant-outline', chill: 'leaf-outline',
}
