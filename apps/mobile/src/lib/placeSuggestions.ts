/**
 * Real places around a position (shops, cafés, markets...) from the Mapbox
 * Search Box reverse lookup, for the proof's place step: tapping one makes the
 * new Hilads place with that name. Only the name is used: the place's position
 * stays the device position, like a typed new place. One request per lookup
 * (billed per request, 50k a month free). Empty on any failure: the place step
 * never depends on it.
 */
const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';
const URL = 'https://api.mapbox.com/search/searchbox/v1/reverse';
/** Farther than this, a suggestion isn't where the player is. */
const MAX_M = 150;
const TIMEOUT_MS = 6_000;

export interface PlaceSuggestion { id: string; name: string; category: string | null; distanceM: number }

/** The app language as Mapbox spells it; null when Mapbox has no such language (its default then). */
function mapboxLanguage(lang: string): string | null {
  const l = lang.toLowerCase();
  if (l === 'zh-hans') return 'zh-Hans';
  if (l === 'zh-hant') return 'zh-Hant';
  if (l.startsWith('pt')) return 'pt';
  if (l === 'fil') return null;
  return l.split('-')[0];
}

function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2
          + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lng2 - lng1) * r / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

export async function fetchPlaceSuggestions(lat: number, lng: number, lang: string): Promise<PlaceSuggestion[]> {
  if (!TOKEN) return [];
  const params = new URLSearchParams({
    longitude: lng.toFixed(6), latitude: lat.toFixed(6), types: 'poi', limit: '10', access_token: TOKEN,
  });
  const language = mapboxLanguage(lang);
  if (language) params.set('language', language);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${URL}?${params}`, { signal: controller.signal });
    if (!res.ok) return [];
    const body = await res.json();
    const out: PlaceSuggestion[] = [];
    for (const f of body?.features ?? []) {
      const p = f?.properties ?? {};
      const [fLng, fLat] = f?.geometry?.coordinates ?? [];
      const name = typeof p.name === 'string' ? p.name.trim() : '';
      if (!name || typeof fLat !== 'number' || typeof fLng !== 'number') continue;
      const d = distanceM(lat, lng, fLat, fLng);
      if (d > MAX_M) continue;
      out.push({ id: String(p.mapbox_id ?? name), name, category: p.poi_category?.[0] ?? null, distanceM: Math.round(d) });
    }
    return out.sort((a, b) => a.distanceM - b.distanceM);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
