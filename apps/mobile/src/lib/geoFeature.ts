import * as Location from 'expo-location';
import { track } from '@/services/analytics';

export type GpsFeature =
  | 'share_spot'
  | 'event_location'
  | 'hi_now'
  | 'people_nearby'
  | 'challenge_proof'
  | 'checkin';

export interface GpsResult {
  ok: boolean;
  coords?: { lat: number; lng: number };
  reason?: 'denied' | 'services_off' | 'error';
  /** Permission permanently denied (canAskAgain=false) → offer a Settings deep link. */
  permanentlyDenied?: boolean;
}

/**
 * Request precise location for a SPECIFIC feature, at the moment it's used -
 * never up-front. Mirrors the web lib/gpsFeature:
 *  - Reuse-granted: if already granted, resolves silently (no dialog, no event).
 *  - Ask only when undetermined; emits gps_permission_requested then _granted/_denied.
 *  - Don't nag: a previously/permanently-denied user is not re-prompted.
 * The caller decides how to degrade (Hi now blocks + explains; others soft-fail).
 */
export async function requestFeatureLocation(feature: GpsFeature): Promise<GpsResult> {
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
    const servicesOn = await Location.hasServicesEnabledAsync().catch(() => true);
    if (!servicesOn) return { ok: false, reason: 'services_off' };

    const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 });
    const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return { ok: true, coords: { lat: pos.coords.latitude, lng: pos.coords.longitude } };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
