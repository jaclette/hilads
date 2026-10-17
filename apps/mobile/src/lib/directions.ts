import { Linking, Platform } from 'react-native';

/**
 * Directions in the phone's own maps app (SPEC 9.5): Apple Maps on iOS, the
 * default maps app through geo: on Android. Never Google Maps URLs (Google
 * Maps Platform is out of Hilads).
 */
export function directionsUrl(lat: number, lng: number, name?: string | null): string {
  const ll = `${lat},${lng}`;
  if (Platform.OS === 'ios') {
    return `https://maps.apple.com/?daddr=${ll}${name ? `&q=${encodeURIComponent(name)}` : ''}`;
  }
  return `geo:${ll}?q=${ll}${name ? `(${encodeURIComponent(name)})` : ''}`;
}

/** A place to show (no route): same apps, a pin at that position. */
export function placeUrl(lat: number, lng: number, name?: string | null): string {
  const ll = `${lat},${lng}`;
  if (Platform.OS === 'ios') {
    return `https://maps.apple.com/?ll=${ll}${name ? `&q=${encodeURIComponent(name)}` : '&q=' + ll}`;
  }
  return `geo:${ll}?q=${ll}${name ? `(${encodeURIComponent(name)})` : ''}`;
}

/** A place known only by its text (no coordinates): a search in the maps app. */
export function searchUrl(query: string): string {
  return Platform.OS === 'ios'
    ? `https://maps.apple.com/?q=${encodeURIComponent(query)}`
    : `geo:0,0?q=${encodeURIComponent(query)}`;
}

export function openMapsUrl(url: string): void {
  Linking.openURL(url).catch(() => {});
}
