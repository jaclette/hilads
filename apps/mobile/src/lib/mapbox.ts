import Mapbox from '@rnmapbox/maps';

/**
 * Mapbox setup (V3-07, SPEC 9.5): the public token from the build environment
 * (EXPO_PUBLIC_MAPBOX_TOKEN, never committed: GitHub push protection refuses it;
 * store builds read it from the EAS environment variable or the build shell,
 * .env.local never reaches them), telemetry off (the SDK would
 * otherwise send location and usage data to Mapbox), and the map styles: the
 * standard Mapbox light / dark styles until the Hilads Studio style is set in
 * EXPO_PUBLIC_MAPBOX_STYLE_LIGHT / _DARK.
 */
const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

export const MAP_STYLE = {
  light: process.env.EXPO_PUBLIC_MAPBOX_STYLE_LIGHT || 'mapbox://styles/mapbox/light-v11',
  dark:  process.env.EXPO_PUBLIC_MAPBOX_STYLE_DARK  || 'mapbox://styles/mapbox/dark-v11',
};

/** In city scope, never below this zoom: the map stays at city level. */
export const MIN_ZOOM = 9;
/**
 * World scope (V4 test fixes): the whole world with one bubble per city. Below
 * MIN_ZOOM the base style's labels and borders are hidden (WORLD_HIDDEN_LAYERS):
 * the bubbles carry the names, and no disputed border or island name is drawn
 * at a world scale.
 */
export const WORLD_ZOOM = 1.6;
export const WORLD_MIN_ZOOM = 1;
export const WORLD_HIDDEN_LAYERS = [
  'continent-label', 'country-label', 'state-label', 'settlement-major-label', 'settlement-minor-label',
  'settlement-subdivision-label', 'airport-label', 'poi-label', 'water-point-label', 'water-line-label',
  'natural-point-label', 'natural-line-label', 'waterway-label', 'road-label',
  'admin-0-boundary', 'admin-0-boundary-bg', 'admin-0-boundary-disputed', 'admin-1-boundary', 'admin-1-boundary-bg',
];
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
