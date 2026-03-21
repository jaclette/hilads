/**
 * Static city → country flag mapping.
 * Covers all cities defined in CityRepository.php.
 * Emoji flags work natively on all modern browsers / OS.
 */
const CITY_FLAGS = {
  'Paris':            '🇫🇷',
  'London':           '🇬🇧',
  'New York':         '🇺🇸',
  'Tokyo':            '🇯🇵',
  'Sydney':           '🇦🇺',
  'São Paulo':        '🇧🇷',
  'Cairo':            '🇪🇬',
  'Mumbai':           '🇮🇳',
  'Bangkok':          '🇹🇭',
  'Mexico City':      '🇲🇽',
  'Lagos':            '🇳🇬',
  'Istanbul':         '🇹🇷',
  'Buenos Aires':     '🇦🇷',
  'Los Angeles':      '🇺🇸',
  'Singapore':        '🇸🇬',
  'Dubai':            '🇦🇪',
  'Berlin':           '🇩🇪',
  'Nairobi':          '🇰🇪',
  'Seoul':            '🇰🇷',
  'Ho Chi Minh City': '🇻🇳',
}

/** Returns the country flag emoji for a city name, or 🌍 as fallback. */
export function cityFlag(name) {
  return CITY_FLAGS[name] ?? '🌍'
}
