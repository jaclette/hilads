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
 * An account's city confirmed by GPS or chosen by the user is never switched
 * silently (V5-01): the server keeps it and reports it (switchFrom), and the
 * app asks "You're in Potsdam. Switch from Berlin?" (CitySwitchSheet). "Stay"
 * isn't asked again for that city during the session.
 * Runs at most once per session.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { useApp } from '@/context/AppContext';
import { resolveLocation, joinChannel, setMyCity, type CitySwitchFrom } from '@/api/channels';
import type { City } from '@/types';
import { saveIdentity } from '@/lib/identity';
import { socket } from '@/lib/socket';
import { track } from '@/services/analytics';
import { markGpsCity, setCityCorrector } from '@/lib/gpsCityCorrection';

/** GPS found another city than the account's: the switch to offer. */
export interface CityProposal { to: City; from: CitySwitchFrom }

/** Cities the user answered "Stay" for, this session. */
const declined = new Set<string>();

export function useGpsCityCorrection(): {
  proposal: CityProposal | null; accept: () => void; stay: () => void;
} {
  const {
    city, detectedCity, identity, sessionId, account,
    setCity, setDetectedCity, setJustPlacedCity, setIdentity,
  } = useApp();

  // Latest state, read by the (once-registered) corrector without re-registering.
  const ref = useRef({ city, detectedCity, identity, sessionId, account });
  ref.current = { city, detectedCity, identity, sessionId, account };
  const doneRef = useRef(false);
  const [proposal, setProposal] = useState<CityProposal | null>(null);

  /** Make a city the active one (browse + chat presence), as a first placement does. */
  const moveTo = useCallback((to: City) => {
    const s = ref.current;
    const nickname = s.account?.display_name ?? s.identity?.nickname ?? '';
    setCity(to);
    if (s.identity) {
      const updated = { ...s.identity, channelId: to.channelId };
      saveIdentity(updated).catch(() => {});
      setIdentity(updated);
      if (s.sessionId) {
        joinChannel(to.channelId, s.sessionId, s.identity.guestId, nickname).catch(() => {});
        socket.joinCity(to.channelId, s.sessionId, nickname, s.account?.id, s.identity.guestId);
      }
    }
  }, [setCity, setIdentity]);

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

          // The account's city stayed (GPS-confirmed or chosen): ask, never switch silently.
          if (accurate.switchFrom) {
            if (declined.has(accurate.channelId)) return;
            doneRef.current = true;
            setProposal({ to: accurate, from: accurate.switchFrom });
            track('city_switch_proposed', { from: accurate.switchFrom.name, to: accurate.name });
            return;
          }

          // Always refresh the "your real location" reference.
          setDetectedCity(accurate);
          markGpsCity(accurate.channelId);

          // Auto-switch only when the user is still on the auto-placed city.
          const onAutoCity = s.city != null && s.detectedCity != null
            && s.city.channelId === s.detectedCity.channelId;
          if (!onAutoCity || accurate.channelId === s.city?.channelId) return;

          doneRef.current = true;
          moveTo(accurate);
          setJustPlacedCity(accurate); // one-shot "we moved you to {city}" banner
          track('gps_city_corrected', { to: accurate.name });
        } catch { /* correction is best-effort */ }
      })();
    };

    setCityCorrector(corrector);
    return () => setCityCorrector(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accept = useCallback(() => {
    const p = proposal;
    setProposal(null);
    if (!p) return;
    track('city_switch_accepted', { from: p.from.name, to: p.to.name });
    setDetectedCity(p.to);
    markGpsCity(p.to.channelId);
    moveTo(p.to);
    setMyCity({ channelId: p.to.channelId }).catch(() => {});
  }, [proposal, moveTo, setDetectedCity]);

  const stay = useCallback(() => {
    const p = proposal;
    setProposal(null);
    if (!p) return;
    declined.add(p.to.channelId);
    track('city_switch_declined', { from: p.from.name, to: p.to.name });
  }, [proposal]);

  return { proposal, accept, stay };
}
