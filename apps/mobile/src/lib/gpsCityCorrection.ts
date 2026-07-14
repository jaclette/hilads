/**
 * Bridge between the per-feature GPS lib (geoFeature.ts, a pure module) and the
 * app context (useGpsCityCorrection, which owns setCity/detectedCity).
 *
 * The first launch places the user's city from their IP (useAppBoot), which some
 * ISP ranges geolocate badly (e.g. Free SAS in France → Strasbourg instead of
 * Bayonne). Whenever a feature obtains a PRECISE GPS fix, we run it through the
 * registered corrector so a mislocated user gets silently moved to their real
 * city - without ever adding a boot-time location prompt.
 */

type Corrector = (coords: { lat: number; lng: number }) => void;

let corrector: Corrector | null = null;

/** AppContext-aware corrector; registered by useGpsCityCorrection on mount. */
export function setCityCorrector(fn: Corrector | null): void {
  corrector = fn;
}

/** Called (fire-and-forget) by geoFeature whenever it gets a real GPS fix. */
export function runCityCorrection(coords: { lat: number; lng: number }): void {
  try {
    corrector?.(coords);
  } catch {
    /* never let a correction failure break the feature that requested GPS */
  }
}
