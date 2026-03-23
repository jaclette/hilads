/**
 * Returns the country flag emoji from a 2-letter ISO 3166-1 alpha-2 country code.
 * e.g. 'FR' → '🇫🇷', 'US' → '🇺🇸'
 * Falls back to 🌍 for null/unknown codes.
 */
export function cityFlag(countryCode) {
  if (!countryCode || countryCode.length !== 2) return '🌍'
  return [...countryCode.toUpperCase()]
    .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('')
}

export const EVENT_TYPES = [
  { value: 'drinks',  icon: '🍻', label: 'Drinks' },
  { value: 'party',   icon: '🎉', label: 'Party' },
  { value: 'music',   icon: '🎵', label: 'Music' },
  { value: 'food',    icon: '🍽️', label: 'Food' },
  { value: 'coffee',  icon: '☕', label: 'Coffee' },
  { value: 'sport',   icon: '⚽', label: 'Sport' },
  { value: 'meetup',  icon: '👥', label: 'Meetup' },
  { value: 'other',   icon: '📌', label: 'Other' },
]

export const EVENT_ICONS = Object.fromEntries(EVENT_TYPES.map(t => [t.value, t.icon]))
