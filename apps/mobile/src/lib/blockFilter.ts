/**
 * Client-side block filter - applies on top of the server-side filter so the
 * UI updates instantly when the user taps Block (no refetch round-trip).
 *
 * Identity model mirrors the server: a content author has either a userId
 * (registered) or a guestId (anonymous). Each entry in the blocked set is a
 * single ID kept in two Sets for O(1) lookup.
 */

export interface BlockedSet {
  userIds:  Set<string>;
  guestIds: Set<string>;
}

export const EMPTY_BLOCKED_SET: BlockedSet = {
  userIds:  new Set<string>(),
  guestIds: new Set<string>(),
};

export function isBlocked(
  authorUserId:  string | null | undefined,
  authorGuestId: string | null | undefined,
  set:           BlockedSet,
): boolean {
  if (authorUserId  && set.userIds.has(authorUserId))   return true;
  if (authorGuestId && set.guestIds.has(authorGuestId)) return true;
  return false;
}

/**
 * Filter an array by a block set. The picker callback returns the user / guest
 * identity for each item - it's a callback (not fixed field names) because
 * lists across the app shape author identity differently:
 *   - Message:           { userId, guestId }
 *   - DM list row:       { other_user_id, other_guest_id }
 *   - Online user:       { userId, guestId }
 *   - Notification:      { data.senderUserId, data.actorId, ... }
 */
export function filterBlocked<T>(
  items:   T[],
  pickIds: (item: T) => { userId?: string | null; guestId?: string | null },
  set:     BlockedSet,
): T[] {
  if (set.userIds.size === 0 && set.guestIds.size === 0) return items;
  return items.filter(item => {
    const { userId, guestId } = pickIds(item);
    return !isBlocked(userId, guestId, set);
  });
}

/**
 * Build a BlockedSet from the API row shape returned by GET /users/me/blocks.
 * Each row has blocked_user_id and/or blocked_guest_id (one or the other).
 */
export function blockedSetFromApiRows(
  rows: Array<{ blocked_user_id?: string | null; blocked_guest_id?: string | null }>,
): BlockedSet {
  const set: BlockedSet = {
    userIds:  new Set<string>(),
    guestIds: new Set<string>(),
  };
  for (const r of rows) {
    if (r.blocked_user_id)  set.userIds.add(r.blocked_user_id);
    if (r.blocked_guest_id) set.guestIds.add(r.blocked_guest_id);
  }
  return set;
}
