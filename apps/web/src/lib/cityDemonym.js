// City → demonym for the "Most {demonym}" leaderboard title (web mirror of the
// native cityDemonym.ts). Curated; unmapped cities return null → "Most Local".
const DEMONYMS = {
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
}

export function cityDemonym(name) {
  if (!name) return null
  return DEMONYMS[String(name).trim().toLowerCase()] ?? null
}
