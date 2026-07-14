/**
 * Silently correct an IP-mislocated city when a precise GPS fix becomes
 * available (from any feature that requests location - never a boot prompt).
 *
 * First launch places the city from the device IP (useAppBoot), which some ISP
 * ranges geolocate badly (e.g. Free SAS in France → Strasbourg instead of the
 * real Bayonne area). When a feature later obtains real GPS, geoFeature calls
 * runCityCorrection → this corrector resolves the true nearest city and:
 *   - always refreshes `detectedCity` (so "Back to my location" points right),
 *   - auto-switches the active city ONLY if the user is still sitting on the
 *     auto-placed city (city === detectedCity) - so a manual browse is respected.
 * Runs at most once per session.
 */
import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { useApp } from '@/context/AppContext';
import { resolveLocation, joinChannel } from '@/api/channels';
import { saveIdentity } from '@/lib/identity';
import { socket } from '@/lib/socket';
import { track } from '@/services/analytics';
import { setCityCorrector } from '@/lib/gpsCityCorrection';

export function useGpsCityCorrection(): void {
  const {
    city, detectedCity, identity, sessionId, account,
    setCity, setDetectedCity, setJustPlacedCity, setIdentity,
  } = useApp();

  // Latest state, read by the (once-registered) corrector without re-registering.
  const ref = useRef({ city, detectedCity, identity, sessionId, account });
  ref.current = { city, detectedCity, identity, sessionId, account };
  const doneRef = useRef(false);

  useEffect(() => {
    const corrector = (coords: { lat: number; lng: number }) => {
      if (doneRef.current) return;
      void (async () => {
        const s = ref.current;
        try {
          // Reverse-geocode the country so nearest-city stays in-country (best-effort).
          let country: string | undefined;
          try {
            const geo = await Location.reverseGeocodeAsync({ latitude: coords.lat, longitude: coords.lng });
            country = geo?.[0]?.isoCountryCode ?? undefined;
          } catch { /* country optional */ }

          const accurate = await resolveLocation(coords.lat, coords.lng, country);
          if (!accurate?.channelId) return;

          // Always refresh the "your real location" reference.
          setDetectedCity(accurate);

          // Auto-switch only when the user is still on the auto-placed city.
          const onAutoCity = s.city != null && s.detectedCity != null
            && s.city.channelId === s.detectedCity.channelId;
          if (!onAutoCity || accurate.channelId === s.city?.channelId) return;

          doneRef.current = true;
          const nickname = account?.display_name ?? s.identity?.nickname ?? '';
          setCity(accurate);
          if (s.identity) {
            const updated = { ...s.identity, channelId: accurate.channelId };
            saveIdentity(updated).catch(() => {});
            setIdentity(updated);
            if (s.sessionId) {
              joinChannel(accurate.channelId, s.sessionId, s.identity.guestId, nickname).catch(() => {});
              socket.joinCity(accurate.channelId, s.sessionId, nickname, s.account?.id, s.identity.guestId);
            }
          }
          setJustPlacedCity(accurate); // one-shot "we moved you to {city}" banner
          track('gps_city_corrected', { to: accurate.name });
        } catch { /* correction is best-effort */ }
      })();
    };

    setCityCorrector(corrector);
    return () => setCityCorrector(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
