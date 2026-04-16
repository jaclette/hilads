<?php

declare(strict_types=1);

class PresenceRepository
{
    private const TTL = 120; // must match HEARTBEAT_TTL_MS in ws/server.js (2 minutes)

    private static function dbKey(int $channelId): string
    {
        return 'city_' . $channelId;
    }

    /**
     * Upserts presence for the session and optionally returns the current online count.
     *
     * Returns: [ 'isNew' => bool, 'onlineCount' => int ]
     *   isNew        — true if session was absent or expired (emit "just landed" event)
     *   onlineCount  — distinct guest count currently online (0 when $withCount = false)
     *
     * Pass $withCount = true only when the caller actually uses onlineCount (bootstrap).
     * The join endpoint only reads isNew — skipping COUNT(DISTINCT) saves ~100-200ms.
     */
    public static function join(int $channelId, string $sessionId, string $guestId, string $nickname, bool $withCount = false): array
    {
        $key = self::dbKey($channelId);
        $ttl = self::TTL;

        if ($withCount) {
            $stmt = Database::pdo()->prepare("
                WITH
                existing AS (
                    SELECT last_seen_at
                    FROM presence
                    WHERE session_id = ? AND channel_id = ?
                ),
                upserted AS (
                    INSERT INTO presence (session_id, channel_id, guest_id, nickname, last_seen_at)
                    VALUES (?, ?, ?, ?, now())
                    ON CONFLICT (session_id, channel_id) DO UPDATE SET
                        nickname     = EXCLUDED.nickname,
                        last_seen_at = now()
                    RETURNING channel_id
                )
                SELECT
                    NOT EXISTS(
                        SELECT 1 FROM existing
                        WHERE last_seen_at > now() - interval '$ttl seconds'
                    ) AS is_new_session,
                    (SELECT COUNT(DISTINCT guest_id) FROM presence
                     WHERE channel_id = ? AND last_seen_at > now() - interval '$ttl seconds'
                    ) AS online_count
                FROM upserted
            ");
            $stmt->execute([$sessionId, $key, $sessionId, $key, $guestId, $nickname, $key]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return [
                'isNew'       => (bool) ($row['is_new_session'] ?? true),
                'onlineCount' => (int)  ($row['online_count']   ?? 1),
            ];
        }

        // Fast path: upsert + new-session check only — no COUNT(DISTINCT guest_id).
        $stmt = Database::pdo()->prepare("
            WITH
            existing AS (
                SELECT last_seen_at
                FROM presence
                WHERE session_id = ? AND channel_id = ?
            ),
            upserted AS (
                INSERT INTO presence (session_id, channel_id, guest_id, nickname, last_seen_at)
                VALUES (?, ?, ?, ?, now())
                ON CONFLICT (session_id, channel_id) DO UPDATE SET
                    nickname     = EXCLUDED.nickname,
                    last_seen_at = now()
                RETURNING channel_id
            )
            SELECT
                NOT EXISTS(
                    SELECT 1 FROM existing
                    WHERE last_seen_at > now() - interval '$ttl seconds'
                ) AS is_new_session
            FROM upserted
        ");
        $stmt->execute([$sessionId, $key, $sessionId, $key, $guestId, $nickname]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return [
            'isNew'       => (bool) ($row['is_new_session'] ?? true),
            'onlineCount' => 0,
        ];
    }

    /**
     * Combined presence upsert + auth resolution in ONE DB round trip.
     *
     * Used exclusively by the POST /join endpoint to eliminate the second sequential
     * DB query that was previously needed to resolve the authenticated user.
     *
     * $authToken — raw session token from Cookie or Bearer header.
     *   If null or invalid format: auth subquery is skipped (guest path).
     *   If valid: a correlated subquery resolves the user ID in the same round trip.
     *
     * Returns: [ 'isNew' => bool, 'authUserId' => ?string ]
     *   isNew      — true if this is a genuinely new session (emit join feed event)
     *   authUserId — resolved user ID, or null for guests / invalid tokens
     */
    public static function joinWithAuth(int $channelId, string $sessionId, string $guestId, string $nickname, ?string $authToken): array
    {
        $key = self::dbKey($channelId);
        $ttl = self::TTL;

        $hasToken = $authToken !== null && preg_match('/^[a-f0-9]{64}$/', $authToken) === 1;

        if ($hasToken) {
            // Single round-trip: upsert presence AND resolve the authenticated user.
            // The auth subquery adds ~0ms overhead — it's a simple PK lookup on user_sessions.
            $stmt = Database::pdo()->prepare("
                WITH
                existing AS (
                    SELECT last_seen_at
                    FROM presence
                    WHERE session_id = ? AND channel_id = ?
                ),
                upserted AS (
                    INSERT INTO presence (session_id, channel_id, guest_id, nickname, last_seen_at)
                    VALUES (?, ?, ?, ?, now())
                    ON CONFLICT (session_id, channel_id) DO UPDATE SET
                        nickname     = EXCLUDED.nickname,
                        last_seen_at = now()
                    RETURNING channel_id
                )
                SELECT
                    NOT EXISTS(
                        SELECT 1 FROM existing
                        WHERE last_seen_at > now() - interval '$ttl seconds'
                    ) AS is_new_session,
                    (
                        SELECT u.id FROM user_sessions s
                        JOIN users u ON u.id = s.user_id
                        WHERE s.id = ? AND s.expires_at > now() AND u.deleted_at IS NULL
                        LIMIT 1
                    ) AS auth_user_id
                FROM upserted
            ");
            $stmt->execute([$sessionId, $key, $sessionId, $key, $guestId, $nickname, $authToken]);
        } else {
            // Guest path: no token — skip the auth subquery entirely.
            $stmt = Database::pdo()->prepare("
                WITH
                existing AS (
                    SELECT last_seen_at
                    FROM presence
                    WHERE session_id = ? AND channel_id = ?
                ),
                upserted AS (
                    INSERT INTO presence (session_id, channel_id, guest_id, nickname, last_seen_at)
                    VALUES (?, ?, ?, ?, now())
                    ON CONFLICT (session_id, channel_id) DO UPDATE SET
                        nickname     = EXCLUDED.nickname,
                        last_seen_at = now()
                    RETURNING channel_id
                )
                SELECT
                    NOT EXISTS(
                        SELECT 1 FROM existing
                        WHERE last_seen_at > now() - interval '$ttl seconds'
                    ) AS is_new_session,
                    NULL AS auth_user_id
                FROM upserted
            ");
            $stmt->execute([$sessionId, $key, $sessionId, $key, $guestId, $nickname]);
        }

        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return [
            'isNew'      => (bool)   ($row['is_new_session'] ?? true),
            'authUserId' => $row['auth_user_id'] ?? null,
        ];
    }

    public static function leave(int $channelId, string $sessionId): void
    {
        Database::pdo()->prepare("
            DELETE FROM presence
            WHERE session_id = ? AND channel_id = ?
        ")->execute([$sessionId, self::dbKey($channelId)]);
    }

    public static function heartbeat(int $channelId, string $sessionId, string $guestId, string $nickname): void
    {
        Database::pdo()->prepare("
            INSERT INTO presence (session_id, channel_id, guest_id, nickname, last_seen_at)
            VALUES (?, ?, ?, ?, now())
            ON CONFLICT (session_id, channel_id) DO UPDATE SET
                nickname     = EXCLUDED.nickname,
                last_seen_at = now()
        ")->execute([$sessionId, self::dbKey($channelId), $guestId, $nickname]);
    }

    // Remove a session from all channels — used on browser tab close
    public static function disconnect(string $sessionId): void
    {
        Database::pdo()->prepare("
            DELETE FROM presence WHERE session_id = ?
        ")->execute([$sessionId]);
    }

    // Returns unique online users (deduplicated by guestId).
    // Joins users table to supply userId, created_at, home_city for badge resolution.
    public static function getOnline(int $channelId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT DISTINCT ON (p.guest_id)
                p.guest_id   AS \"guestId\",
                p.nickname,
                u.id         AS \"userId\",
                u.created_at AS \"userCreatedAt\",
                u.home_city  AS \"userHomeCity\",
                u.vibe       AS \"userVibe\"
            FROM presence p
            LEFT JOIN users u ON u.guest_id = p.guest_id
            WHERE p.channel_id   = ?
              AND p.last_seen_at > now() - interval '" . self::TTL . " seconds'
            ORDER BY p.guest_id, p.last_seen_at DESC
        ");
        $stmt->execute([self::dbKey($channelId)]);

        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public static function getCount(int $channelId): int
    {
        $stmt = Database::pdo()->prepare("
            SELECT COUNT(DISTINCT guest_id)
            FROM presence
            WHERE channel_id   = ?
              AND last_seen_at > now() - interval '" . self::TTL . " seconds'
        ");
        $stmt->execute([self::dbKey($channelId)]);
        return (int) $stmt->fetchColumn();
    }

    // Returns active user counts for ALL city channels in one query.
    // Used by the /channels listing to replace N per-city queries.
    // Returns: [ cityId (int) => count (int) ]
    public static function getCountBatch(): array
    {
        $rows = Database::pdo()->query("
            SELECT p.channel_id, COUNT(DISTINCT p.guest_id) AS cnt
            FROM presence p
            JOIN channels c ON c.id = p.channel_id AND c.type = 'city'
            WHERE p.last_seen_at > now() - interval '" . self::TTL . " seconds'
            GROUP BY p.channel_id
        ")->fetchAll(PDO::FETCH_ASSOC);

        $counts = [];
        foreach ($rows as $row) {
            $cityId          = (int) substr($row['channel_id'], 5);
            $counts[$cityId] = (int) $row['cnt'];
        }
        return $counts;
    }
}
