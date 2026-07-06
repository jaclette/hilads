import { BASE_URL } from '@/constants';
import type { City } from '@/types';

// First-launch IP→city detection, with NO GPS prompt.
//
// Reuses the SAME edge function the web landing calls - https://hilads.live/api/geo
// (on BASE_URL, not the api.* backend). It reads the device's IP at Vercel's edge
// and returns the nearest supported city by proximity / country fallback. Public
// GET, no auth, no new mobile-specific endpoint.
//
// Returns a City on a confident match, or null on unknown / timeout / offline /
// error - in which case the caller routes to the first-time city picker.

// Generous vs web (600ms): mobile networks are more variable, and this only gates
// the first-launch path, never blocks boot indefinitely (AbortController below).
const GEO_TIMEOUT_MS = 500;

export type IpDetectFailure = 'timeout' | 'offline' | 'error';

export interface IpDetectResult {
  city: City | null;
  /** Present only when city is null, for the first_launch_ip_detection_failed reason. */
  failure?: IpDetectFailure;
}

export async function fetchIpCity(): Promise<IpDetectResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEO_TIMEOUT_MS);
  try {
    const r = await fetch(`${BASE_URL}/api/geo`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) return { city: null, failure: 'error' };
    const json: any = await r.json();
    if (json && json.state === 'city_matched' && json.channelId) {
      const name: string = json.city;
      return {
        city: {
          channelId: String(json.channelId),
          name,
          country: json.country ?? '',
          timezone: json.timezone ?? 'UTC',
          slug: (name ?? '').toLowerCase().replace(/\s+/g, '-'),
        },
      };
    }
    // Valid response, but no confident match → unknown (not a failure).
    return { city: null };
  } catch (e: any) {
    // Abort (timeout) vs network-down (offline) vs anything else.
    const failure: IpDetectFailure = e?.name === 'AbortError' ? 'timeout' : 'offline';
    return { city: null, failure };
  } finally {
    clearTimeout(timer);
  }
}
