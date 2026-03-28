<?php

declare(strict_types=1);

class NotificationRepository
{
    // ── Write ─────────────────────────────────────────────────────────────────

    public static function create(
        string  $userId,
        string  $type,
        string  $title,
        ?string $body,
        array   $data = []
    ): array {
        // Skip if recipient has disabled this notification type
        if (!self::isEnabledForUser($userId, $type)) {
            return [];
        }

        $stmt = Database::pdo()->prepare("
            INSERT INTO notifications (user_id, type, title, body, data)
            VALUES (?, ?, ?, ?, ?::jsonb)
            RETURNING id, user_id, type, title, body, data::text, is_read,
                      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at
        ");
        $stmt->execute([$userId, $type, $title, $body, json_encode($data)]);
        $notif = self::normalise($stmt->fetch(\PDO::FETCH_ASSOC));

        // Attempt web push delivery (fire-and-forget; failure is non-fatal)
        PushService::send($userId, $type, $title, $body, self::pushUrl($type, $data), self::pushTag($type, $data));

        return $notif;
    }

    private static function isEnabledForUser(string $userId, string $type): bool
    {
        $col = match ($type) {
            'dm_message'    => 'dm_push',
            'event_message' => 'event_message_push',
            'event_join'    => 'event_join_push',
            'new_event'     => 'new_event_push',
            default         => null,
        };
        if ($col === null) return true; // Unknown type — always create

        $defaults = [
            'dm_push'            => true,
            'event_message_push' => true,
            'event_join_push'    => false,
            'new_event_push'     => false,
        ];

        try {
            $stmt = Database::pdo()->prepare(
                "SELECT {$col} FROM notification_preferences WHERE user_id = ?"
            );
            $stmt->execute([$userId]);
            $row = $stmt->fetch(\PDO::FETCH_ASSOC);
            return $row ? (bool) $row[$col] : ($defaults[$col] ?? true);
        } catch (\Throwable) {
            return true; // On DB error, don't suppress
        }
    }

    private static function pushUrl(string $type, array $data): string
    {
        return match ($type) {
            'dm_message'                  => '/conversations',
            'event_message', 'event_join',
            'new_event'                   => isset($data['eventId']) ? "/event/{$data['eventId']}" : '/',
            default                       => '/',
        };
    }

    private static function pushTag(string $type, array $data): string
    {
        return match ($type) {
            'dm_message'    => 'dm-'        . ($data['conversationId'] ?? 'dm'),
            'event_message',
            'event_join'    => 'event-'     . ($data['eventId'] ?? 'event'),
            'new_event'     => 'new-event-' . ($data['eventId'] ?? 'event'),
            default         => 'hilads-' . $type,
        };
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    public static function listForUser(string $userId, int $limit = 50): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT id, user_id, type, title, body, data::text, is_read,
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at
            FROM notifications
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
        ");
        $stmt->execute([$userId, $limit]);
        return array_map([self::class, 'normalise'], $stmt->fetchAll(\PDO::FETCH_ASSOC));
    }

    public static function unreadCount(string $userId): int
    {
        $stmt = Database::pdo()->prepare("
            SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = FALSE
        ");
        $stmt->execute([$userId]);
        return (int) $stmt->fetchColumn();
    }

    // ── Mark read ─────────────────────────────────────────────────────────────

    public static function markRead(string $userId, array $ids): void
    {
        if (empty($ids)) return;
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $params = array_merge([$userId], array_map('intval', $ids));
        Database::pdo()->prepare("
            UPDATE notifications SET is_read = TRUE
            WHERE user_id = ? AND id IN ($placeholders) AND is_read = FALSE
        ")->execute($params);
    }

    public static function markAllRead(string $userId): void
    {
        Database::pdo()->prepare("
            UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE
        ")->execute([$userId]);
    }

    // ── Bulk notification helpers ─────────────────────────────────────────────

    /**
     * Notify all registered participants of an event, excluding one user.
     * Used when a new message arrives in an event chat.
     */
    public static function notifyEventParticipants(
        string  $eventId,
        ?string $excludeUserId,
        string  $type,
        string  $title,
        ?string $body,
        array   $data
    ): void {
        // CAST(? AS text) tells Postgres the type of the nullable param so it
        // can resolve $2 even when the value is NULL (avoids "indeterminate datatype").
        $stmt = Database::pdo()->prepare("
            SELECT DISTINCT user_id FROM event_participants
            WHERE channel_id = ?
              AND user_id IS NOT NULL
              AND (CAST(? AS text) IS NULL OR user_id::text != CAST(? AS text))
        ");
        $stmt->execute([$eventId, $excludeUserId, $excludeUserId]);
        foreach ($stmt->fetchAll(\PDO::FETCH_COLUMN) as $uid) {
            self::create($uid, $type, $title, $body, $data);
        }
    }

    /**
     * Notify registered users currently present in a city channel, excluding one user.
     * "Currently present" = presence heartbeat within the last 3 minutes.
     */
    public static function notifyCityOnlineUsers(
        string  $cityChannelId,
        ?string $excludeUserId,
        string  $type,
        string  $title,
        ?string $body,
        array   $data
    ): void {
        $stmt = Database::pdo()->prepare("
            SELECT DISTINCT user_id FROM presence
            WHERE channel_id = ?
              AND user_id IS NOT NULL
              AND last_seen_at > now() - interval '3 minutes'
              AND (CAST(? AS text) IS NULL OR user_id::text != CAST(? AS text))
        ");
        $stmt->execute([$cityChannelId, $excludeUserId, $excludeUserId]);
        foreach ($stmt->fetchAll(\PDO::FETCH_COLUMN) as $uid) {
            self::create($uid, $type, $title, $body, $data);
        }
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private static function normalise(array $row): array
    {
        $row['id']      = (int) $row['id'];
        $row['is_read'] = (bool) $row['is_read'];
        $row['data']    = json_decode($row['data'] ?? '{}', true) ?? [];
        return $row;
    }
}
