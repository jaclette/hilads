import { api } from './client';
import type { DailyThemeKey } from '@/types';

/** A spot (V3-03): a Hilads place with approved proofs. */
export interface Spot {
  id:               string;
  name:             string;
  lat:              number;
  lng:              number;
  city:             { id: number; name: string | null; country?: string | null } | null;
  themes:           DailyThemeKey[];
  tags:             string[];
  proofCount:       number;
  votes:            number;
  votesWeek:        number;
  validatedByLocal: boolean;
  priceRange:       { min: number; max: number; median?: number; currency: string } | null;
  lastProofDate:    string | null;
  cover:            { photoUrl: string | null; thumbUrl: string | null; caption: string | null };
  /** GET /spots/near only. */
  distanceM?:       number;
}

/**
 * The nearest spots (Today's "Spots near you"): around a position when given,
 * else the city centre. fallback: the city has none, these are the nearest anywhere.
 */
/** center 'city': around the chosen city's centre because I'm not in it ("Spots in <city>"). */
export function fetchSpotsNear(opts: { lat?: number; lng?: number; cityId?: string | number | null }): Promise<{
  items: Spot[]; fallback: boolean; center?: 'me' | 'city' | 'unknown';
  city?: { id: number; name: string; country: string | null } | null;
}> {
  return api.get('/spots/near', {
    params: {
      lat:    opts.lat !== undefined ? opts.lat.toFixed(4) : undefined,
      lng:    opts.lng !== undefined ? opts.lng.toFixed(4) : undefined,
      cityId: cityNumber(opts.cityId),
    },
  });
}

/** A Hi plan as a dated pin (GET /map with a cityId). */
export interface PlanPin {
  id:               string;
  title:            string;
  lat:              number;
  lng:              number;
  startsAt:         number;
  endsAt:           number;
  recurring:        boolean;
  participantCount: number;
}

export interface MapData {
  spots:     Spot[];
  truncated: boolean;
  plans:     PlanPin[];
  city:      { id: number; name: string; lat: number; lng: number } | null;
}

export type Bbox = [number, number, number, number];   // minLng, minLat, maxLng, maxLat

function cityNumber(cityId?: string | number | null): string | number | undefined {
  if (cityId === null || cityId === undefined) return undefined;
  return typeof cityId === 'string' ? cityId.replace(/^city_/, '') : cityId;
}

function bboxParam(b?: Bbox | null): string | undefined {
  return b ? b.map(n => n.toFixed(5)).join(',') : undefined;
}

/** GET /map: spots in the city or the area (most voted first) and, with a cityId, its Hi plans. */
export function fetchMap(opts: { cityId?: string | number | null; bbox?: Bbox | null; theme?: string | null }): Promise<MapData> {
  return api.get<MapData>('/map', {
    params: { cityId: cityNumber(opts.cityId), bbox: bboxParam(opts.bbox), theme: opts.theme ?? undefined },
  });
}

/** GET /spots/search: spots whose name or dish tags match, in the city or the area. */
export function searchSpots(q: string, opts: { cityId?: string | number | null; bbox?: Bbox | null }): Promise<{ items: Spot[] }> {
  return api.get('/spots/search', { params: { q, cityId: opts.bbox ? undefined : cityNumber(opts.cityId), bbox: bboxParam(opts.bbox) } });
}

export interface SpotPhoto {
  id:               string;
  photoUrl:         string;
  thumbUrl:         string | null;
  caption:          string | null;
  price:            { amount: number; currency: string } | null;
  date:             string | null;
  theme:            DailyThemeKey | null;
  user:             { id: string; username: string | null; displayName: string | null; photoUrl: string | null };
  isLocal:          boolean;
  voteCount:        number;
  validatedByLocal: boolean;
}

export interface SpotDetail {
  spot:     Spot;
  ranking:  { week: number | null; alltime: number | null; cityName: string | null; cityCountry?: string | null } | null;
  photos:   { items: SpotPhoto[]; nextOffset: number | null };
  captions: { text: string; date: string | null; username: string | null }[];
}

/** GET /spots/{id}: a spot with its ranking, photos (paged) and latest captions. */
export function fetchSpot(id: string, offset = 0, guestId?: string | null): Promise<SpotDetail> {
  return api.get<SpotDetail>(`/spots/${id}`, { params: { offset: offset || undefined, guestId: guestId ?? undefined } });
}
