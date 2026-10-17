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
  { value: 'drinks',  label: 'Drinks' },
  { value: 'party',   label: 'Party' },
  { value: 'music',   label: 'Music' },
  { value: 'food',    label: 'Food' },
  { value: 'coffee',  label: 'Coffee' },
  { value: 'sport',   label: 'Sport' },
  { value: 'meetup',  label: 'Meetup' },
  { value: 'other',   label: 'Other' },
]
