import { api } from './client';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BlockRow {
  id:                       number;
  blocker_user_id?:          string | null;
  blocker_guest_id?:         string | null;
  blocked_user_id?:          string | null;
  blocked_guest_id?:         string | null;
  target_nickname?:          string | null;
  display_name?:             string | null;
  profile_photo_url?:        string | null;
  profile_thumb_photo_url?:  string | null;
  created_at:                string;
}

interface SubmitBlockParams {
  targetUserId?:    string | null;
  targetGuestId?:   string | null;
  targetNickname?:  string | null;
  reason?:          string | null;
  /** Required for guest blockers (no auth token). */
  guestId?:         string | null;
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

/** Block a user or guest. Idempotent - re-blocking returns the existing row. */
export async function submitBlock(params: SubmitBlockParams): Promise<BlockRow> {
  const res = await api.post<{ block: BlockRow }>('/blocks', {
    target_user_id:  params.targetUserId   ?? null,
    target_guest_id: params.targetGuestId  ?? null,
    target_nickname: params.targetNickname ?? null,
    reason:          params.reason         ?? null,
    guestId:         params.guestId        ?? undefined,
  });
  return res.block;
}

/** Unblock by row id (preferred when the client has it from listMyBlocks). */
export async function unblockById(blockId: number, guestId?: string | null): Promise<void> {
  await api.delete(`/blocks/${blockId}`, guestId ? { guestId } : undefined);
}

/** List blocks I've made - auth required. Powers Settings → Blocked Users. */
export async function fetchMyBlocks(): Promise<BlockRow[]> {
  const data = await api.get<{ blocks: BlockRow[] }>('/users/me/blocks');
  return data.blocks ?? [];
}
