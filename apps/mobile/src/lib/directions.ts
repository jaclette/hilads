import { ActionSheetIOS, Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import i18n from '@/i18n';
import { haversineMeters } from '@/lib/distance';

/**
 * Directions to a spot (SPEC 9.5, 2026-10-20): the user's maps app, never
 * OpenStreetMap. Google Maps (its public directions link, which opens the app
 * when installed), Apple Maps (iOS only) and Waze (when installed). No API key,
 * no Google service inside the app. The first tap opens a small chooser; the
 * choice is remembered (Settings > Directions changes it). Walking under 2 km,
 * driving beyond; unknown distance (no position): the maps app decides.
 */
export type MapsApp = 'google' | 'apple' | 'waze';
export const MAPS_APP_NAMES: Record<MapsApp, string> = { google: 'Google Maps', apple: 'Apple Maps', waze: 'Waze' };
const KEY = 'hilads_maps_app';
const WALK_MAX_M = 2000;

type Mode = 'walking' | 'driving' | null;

export function directionsLink(app: MapsApp, lat: number, lng: number, mode: Mode): string {
  const ll = `${lat},${lng}`;
  if (app === 'apple') return `https://maps.apple.com/?daddr=${ll}${mode ? `&dirflg=${mode === 'walking' ? 'w' : 'd'}` : ''}`;
  if (app === 'waze') return `https://waze.com/ul?ll=${ll}&navigate=yes`;
  return `https://www.google.com/maps/dir/?api=1&destination=${ll}${mode ? `&travelmode=${mode}` : ''}`;
}

/** The maps apps this device can use: Google Maps always (web link), Apple Maps on iOS, Waze when installed. */
export async function availableMapsApps(): Promise<MapsApp[]> {
  const out: MapsApp[] = ['google'];
  if (Platform.OS === 'ios') out.push('apple');
  // Needs LSApplicationQueriesSchemes / Android <queries> (app.config.js); false before that native build.
  if (await Linking.canOpenURL('waze://').catch(() => false)) out.push('waze');
  return out;
}

export async function getMapsApp(): Promise<MapsApp | null> {
  const v = await AsyncStorage.getItem(KEY).catch(() => null);
  return v === 'google' || v === 'apple' || v === 'waze' ? v : null;
}

/** null = ask every time. */
export async function setMapsApp(app: MapsApp | null): Promise<void> {
  await (app ? AsyncStorage.setItem(KEY, app) : AsyncStorage.removeItem(KEY)).catch(() => {});
}

/** Walking under 2 km from my last known position, driving beyond; null without a position (never prompts). */
async function travelMode(lat: number, lng: number): Promise<Mode> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 });
    if (!last) return null;
    return haversineMeters(last.coords.latitude, last.coords.longitude, lat, lng) < WALK_MAX_M ? 'walking' : 'driving';
  } catch {
    return null;
  }
}

/**
 * A small chooser of the given apps (an action sheet on iOS, an alert on
 * Android); `extra` adds a last option (Settings: "Ask every time").
 */
export function chooseMapsApp(apps: MapsApp[], extra?: string): Promise<MapsApp | 'extra' | null> {
  const t = (k: string) => i18n.t(k, { ns: 'common' });
  const labels = [...apps.map(a => MAPS_APP_NAMES[a]), ...(extra ? [extra] : [])];
  const pick = (i: number): MapsApp | 'extra' | null => (i < apps.length ? apps[i] : i === apps.length && extra ? 'extra' : null);
  return new Promise(resolve => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: t('directions.chooseTitle'), options: [...labels, t('cancel')], cancelButtonIndex: labels.length },
        i => resolve(pick(i)),
      );
      return;
    }
    Alert.alert(t('directions.chooseTitle'), undefined, [
      ...labels.map((label, i) => ({ text: label, onPress: () => resolve(pick(i)) })),
      { text: t('cancel'), style: 'cancel' as const, onPress: () => resolve(null) },
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
}

/** The Directions button: the remembered app, else the chooser (and remember the pick). */
export async function openDirections(lat: number, lng: number): Promise<void> {
  const apps = await availableMapsApps();
  let app = await getMapsApp();
  if (!app || !apps.includes(app)) {
    const picked = apps.length === 1 ? apps[0] : await chooseMapsApp(apps);
    if (!picked || picked === 'extra') return;
    app = picked;
    await setMapsApp(app);
  }
  Linking.openURL(directionsLink(app, lat, lng, await travelMode(lat, lng))).catch(() => {});
}

/** A place to show (no route): Apple Maps on iOS, the default maps app through geo: on Android. */
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
