import { api } from './client';

/** The Members screen (docs/mockups/hilads_members_mockup.html) and Wave 👋. */

export type WaveState = 'none' | 'sent' | 'received' | 'mutual';
export type MemberFilter = 'all' | 'here' | 'locals' | 'travelers' | 'friends' | 'new';
export type WaveSource = 'members' | 'here_now' | 'profile' | 'plan' | 'likes' | 'notification' | 'push';

export interface MemberCity { id: number; name: string; country: string | null }

export interface Member {
  id:          string;
  username:    string | null;
  displayName: string;
  photo:       string | null;
  mode:        'local' | 'traveler' | null;
  here:        boolean;
  friend:      boolean;
  streak:      number;
  photos:      number;
  duels:       number;
  /** Days since they arrived in the city (World: joined Hilads); 0 = today. */
  joinedDays:  number | null;
  /** World rows only. */
  city:        MemberCity | null;
  canWave:     boolean;
  wave:        WaveState;
}

export type SpotlightCard =
  | { kind: 'top_local' | 'streak' | 'newest'; user: { id: string; displayName: string; photo: string | null }; value: number }
  | { kind: 'top_player'; user: { id: string; displayName: string; photo: string | null }; value: number; city: MemberCity | null }
  | { kind: 'city_week' | 'new_city'; city: MemberCity; value: number };

export interface MembersSummary {
  counts:    { here: number; members: number; cities?: number };
  hereNow:   Member[];
  spotlight: SpotlightCard[];
  /** World only: members per city, most first. */
  cities?:   (MemberCity & { members: number })[];
}

export type MembersScope = { scope: 'city'; cityId: string | number } | { scope: 'world'; cityId?: number | null };

const scopeQuery = (s: MembersScope) =>
  `scope=${s.scope}` + (s.cityId != null && s.cityId !== '' ? `&cityId=${String(s.cityId).replace(/^city_/, '')}` : '');

export function fetchMembersSummary(s: MembersScope): Promise<MembersSummary> {
  return api.get<MembersSummary>(`/members/summary?${scopeQuery(s)}`);
}

export function fetchMembers(s: MembersScope, opts: { filter?: MemberFilter; q?: string; offset?: number } = {}): Promise<{ members: Member[]; nextOffset: number | null }> {
  const q = new URLSearchParams();
  if (opts.filter && opts.filter !== 'all') q.set('filter', opts.filter);
  if (opts.q) q.set('q', opts.q);
  if (opts.offset) q.set('offset', String(opts.offset));
  const extra = q.toString();
  return api.get(`/members?${scopeQuery(s)}${extra ? `&${extra}` : ''}`);
}

/** Wave at someone. Errors: not_found, self, waves_off, already, limit (ApiError body.error). */
export function sendWave(userId: string, source: WaveSource): Promise<{ state: WaveState; back: boolean }> {
  return api.post('/waves', { userId, source });
}

/** The wave state with each of these people (profiles, plan attendees, like lists). */
export function fetchWaveStates(ids: string[]): Promise<Record<string, WaveState>> {
  return api.get<{ states: Record<string, WaveState> }>(`/waves/state?ids=${ids.map(encodeURIComponent).join(',')}`).then(r => r.states ?? {});
}

export function savePrivacy(p: { allowWaves?: boolean; showInMembers?: boolean }): Promise<{ allowWaves: boolean; showInMembers: boolean }> {
  return api.post('/me/privacy', p);
}
