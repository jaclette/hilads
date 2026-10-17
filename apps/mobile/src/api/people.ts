import { api } from './client';

/** GET /channels/{cityId}/people (V3-04): counts below `min` come back null. */
export interface PeopleCounts {
  nearby:       number | null;
  hiNow:        number | null;
  arrivalsWeek: number | null;
  tonight:      { id: string; title: string; startsAt: number; going: number | null }[];
  min:          number;
}

export function fetchPeopleCounts(cityId: string | number): Promise<PeopleCounts> {
  const n = typeof cityId === 'string' ? cityId.replace(/^city_/, '') : cityId;
  return api.get<PeopleCounts>(`/channels/${n}/people`);
}
