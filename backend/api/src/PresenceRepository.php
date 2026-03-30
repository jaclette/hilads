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
     * Upserts presence for the session.
     * Returns true if this is a genuinely new join (session was absent or expired),
     * false if the session was already active within the TTL (re-join / heartbeat).
     * Use the return value to decide whether to emit a "just landed" feed event.
     */
    public static function join(int $channelId, string $sessionId, string $guestId, string $nickname): bool
    {
        $pdo = Database::pdo();

        $check = $pdo->prepare("
            SELECT 1 FROM presence
            WHERE session_id = ? AND channel_id = ?
              AND last_seen_at > now() - interval '" . self::TTL . " seconds'
        ");
        $check->execute([$sessionId, self::dbKey($channelId)]);
        $alreadyActive = (bool) $check->fetchColumn();

        $pdo->prepare("
            INSERT INTO presence (session_id, channel_id, guest_id, nickname, last_seen_at)
            VALUES (?, ?, ?, ?, now())
            ON CONFLICT (session_id, channel_id) DO UPDATE SET
                nickname     = EXCLUDED.nickname,
                last_seen_at = now()
        ")->execute([$sessionId, self::dbKey($channelId), $guestId, $nickname]);

        return !$alreadyActive;
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

    // Returns unique online users (deduplicated by guestId — one entry per person even with multiple tabs)
    public static function getOnline(int $channelId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT DISTINCT ON (guest_id) guest_id AS \"guestId\", nickname
            FROM presence
            WHERE channel_id   = ?
              AND last_seen_at > now() - interval '" . self::TTL . " seconds'
            ORDER BY guest_id, last_seen_at DESC
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
