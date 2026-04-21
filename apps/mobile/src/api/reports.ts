import { api, ApiError } from './client';

export type ExistingReport = {
  id:         number;
  created_at: string;
  status:     string;
};

export class DuplicateReportError extends Error {
  constructor(public existing: ExistingReport) {
    super('already_reported');
    this.name = 'DuplicateReportError';
  }
}

export async function submitReport(params: {
  reason: string;
  guestId?: string | null;
  targetUserId?: string | null;
  targetGuestId?: string | null;
  targetNickname?: string | null;
}): Promise<void> {
  try {
    await api.post('/reports', {
      reason:          params.reason,
      guestId:         params.guestId         ?? undefined,
      target_user_id:  params.targetUserId    ?? null,
      target_guest_id: params.targetGuestId   ?? null,
      target_nickname: params.targetNickname  ?? null,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && err.body?.existing_report) {
      throw new DuplicateReportError(err.body.existing_report as ExistingReport);
    }
    throw err;
  }
}

export async function fetchReportStatus(params: {
  guestId?: string | null;
  targetUserId?: string | null;
  targetGuestId?: string | null;
}): Promise<{ reported: boolean; existing?: ExistingReport }> {
  const res = await api.get<{ reported: boolean; existing_report?: ExistingReport }>(
    '/reports/status',
    {
      params: {
        guestId:         params.guestId         ?? undefined,
        target_user_id:  params.targetUserId    ?? undefined,
        target_guest_id: params.targetGuestId   ?? undefined,
      },
    },
  );
  return { reported: res.reported, existing: res.existing_report };
}
