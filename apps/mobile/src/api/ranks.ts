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
export type PlayersRanks = Base & { entries: PlayerEntry[]; me: PlayerEntry | null; total: number; played?: boolean };
export type CitiesRanks  = Base & { entries: CityEntry[]; mine: CityEntry | null; total: number };
/** My best photo of the period: its rank and the likes it needs to pass the one above (null at #1). */
export interface MyBestPhoto { rank: number; proofId: string; votes: number; comments: number; gap: number | null }
/** A page of the photos ranking (likes, then comments, then the earliest posted); rank comes from the server. */
export type PhotosRanks  = Base & {
  /** prevRank (week): the rank in yesterday's standing, null = new on the board. */
  items: { rank: number; prevRank?: number | null; proof: DailyProof }[]; total?: number; nextOffset?: number | null; me?: MyBestPhoto | null;
  cityBest?: { proof: DailyProof }[]; endsAt?: number | null; played?: boolean;
};

export function fetchRanks(tab: 'players', o: { period: RanksPeriod; scope: RanksScope; cityId?: number | null }): Promise<PlayersRanks>;
export function fetchRanks(tab: 'cities', o: { period: RanksPeriod; cityId?: number | null }): Promise<CitiesRanks>;
export function fetchRanks(tab: 'photos', o: { period: RanksPeriod; scope: RanksScope; cityId?: number | null; offset?: number }): Promise<PhotosRanks>;
export function fetchRanks(tab: RanksTab, o: { period: RanksPeriod; scope?: RanksScope; cityId?: number | null; offset?: number }): Promise<unknown> {
  return api.get('/ranks', { params: { tab, period: o.period, scope: o.scope ?? 'world', cityId: o.cityId ?? undefined, offset: o.offset || undefined } });
}
