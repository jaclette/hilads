<?php

declare(strict_types=1);

/**
 * User-block flow.
 *
 * A block is a one-way row in `blocks` from blocker to blocked. Both sides of
 * the pair can be either a registered user or a guest, mirroring the identity
 * model in `user_reports`. We treat blocks as bidirectional at *query* time
 * (see getBidirectional) so the blocked party also can't see the blocker -
 * Apple's Guideline 1.2 requires mutual invisibility.
 *
 * Listing endpoints LEFT JOIN `users` here so the Settings → Blocked Users
 * screen renders avatars + display names without a second round-trip.
 */
class BlockRepository
{
    // ── Write ─────────────────────────────────────────────────────────────────

    /**
     * Create a block. Idempotent: returns the existing row on conflict.
     * Caller has already validated identity (one of blocker_*, one of blocked_*).
     */
    public static function create(
        ?string $blockerUserId,
        ?string $blockerGuestId,
        ?string $blockedUserId,
        ?string $blockedGuestId,
        ?string $targetNickname = null,
        ?string $reason = null
    ): array {
        try {
            $stmt = Database::pdo()->prepare("
                INSERT INTO blocks
                    (blocker_user_id, blocker_guest_id, blocked_user_id, blocked_guest_id, target_nickname, reason)
                VALUES (?, ?, ?, ?, ?, ?)
                RETURNING id, blocker_user_id, blocker_guest_id,
                          blocked_user_id, blocked_guest_id, target_nickname,
                          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at
            ");
            $stmt->execute([$blockerUserId, $blockerGuestId, $blockedUserId, $blockedGuestId, $targetNickname, $reason]);
            return $stmt->fetch(\PDO::FETCH_ASSOC);
        } catch (\PDOException $e) {
            // 23505 = unique_violation - another request for the same pair won the race.
            // Surface the existing row so the caller's POST stays idempotent (200/201 either way).
            if ((string) $e->getCode() === '23505') {
                $existing = self::find($blockerUserId, $blockerGuestId, $blockedUserId, $blockedGuestId);
                if ($existing !== null) return $existing;
            }
            throw $e;
        }
    }

    /**
     * Delete a block by row id. Caller's identity is verified to match
     * `blocker_*` so users can only unblock their own blocks.
     * Returns true if a row was deleted.
     */
    public static function deleteById(int $id, ?string $blockerUserId, ?string $blockerGuestId): bool
    {
        if ($blockerUserId === null && $blockerGuestId === null) return false;

        $blockerCol   = $blockerUserId !== null ? 'blocker_user_id' : 'blocker_guest_id';
        $blockerParam = $blockerUserId ?? $blockerGuestId;

        $stmt = Database::pdo()->prepare("DELETE FROM blocks WHERE id = ? AND $blockerCol = ?");
        $stmt->execute([$id, $blockerParam]);
        return $stmt->rowCount() > 0;
    }

    /**
     * Delete a block by target identity. Used by the unblock action when the
     * caller has the target's userId/guestId but not the row id (e.g. the
     * "Re-block from same screen" path).
     */
    public static function deleteByTarget(
        ?string $blockerUserId,
        ?string $blockerGuestId,
        ?string $blockedUserId,
        ?string $blockedGuestId
    ): bool {
        $existing = self::find($blockerUserId, $blockerGuestId, $blockedUserId, $blockedGuestId);
        if ($existing === null) return false;
        return self::deleteById((int) $existing['id'], $blockerUserId, $blockerGuestId);
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    /**
     * Find the existing block row for (blocker, blocked) - null if none.
     */
    public static function find(
        ?string $blockerUserId,
        ?string $blockerGuestId,
        ?string $blockedUserId,
        ?string $blockedGuestId
    ): ?array {
        if (($blockerUserId === null && $blockerGuestId === null)
         || ($blockedUserId === null && $blockedGuestId === null)) {
            return null;
        }

        $blockerCol   = $blockerUserId !== null ? 'blocker_user_id' : 'blocker_guest_id';
        $blockerParam = $blockerUserId ?? $blockerGuestId;
        $blockedCol   = $blockedUserId !== null ? 'blocked_user_id' : 'blocked_guest_id';
        $blockedParam = $blockedUserId ?? $blockedGuestId;

        $stmt = Database::pdo()->prepare("
            SELECT id, blocker_user_id, blocker_guest_id,
                   blocked_user_id, blocked_guest_id, target_nickname,
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at
            FROM blocks
            WHERE $blockerCol = ? AND $blockedCol = ?
            LIMIT 1
        ");
        $stmt->execute([$blockerParam, $blockedParam]);
        return $stmt->fetch(\PDO::FETCH_ASSOC) ?: null;
    }

    /**
     * All blocks made BY the given identity, joined with users for display.
     * Powers the Settings → Blocked Users screen. Falls back to target_nickname
     * when the blocked side is a guest (no users row to join).
     */
    public static function listOutgoing(?string $blockerUserId, ?string $blockerGuestId): array
    {
        if ($blockerUserId === null && $blockerGuestId === null) return [];

        $blockerCol   = $blockerUserId !== null ? 'b.blocker_user_id' : 'b.blocker_guest_id';
        $blockerParam = $blockerUserId ?? $blockerGuestId;

        $stmt = Database::pdo()->prepare("
            SELECT b.id,
                   b.blocked_user_id,
                   b.blocked_guest_id,
                   COALESCE(u.display_name, b.target_nickname) AS display_name,
                   u.profile_thumb_photo_url,
                   u.profile_photo_url,
                   to_char(b.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at
            FROM blocks b
            LEFT JOIN users u ON u.id = b.blocked_user_id
            WHERE $blockerCol = ?
            ORDER BY b.created_at DESC
        ");
        $stmt->execute([$blockerParam]);
        return $stmt->fetchAll(\PDO::FETCH_ASSOC);
    }

    /**
     * Bidirectional block set for a viewer: every userId/guestId the viewer
     * has either blocked OR been blocked by. Returned as flat ID lists ready
     * for splicing into NOT IN (...) clauses on content queries.
     *
     * Returns:
     *   [
     *     'user_ids'  => string[],
     *     'guest_ids' => string[],
     *   ]
     *
     * This is the function every content endpoint calls once per request,
     * before running its main query.
     */
    public static function getBidirectional(?string $userId, ?string $guestId): array
    {
        if ($userId === null && $guestId === null) {
            return ['user_ids' => [], 'guest_ids' => []];
        }

        // Match rows where the viewer is on EITHER side of the block.
        $conditions = [];
        $params     = [];
        if ($userId !== null) {
            $conditions[] = '(blocker_user_id = ? OR blocked_user_id = ?)';
            $params[]     = $userId;
            $params[]     = $userId;
        }
        if ($guestId !== null) {
            $conditions[] = '(blocker_guest_id = ? OR blocked_guest_id = ?)';
            $params[]     = $guestId;
            $params[]     = $guestId;
        }
        $where = implode(' OR ', $conditions);

        $stmt = Database::pdo()->prepare("
            SELECT blocker_user_id, blocker_guest_id, blocked_user_id, blocked_guest_id
            FROM blocks
            WHERE $where
        ");
        $stmt->execute($params);

        $userIds  = [];
        $guestIds = [];
        while ($row = $stmt->fetch(\PDO::FETCH_ASSOC)) {
            // For each block row, "the other side" relative to the viewer is what we want.
            $isViewerBlocker = ($userId  !== null && $row['blocker_user_id']  === $userId)
                            || ($guestId !== null && $row['blocker_guest_id'] === $guestId);
            if ($isViewerBlocker) {
                if ($row['blocked_user_id']  !== null) $userIds[]  = $row['blocked_user_id'];
                if ($row['blocked_guest_id'] !== null) $guestIds[] = $row['blocked_guest_id'];
            } else {
                if ($row['blocker_user_id']  !== null) $userIds[]  = $row['blocker_user_id'];
                if ($row['blocker_guest_id'] !== null) $guestIds[] = $row['blocker_guest_id'];
            }
        }

        return [
            'user_ids'  => array_values(array_unique($userIds)),
            'guest_ids' => array_values(array_unique($guestIds)),
        ];
    }

    /**
     * Quick yes/no: does either side of (A, B) block the other? Used by send
     * endpoints (DMs, friend requests, vibes) to refuse contact across a block.
     */
    public static function isBlockedBetween(
        ?string $userIdA,
        ?string $guestIdA,
        ?string $userIdB,
        ?string $guestIdB
    ): bool {
        // Build (blocker, blocked) pair conditions for both directions, only
        // for identity types that are actually populated on each side.
        $pairs = [];
        // A blocks B
        $pairs[] = [$userIdA,  $guestIdA,  $userIdB,  $guestIdB];
        // B blocks A
        $pairs[] = [$userIdB,  $guestIdB,  $userIdA,  $guestIdA];

        $conditions = [];
        $params     = [];
        foreach ($pairs as [$brU, $brG, $bdU, $bdG]) {
            if ($brU !== null && $bdU !== null) {
                $conditions[] = '(blocker_user_id = ? AND blocked_user_id = ?)';
                $params[]     = $brU;
                $params[]     = $bdU;
            }
            if ($brU !== null && $bdG !== null) {
                $conditions[] = '(blocker_user_id = ? AND blocked_guest_id = ?)';
                $params[]     = $brU;
                $params[]     = $bdG;
            }
            if ($brG !== null && $bdU !== null) {
                $conditions[] = '(blocker_guest_id = ? AND blocked_user_id = ?)';
                $params[]     = $brG;
                $params[]     = $bdU;
            }
            if ($brG !== null && $bdG !== null) {
                $conditions[] = '(blocker_guest_id = ? AND blocked_guest_id = ?)';
                $params[]     = $brG;
                $params[]     = $bdG;
            }
        }

        if (empty($conditions)) return false;

        $where = implode(' OR ', $conditions);
        $stmt  = Database::pdo()->prepare("SELECT 1 FROM blocks WHERE $where LIMIT 1");
        $stmt->execute($params);
        return (bool) $stmt->fetchColumn();
    }
}
