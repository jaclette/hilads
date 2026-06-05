<?php

declare(strict_types=1);

/**
 * Spectator lane — public commentary on a public challenge, kept separate
 * from the active 1:1 thread (creator + acceptor) that lives in `messages`.
 *
 * Why a separate table:
 *   - The 1:1 thread is the private/operational space; comments are the
 *     public commentary surface. Mixing them would force one of them into
 *     awkward visibility shapes.
 *   - Comments noindex/visibility logic is cleaner — you toggle the table
 *     off (route gate) when the challenge isn't public, no MessageRepository
 *     filter to maintain.
 *   - Moderation is_hidden lets a row stay in the table for audit while
 *     hidden from display.
 *
 * Visibility rule:
 *   - Public challenge → anyone (including anon) can read.
 *   - Friends challenge → only friends-of-creator + active participants
 *     (read), but POSTs are still allowed for those scoped viewers. (For
 *     the MVP we just refuse comment POSTs entirely on non-public rows
 *     and hide the read surface — keeps the spectator lane unambiguous.)
 *   - Private challenge → no comments at all (existing rows stay in the
 *     DB for audit but the route returns 404).
 */
class ChallengeCommentRepository
{
    /**
     * Insert a comment row. Caller has already validated visibility +
     * moderation + rate limit. Returns the formatted row for direct
     * Response::json.
     */
    public static function create(string $challengeId, string $userId, string $body): array
    {
        $id = bin2hex(random_bytes(16));
        $stmt = Database::pdo()->prepare("
            INSERT INTO challenge_comments (id, challenge_id, user_id, body)
            VALUES (?, ?, ?, ?)
            RETURNING id, challenge_id, user_id, body, is_hidden,
                      EXTRACT(EPOCH FROM created_at)::INTEGER AS created_at
        ");
        $stmt->execute([$id, $challengeId, $userId, $body]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        return self::format($row, /* hydrateUser */ true);
    }

    /**
     * Paginated read — newest first. Caller decides whether is_hidden rows
     * should be included (typically NO for normal reads, YES for the
     * creator's moderation view). $beforeId is a cursor; null = first page.
     */
    public static function listForChallenge(
        string $challengeId,
        ?string $beforeId = null,
        int $limit = 50,
        bool $includeHidden = false
    ): array {
        $limit = max(1, min(100, $limit));
        $where = "cc.challenge_id = :cid";
        $params = ['cid' => $challengeId];
        if (!$includeHidden) {
            $where .= " AND cc.is_hidden = FALSE";
        }
        if ($beforeId !== null) {
            $where .= " AND cc.created_at < (SELECT created_at FROM challenge_comments WHERE id = :before)";
            $params['before'] = $beforeId;
        }

        $stmt = Database::pdo()->prepare("
            SELECT cc.id, cc.challenge_id, cc.user_id, cc.body, cc.is_hidden,
                   EXTRACT(EPOCH FROM cc.created_at)::INTEGER AS created_at,
                   u.display_name             AS user_display_name,
                   u.username                 AS user_username,
                   u.profile_thumb_photo_url  AS user_thumb_avatar_url
            FROM challenge_comments cc
            LEFT JOIN users u ON u.id = cc.user_id AND u.deleted_at IS NULL
            WHERE $where
            ORDER BY cc.created_at DESC
            LIMIT $limit
        ");
        $stmt->execute($params);
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];
        return array_map(static fn(array $r): array => self::format($r), $rows);
    }

    public static function findById(string $id): ?array
    {
        $stmt = Database::pdo()->prepare("
            SELECT cc.id, cc.challenge_id, cc.user_id, cc.body, cc.is_hidden,
                   EXTRACT(EPOCH FROM cc.created_at)::INTEGER AS created_at,
                   u.display_name             AS user_display_name,
                   u.username                 AS user_username,
                   u.profile_thumb_photo_url  AS user_thumb_avatar_url
            FROM challenge_comments cc
            LEFT JOIN users u ON u.id = cc.user_id AND u.deleted_at IS NULL
            WHERE cc.id = ?
        ");
        $stmt->execute([$id]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$row) return null;
        return self::format($row);
    }

    /**
     * Soft-hide for moderation. The row stays in the DB so a future audit
     * can review what was hidden and why — match the existing pattern for
     * messages where deletion is rare and reversible.
     */
    public static function hide(string $id): bool
    {
        $stmt = Database::pdo()->prepare("
            UPDATE challenge_comments SET is_hidden = TRUE WHERE id = ?
        ");
        $stmt->execute([$id]);
        return $stmt->rowCount() > 0;
    }

    /**
     * Hard delete — used when the comment owner deletes their own row.
     * No soft-delete here because the user is exercising their own
     * agency over their own content (not a moderation action).
     */
    public static function deleteByOwner(string $id, string $userId): bool
    {
        $stmt = Database::pdo()->prepare("
            DELETE FROM challenge_comments WHERE id = ? AND user_id = ?
        ");
        $stmt->execute([$id, $userId]);
        return $stmt->rowCount() > 0;
    }

    private static function format(array $row, bool $hydrateUser = false): array
    {
        // Only used for the just-inserted row in create() — we don't have
        // the JOINed user fields yet, so do one read of users to fill them.
        if ($hydrateUser) {
            $u = Database::pdo()->prepare("
                SELECT display_name, username, profile_thumb_photo_url
                FROM users WHERE id = ? AND deleted_at IS NULL
            ");
            $u->execute([$row['user_id']]);
            $userRow = $u->fetch(\PDO::FETCH_ASSOC) ?: [];
            $row['user_display_name']     = $userRow['display_name']            ?? null;
            $row['user_username']         = $userRow['username']                ?? null;
            $row['user_thumb_avatar_url'] = $userRow['profile_thumb_photo_url'] ?? null;
        }
        return [
            'id'           => $row['id'],
            'challenge_id' => $row['challenge_id'],
            'user_id'      => $row['user_id'],
            'body'         => $row['body'],
            'is_hidden'    => (bool) ($row['is_hidden'] ?? false),
            'created_at'   => isset($row['created_at']) ? (int) $row['created_at'] : null,
            'user' => [
                'id'             => $row['user_id'],
                'displayName'    => $row['user_display_name']     ?? null,
                'username'       => $row['user_username']         ?? null,
                'thumbAvatarUrl' => $row['user_thumb_avatar_url'] ?? null,
            ],
        ];
    }
}
