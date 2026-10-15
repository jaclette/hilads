import { api, ApiError } from './client';
import type {
  DailyArchive,
  DailyProof,
  DailyProofInput,
  DailySheet,
  DailyToday,
} from '@/types';

// Daily Challenge API (docs/daily-challenge/API.md). City ids are the integer
// form the API uses (City.channelId is that integer as a string).

function cityParam(cityId?: string | number | null): number | undefined {
  const n = Number(cityId);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export async function fetchDailyToday(cityId?: string | number | null): Promise<DailyToday> {
  return api.get<DailyToday>('/daily/today', { params: { cityId: cityParam(cityId) } });
}

export async function fetchDailySheet(
  date: string,
  opts: { scope?: 'world' | 'city'; cityId?: string | number | null; before?: number | null; limit?: number; guestId?: string | null } = {},
): Promise<DailySheet> {
  return api.get<DailySheet>(`/daily/challenges/${date}`, {
    params: {
      scope:   opts.scope ?? 'world',
      cityId:  cityParam(opts.cityId),
      before:  opts.before ?? undefined,
      limit:   opts.limit ?? 20,
      guestId: opts.guestId ?? undefined,
    },
  });
}

export async function fetchDailyArchive(
  opts: { cityId?: string | number | null; before?: string | null; limit?: number; guestId?: string | null } = {},
): Promise<DailyArchive> {
  return api.get<DailyArchive>('/daily/archive', {
    params: {
      cityId:  cityParam(opts.cityId),
      before:  opts.before ?? undefined,
      limit:   opts.limit ?? 20,
      guestId: opts.guestId ?? undefined,
    },
  });
}

export async function fetchDailyProof(id: string): Promise<DailyProof> {
  return (await api.get<{ proof: DailyProof }>(`/daily/proofs/${id}`)).proof;
}

export async function createDailyProof(input: DailyProofInput): Promise<DailyProof> {
  return (await api.post<{ proof: DailyProof }>('/daily/proofs', input)).proof;
}

export async function updateDailyProof(id: string, input: DailyProofInput): Promise<DailyProof> {
  return (await api.patch<{ proof: DailyProof }>(`/daily/proofs/${id}`, input)).proof;
}

export async function deleteDailyProof(id: string): Promise<void> {
  await api.delete(`/daily/proofs/${id}`);
}

/** The device's IANA timezone, sent at each launch (Daily pushes at local time). */
export async function sendDeviceTimezone(timezone: string, guestId?: string | null, pushToken?: string | null): Promise<void> {
  await api.post('/daily/device', { timezone, guestId: guestId ?? undefined, pushToken: pushToken ?? undefined });
}

/** The API's machine error code ("already_posted", "moderation_blocked"…), if any. */
export function dailyErrorCode(err: unknown): string | null {
  return err instanceof ApiError && typeof err.body?.code === 'string' ? err.body.code : null;
}

export type DailyReportReason = 'inappropriate' | 'person_without_consent' | 'dangerous' | 'spam' | 'other';

/** Report a visible proof (guests pass their guestId). 409 = already reported. */
export async function reportDailyProof(proofId: string, reasonCode: DailyReportReason, guestId?: string | null): Promise<void> {
  await api.post(`/daily/proofs/${proofId}/report`, { reasonCode, guestId: guestId ?? undefined });
}
