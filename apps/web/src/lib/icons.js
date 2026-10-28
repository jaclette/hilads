import { ICON_NAMES } from '../components/Icon'

// Icon names (see components/Icon.jsx) per product concept, the same ones
// the mobile app uses so both clients show the same stroke icons.

/** Daily Challenge themes v2 (mobile: ui/ThemeIcon). Taste and Only here are drawn (Icon.jsx theme-*). */
export const THEME_ICON = {
  hidden_gem: 'diamond-outline',
  taste:      'theme-taste',
  get_around: 'bus-outline',
  local_find: 'bag-handle-outline',
  night_out:  'moon-outline',
  sip:        'cafe-outline',
  only_here:  'theme-only-here',
  special:    'sparkles-outline',
}

/** A theme's icon name; a special day's own icon when the web has it (Icon.jsx), else sparkles. */
export function themeIcon(key, special) {
  if (key === 'special') return special?.icon && ICON_NAMES.has(special.icon) ? special.icon : 'sparkles-outline'
  return THEME_ICON[key] || 'pricetag-outline'
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
