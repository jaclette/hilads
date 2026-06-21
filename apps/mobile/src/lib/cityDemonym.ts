/**
 * City → demonym for the "Most {demonym}" leaderboard title (e.g. Ho Chi Minh
 * City → "Saigonese", Paris → "Parisian"). Curated for the cities we know;
 * anything not listed falls back to null so the caller shows "Most Local".
 *
 * Demonyms are kept in a single base form (English) for now - full per-language
 * demonyms would be a much larger translation effort.
 */
const DEMONYMS: Record<string, string> = {
  'ho chi minh city': 'Saigonese',
  'saigon':           'Saigonese',
  'hanoi':            'Hanoian',
  'da nang':          'Da Nang local',
  'paris':            'Parisian',
  'london':           'Londoner',
  'new york':         'New Yorker',
  'new york city':    'New Yorker',
  'tokyo':            'Tokyoite',
  'bangkok':          'Bangkokian',
  'singapore':        'Singaporean',
  'berlin':           'Berliner',
  'barcelona':        'Barcelonan',
  'madrid':           'Madrilenian',
  'amsterdam':        'Amsterdammer',
  'rome':             'Roman',
  'milan':            'Milanese',
  'lisbon':           'Lisbonite',
  'porto':            'Portuense',
  'sydney':           'Sydneysider',
  'melbourne':        'Melburnian',
  'los angeles':      'Angeleno',
  'san francisco':    'San Franciscan',
  'seoul':            'Seoulite',
  'hong kong':        'Hongkonger',
  'bali':             'Balinese',
  'jakarta':          'Jakartan',
  'kuala lumpur':     'KL-ite',
};

export function cityDemonym(name: string | null | undefined): string | null {
  if (!name) return null;
  return DEMONYMS[name.trim().toLowerCase()] ?? null;
}
