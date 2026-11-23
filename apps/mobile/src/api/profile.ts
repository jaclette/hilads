import { api } from './client';
import type { DailyProof } from '@/types';
import type { Season } from './daily';

/** The player profile's game summary (GET /users/{id}/card, ProfileCard on the server). */
export type ProfileRank = { rank: number; points: number };
export type ProfilePhoto = { proof: DailyProof; podium: number | null };
export type Duel = { date: string; theme: string | null; mine: DailyProof; theirs: DailyProof; winner: 'me' | 'them' };
export type Duels = { me: number; them: number; total: number; duels: Duel[]; nextOffset: number | null };
export type ProfileCard = {
  wins: number;
  season: Season & { world: ProfileRank | null; city: (ProfileRank & { city: { id: number; name: string | null; country: string | null } }) | null };
  crown: boolean;
  photos: { items: ProfilePhoto[]; total: number; nextOffset: number | null };
  /** null on my own profile. */
  duels: Duels | null;
};

export function fetchProfileCard(userId: string): Promise<ProfileCard> {
  return api.get<ProfileCard>(`/users/${userId}/card`);
}
export function fetchUserPhotos(userId: string, offset = 0): Promise<ProfileCard['photos']> {
  return api.get(`/users/${userId}/photos`, { params: { offset } });
}
export function fetchUserDuels(userId: string, offset = 0): Promise<Duels> {
  return api.get(`/users/${userId}/duels`, { params: { offset } });
}
