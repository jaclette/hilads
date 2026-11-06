import { api } from './client';
import type { DailyProof } from '@/types';

/** The Ranks tab (V6): GET /ranks. */
export type RanksTab = 'photos' | 'players' | 'cities';
export type RanksPeriod = 'today' | 'yesterday' | 'week' | 'alltime';
export type RanksScope = 'city' | 'world';

export interface RankCity { id: number; name: string; country: string | null }
export interface PlayerEntry {
  rank: number; prevRank: number | null; points: number;
  user: { id: string; displayName: string | null; username: string | null; photoUrl: string | null; isLocal: boolean };
  city: RankCity | null;
  gap?: number; next?: { displayName: string | null; username: string | null };
}
export interface CityEntry {
  rank: number; prevRank: number | null; city: RankCity; photos: number; players: number; likes: number;
  gap?: number; next?: { name: string; country: string | null };
}
interface Base { tab: RanksTab; period: RanksPeriod; scope: RanksScope; cityId: number | null; date: string }
export type PlayersRanks = Base & { entries: PlayerEntry[]; me: PlayerEntry | null; total: number };
export type CitiesRanks  = Base & { entries: CityEntry[]; mine: CityEntry | null; total: number };
export type PhotosRanks  = Base & { items: { rank: number; proof: DailyProof }[]; cityBest?: { proof: DailyProof }[]; endsAt?: number | null };

export function fetchRanks(tab: 'players', o: { period: RanksPeriod; scope: RanksScope; cityId?: number | null }): Promise<PlayersRanks>;
export function fetchRanks(tab: 'cities', o: { period: RanksPeriod; cityId?: number | null }): Promise<CitiesRanks>;
export function fetchRanks(tab: 'photos', o: { period: RanksPeriod; scope: RanksScope; cityId?: number | null }): Promise<PhotosRanks>;
export function fetchRanks(tab: RanksTab, o: { period: RanksPeriod; scope?: RanksScope; cityId?: number | null }): Promise<unknown> {
  return api.get('/ranks', { params: { tab, period: o.period, scope: o.scope ?? 'world', cityId: o.cityId ?? undefined } });
}
