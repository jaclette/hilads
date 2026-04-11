import { api } from './client';

export async function submitReport(params: {
  reason: string;
  guestId?: string | null;
  targetUserId?: string | null;
  targetGuestId?: string | null;
  targetNickname?: string | null;
}): Promise<void> {
  await api.post('/reports', {
    reason:          params.reason,
    guestId:         params.guestId         ?? undefined,
    target_user_id:  params.targetUserId    ?? null,
    target_guest_id: params.targetGuestId   ?? null,
    target_nickname: params.targetNickname  ?? null,
  });
}
