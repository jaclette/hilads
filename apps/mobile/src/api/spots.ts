import { api } from './client';
import type { DailyThemeKey } from '@/types';

/** A spot (V3-03): a Hilads place with approved proofs. */
export interface Spot {
  id:               string;
  name:             string;
  lat:              number;
  lng:              number;
  city:             { id: number; name: string | null } | null;
  themes:           DailyThemeKey[];
  tags:             string[];
  proofCount:       number;
  votes:            number;
  votesWeek:        number;
  validatedByLocal: boolean;
  priceRange:       { min: number; max: number; currency: string } | null;
  lastProofDate:    string | null;
  cover:            { photoUrl: string | null; thumbUrl: string | null; caption: string | null };
  /** GET /spots/near only. */
  distanceM?:       number;
}

/**
 * The nearest spots (Today's "Spots near you"): around a position when given,
 * else the city centre. fallback: the city has none, these are the nearest anywhere.
 */
export function fetchSpotsNear(opts: { lat?: number; lng?: number; cityId?: string | number | null }): Promise<{ items: Spot[]; fallback: boolean }> {
  const cityId = typeof opts.cityId === 'string' ? opts.cityId.replace(/^city_/, '') : opts.cityId;
  return api.get('/spots/near', {
    params: {
      lat:    opts.lat !== undefined ? opts.lat.toFixed(4) : undefined,
      lng:    opts.lng !== undefined ? opts.lng.toFixed(4) : undefined,
      cityId: cityId ?? undefined,
    },
  });
}
