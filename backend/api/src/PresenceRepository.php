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
