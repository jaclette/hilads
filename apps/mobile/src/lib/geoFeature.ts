import * as Location from 'expo-location';
import { track } from '@/services/analytics';
import { runCityCorrection } from '@/lib/gpsCityCorrection';

export type GpsFeature =
  | 'share_spot'
  | 'event_location'
  | 'hi_now'
  | 'people_nearby'
  | 'challenge_proof'
  | 'checkin'
  | 'map_locate';

export interface GpsResult {
  ok: boolean;
  coords?: { lat: number; lng: number };
  /** Horizontal accuracy in meters, when known (precise mode). */
  accuracy?: number | null;
  reason?: 'denied' | 'services_off' | 'error';
  /** Permission permanently denied (canAskAgain=false) → offer a Settings deep link. */
  permanentlyDenied?: boolean;
}

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

/**
 * The best fix we can get, in 15 s at most: GPS and the network position are
 * asked at once; GPS wins if it answers within 8 s, otherwise the network
 * position (indoors, no satellites), then a recent last-known one. A coarser
 * fix is still a position: the place step flags it as approximate instead of
 * failing (reported 2026-10-22: "Your position isn't available" at home on LTE,
 * then the spinner stuck on "Finding where you are").
 */
async function preciseFix(): Promise<Location.LocationObject> {
  const gps     = within(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), 8_000);
  const network = within(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 12_000);
  gps.catch(() => {}); network.catch(() => {});
  try { return await gps; } catch {}
  try { return await network; } catch {}
  const last = await within(Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 }), 3_000).catch(() => null);
  if (!last) throw new Error('no fix');
  return last;
}

/**
 * Request precise location for a SPECIFIC feature, at the moment it's used -
 * never up-front. Mirrors the web lib/gpsFeature:
 *  - Reuse-granted: if already granted, resolves silently (no dialog, no event).
 *  - Ask only when undetermined; emits gps_permission_requested then _granted/_denied.
 *  - Don't nag: a previously/permanently-denied user is not re-prompted.
 * The caller decides how to degrade (Hi now blocks + explains; others soft-fail).
 */
export async function requestFeatureLocation(feature: GpsFeature, opts: { precise?: boolean } = {}): Promise<GpsResult> {
  try {
    const existing = await Location.getForegroundPermissionsAsync();
    let granted = existing.status === 'granted';

    if (!granted) {
      // Permanently denied / explicitly denied → don't show a no-op dialog.
      if (!existing.canAskAgain || existing.status === 'denied') {
        track('gps_permission_denied', { feature, reason: 'previously_denied' });
        return { ok: false, reason: 'denied', permanentlyDenied: !existing.canAskAgain };
      }
      // Undetermined → this is the one moment we show the OS dialog.
      track('gps_permission_requested', { feature });
      const res = await Location.requestForegroundPermissionsAsync();
      granted = res.status === 'granted';
      if (!granted) {
        track('gps_permission_denied', { feature });
        return { ok: false, reason: 'denied', permanentlyDenied: !res.canAskAgain };
      }
      track('gps_permission_granted', { feature });
    }

    // Android: permission granted but device location services off.
    const servicesOn = await within(Location.hasServicesEnabledAsync(), 3_000).catch(() => true);
    if (!servicesOn) return { ok: false, reason: 'services_off' };

    // precise: a fresh high-accuracy fix (the Daily proof's distance check, V3-08);
    // otherwise a recent last-known position is enough.
    const last = opts.precise ? null : await within(Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 }), 3_000).catch(() => null);
    const pos = last ?? (opts.precise
      ? await preciseFix()
      : await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    // Opportunistically fix a city that IP-geolocation placed wrong (no prompt -
    // we already have a real fix here). Fire-and-forget; never blocks the caller.
    runCityCorrection(coords);
    return { ok: true, coords, accuracy: pos.coords.accuracy ?? null };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
