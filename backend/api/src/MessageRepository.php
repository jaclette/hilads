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
            // Weather system messages carry display text in `content`
            if ($row['event'] === 'weather') {
                return [
                    'type'      => 'system',
                    'event'     => 'weather',
                    'content'   => $row['content'] ?? '',
                    'createdAt' => $createdAt,
                ];
            }
            return [
                'type'      => 'system',
                'event'     => $row['event'],
                'guestId'   => $row['guest_id'],
                'userId'    => $row['user_id'] ?? null,
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
        // COALESCE(m.user_id, u.id): retroactively resolves the sender's registered userId
        // for messages where user_id was never written (sent before the api.php fix).
        // Uses idx_users_guest_id — no performance cost on the hot path.
        $stmt = Database::pdo()->prepare("
            SELECT id, channel_id, type, event,
                   guest_id, user_id, nickname, content, image_url, created_at
            FROM (
                SELECT
                    m.id, m.channel_id, m.type, m.event,
                    m.guest_id,
                    COALESCE(m.user_id, u.id) AS user_id,
                    m.nickname, m.content, m.image_url,
                    EXTRACT(EPOCH FROM m.created_at)::INTEGER AS created_at
                FROM messages m
                LEFT JOIN users u ON u.guest_id = m.guest_id AND m.user_id IS NULL
                WHERE m.channel_id = ?
                ORDER BY m.created_at DESC
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

    /**
     * Inserts a weather system message into a city channel feed.
     * type='system', event='weather', content = display text.
     * No guest_id / nickname — weather has no author.
     */
    public static function addWeatherSystem(int $channelId, string $content): array
    {
        $id = bin2hex(random_bytes(8));

        Database::pdo()->prepare("
            INSERT INTO messages (id, channel_id, type, event, content, nickname)
            VALUES (?, ?, 'system', 'weather', ?, '')
        ")->execute([$id, self::dbKey($channelId), $content]);

        return [
            'id'        => $id,
            'type'      => 'system',
            'event'     => 'weather',
            'content'   => $content,
            'createdAt' => time(),
        ];
    }

    public static function addJoinEvent(int $channelId, string $guestId, string $nickname, ?string $userId = null): array
    {
        Database::pdo()->prepare("
            INSERT INTO messages (id, channel_id, type, event, guest_id, user_id, nickname)
            VALUES (?, ?, 'system', 'join', ?, ?, ?)
        ")->execute([bin2hex(random_bytes(8)), self::dbKey($channelId), $guestId, $userId, $nickname]);

        return [
            'type'      => 'system',
            'event'     => 'join',
            'guestId'   => $guestId,
            'userId'    => $userId,
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
