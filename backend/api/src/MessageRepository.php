<?php

declare(strict_types=1);

class MessageRepository
{
    private const LIMIT = 200; // last 200 messages returned per channel

    // ── Channel ID mapping ────────────────────────────────────────────────────
    // City channels: int 1 → DB key 'city_1'
    // Event channels: hex string stays as-is

    private static function dbKey(int|string $channelId): string
    {
        return is_int($channelId) ? 'city_' . $channelId : (string) $channelId;
    }

    private static function clientKey(string $dbChannelId): int|string
    {
        return str_starts_with($dbChannelId, 'city_')
            ? (int) substr($dbChannelId, 5)
            : $dbChannelId;
    }

    // ── Format a DB row into the legacy message shape ─────────────────────────

    private static function format(array $row): array
    {
        $channelId = self::clientKey($row['channel_id']);
        $createdAt = (int) $row['created_at'];

        if ($row['type'] === 'system') {
            return [
                'type'      => 'system',
                'event'     => $row['event'],
                'guestId'   => $row['guest_id'],
                'nickname'  => $row['nickname'],
                'createdAt' => $createdAt,
            ];
        }

        if ($row['type'] === 'event') {
            return [
                'id'        => $row['id'],
                'channelId' => $channelId,
                'type'      => 'event',
                'eventId'   => $row['event'],   // event column stores the event channel ID
                'content'   => $row['content'], // event title
                'nickname'  => $row['nickname'] ?? '',
                'createdAt' => $createdAt,
            ];
        }

        if ($row['type'] === 'image') {
            return [
                'id'        => $row['id'],
                'channelId' => $channelId,
                'guestId'   => $row['guest_id'],
                'userId'    => $row['user_id'] ?? null,
                'nickname'  => $row['nickname'],
                'type'      => 'image',
                'imageUrl'  => $row['image_url'],
                'content'   => '',
                'createdAt' => $createdAt,
            ];
        }

        return [
            'id'        => $row['id'],
            'channelId' => $channelId,
            'guestId'   => $row['guest_id'],
            'userId'    => $row['user_id'] ?? null,
            'nickname'  => $row['nickname'],
            'content'   => $row['content'],
            'createdAt' => $createdAt,
        ];
    }

    // ── Reads ─────────────────────────────────────────────────────────────────

    public static function getByChannel(int|string $channelId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT id, channel_id, type, event,
                   guest_id, user_id, nickname, content, image_url, created_at
            FROM (
                SELECT
                    id, channel_id, type, event,
                    guest_id, user_id, nickname, content, image_url,
                    EXTRACT(EPOCH FROM created_at)::INTEGER AS created_at
                FROM messages
                WHERE channel_id = ?
                ORDER BY created_at DESC
                LIMIT " . self::LIMIT . "
            ) sub
            ORDER BY created_at ASC
        ");
        $stmt->execute([self::dbKey($channelId)]);
        return array_map([self::class, 'format'], $stmt->fetchAll());
    }

    public static function getStats(int $channelId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT
                COUNT(*)                                       AS message_count,
                EXTRACT(EPOCH FROM MAX(created_at))::INTEGER   AS last_activity_at
            FROM messages
            WHERE channel_id = ?
        ");
        $stmt->execute(['city_' . $channelId]);
        $row = $stmt->fetch();

        return [
            'messageCount'   => (int) $row['message_count'],
            'activeUsers'    => PresenceRepository::getCount($channelId),
            'lastActivityAt' => $row['last_activity_at'] ? (int) $row['last_activity_at'] : null,
        ];
    }

    /**
     * Returns message stats for ALL city channels in one query.
     * Used by the /channels listing to avoid one query per city.
     * Returns: [ cityId (int) => ['messageCount' => int, 'lastActivityAt' => int|null] ]
     */
    public static function getStatsBatch(): array
    {
        $rows = Database::pdo()
            ->query("
                SELECT
                    m.channel_id,
                    COUNT(*)                                         AS message_count,
                    EXTRACT(EPOCH FROM MAX(m.created_at))::INTEGER   AS last_activity_at
                FROM messages m
                JOIN channels c ON c.id = m.channel_id AND c.type = 'city'
                GROUP BY m.channel_id
            ")
            ->fetchAll(PDO::FETCH_ASSOC);

        $stats = [];
        foreach ($rows as $row) {
            $cityId          = (int) substr($row['channel_id'], 5);
            $stats[$cityId]  = [
                'messageCount'   => (int) $row['message_count'],
                'lastActivityAt' => $row['last_activity_at'] ? (int) $row['last_activity_at'] : null,
            ];
        }
        return $stats;
    }

    // ── Writes ────────────────────────────────────────────────────────────────

    public static function addJoinEvent(int $channelId, string $guestId, string $nickname): array
    {
        Database::pdo()->prepare("
            INSERT INTO messages (id, channel_id, type, event, guest_id, nickname)
            VALUES (?, ?, 'system', 'join', ?, ?)
        ")->execute([bin2hex(random_bytes(8)), self::dbKey($channelId), $guestId, $nickname]);

        return [
            'type'      => 'system',
            'event'     => 'join',
            'guestId'   => $guestId,
            'nickname'  => $nickname,
            'createdAt' => time(),
        ];
    }

    /**
     * Stores an event-announcement feed item in the city channel.
     * type='event', event column = event channel ID, content = title.
     * No DB migration needed — reuses existing event column (TEXT, nullable).
     */
    public static function addEventAnnouncement(int|string $channelId, string $eventId, string $title, string $guestId, string $nickname): array
    {
        $id = bin2hex(random_bytes(8));

        Database::pdo()->prepare("
            INSERT INTO messages (id, channel_id, type, event, guest_id, nickname, content)
            VALUES (?, ?, 'event', ?, ?, ?, ?)
        ")->execute([$id, self::dbKey($channelId), $eventId, $guestId, $nickname, $title]);

        return [
            'id'        => $id,
            'channelId' => $channelId,
            'type'      => 'event',
            'eventId'   => $eventId,
            'content'   => $title,
            'nickname'  => $nickname,
            'createdAt' => time(),
        ];
    }

    public static function add(int|string $channelId, string $guestId, string $nickname, string $content, ?string $userId = null): array
    {
        $id = bin2hex(random_bytes(8));

        Database::pdo()->prepare("
            INSERT INTO messages (id, channel_id, type, guest_id, user_id, nickname, content)
            VALUES (?, ?, 'text', ?, ?, ?, ?)
        ")->execute([$id, self::dbKey($channelId), $guestId, $userId, $nickname, $content]);

        return [
            'id'        => $id,
            'channelId' => $channelId,
            'guestId'   => $guestId,
            'userId'    => $userId,
            'nickname'  => $nickname,
            'content'   => $content,
            'createdAt' => time(),
        ];
    }

    public static function addImage(int|string $channelId, string $guestId, string $nickname, string $imageUrl, ?string $userId = null): array
    {
        $id = bin2hex(random_bytes(8));

        Database::pdo()->prepare("
            INSERT INTO messages (id, channel_id, type, guest_id, user_id, nickname, image_url, content)
            VALUES (?, ?, 'image', ?, ?, ?, ?, '')
        ")->execute([$id, self::dbKey($channelId), $guestId, $userId, $nickname, $imageUrl]);

        return [
            'id'        => $id,
            'channelId' => $channelId,
            'guestId'   => $guestId,
            'userId'    => $userId,
            'nickname'  => $nickname,
            'type'      => 'image',
            'imageUrl'  => $imageUrl,
            'content'   => '',
            'createdAt' => time(),
        ];
    }
}
