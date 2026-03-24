<?php

declare(strict_types=1);

class PresenceRepository
{
    private const TTL = 60; // seconds without heartbeat before a user is considered offline

    private static function dbKey(int $channelId): string
    {
        return 'city_' . $channelId;
    }

    public static function join(int $channelId, string $sessionId, string $guestId, string $nickname): void
    {
        Database::pdo()->prepare("
            INSERT INTO presence (session_id, channel_id, guest_id, nickname, last_seen_at)
            VALUES (?, ?, ?, ?, now())
            ON CONFLICT (session_id, channel_id) DO UPDATE SET
                nickname     = EXCLUDED.nickname,
                last_seen_at = now()
        ")->execute([$sessionId, self::dbKey($channelId), $guestId, $nickname]);
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
}
