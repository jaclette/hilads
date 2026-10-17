import Mapbox from '@rnmapbox/maps';

/**
 * Mapbox setup (V3-07, SPEC 9.5): the public token from the build environment
 * (EXPO_PUBLIC_MAPBOX_TOKEN, never committed), telemetry off (the SDK would
 * otherwise send location and usage data to Mapbox), and the map styles: the
 * standard Mapbox light / dark styles until the Hilads Studio style is set in
 * EXPO_PUBLIC_MAPBOX_STYLE_LIGHT / _DARK.
 */
const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

export const MAP_STYLE = {
  light: process.env.EXPO_PUBLIC_MAPBOX_STYLE_LIGHT || 'mapbox://styles/mapbox/light-v11',
  dark:  process.env.EXPO_PUBLIC_MAPBOX_STYLE_DARK  || 'mapbox://styles/mapbox/dark-v11',
};

/** Never below this zoom: the map stays at city level (Vietnam's islands are never drawn at a world scale). */
export const MIN_ZOOM = 9;
export const CITY_ZOOM = 13.5;

let ready = false;

/** Configure the SDK once; false when no token was bundled (the map then shows a notice). */
export function setupMapbox(): boolean {
  if (ready) return true;
  if (!TOKEN) return false;
  Mapbox.setAccessToken(TOKEN);
  Mapbox.setTelemetryEnabled(false);
  ready = true;
  return true;
}
