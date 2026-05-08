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
        return self::createUnchecked($userId, $type, $title, $body, $data);
    }

    /**
     * Insert a notification and fire pushes without re-checking preferences.
     * Use this when preferences have already been batch-resolved externally.
     * Public so PushBroadcastService can hit it after a single audience JOIN.
     */
    public static function createUnchecked(
        string  $userId,
        string  $type,
        string  $title,
        ?string $body,
        array   $data = []
    ): array {
        $stmt = Database::pdo()->prepare("
            INSERT INTO notifications (user_id, type, title, body, data)
            VALUES (?, ?, ?, ?, ?::jsonb)
            RETURNING id, user_id, type, title, body, data::text, is_read,
                      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at
        ");
        $stmt->execute([$userId, $type, $title, $body, json_encode($data)]);
        $notif = self::normalise($stmt->fetch(\PDO::FETCH_ASSOC));

        // Web push (browser VAPID) — fire-and-forget
        PushService::send($userId, $type, $title, $body, self::pushUrl($type, $data), self::pushTag($type, $data), $data);

        // Native push (iOS/Android via Expo) — fire-and-forget
        MobilePushService::send($userId, $type, $title, $body, $data);

        return $notif;
    }

    private static function typeToColumn(string $type): ?string
    {
        return match ($type) {
            'dm_message'                                                => 'dm_push',
            'event_message'                                             => 'event_message_push',
            'event_join'                                                => 'event_join_push',
            'new_event'                                                 => 'new_event_push',
            'channel_message'                                           => 'channel_message_push',
            'city_join'                                                 => 'city_join_push',
            // friend_request_received + friend_request_accepted are the new
            // request-flow types; friend_added is kept as a legacy alias so
            // historical rows from before the refactor still display correctly.
            'friend_request_received',
            'friend_request_accepted',
            'friend_added'                                              => 'friend_request_push',
            'vibe_received'                                             => 'vibe_received_push',
            'profile_view'                                              => 'profile_view_push',
            'topic_message'                                             => 'topic_reply_push',
            'new_topic'                                                 => 'new_topic_push',
            // Admin-triggered broadcasts (from /admin/push). Default-on so
            // users get product announcements unless they opt out.
            'admin_announcement'                                        => 'admin_announcement_push',
            default                                                     => null,
        };
    }

    private static function prefDefaults(): array
    {
        return [
            'dm_push'              => true,
            'event_message_push'   => true,
            'event_join_push'      => false,
            'new_event_push'       => false,
            'channel_message_push' => false,
            'city_join_push'       => false,
            'friend_request_push'  => true,
            'vibe_received_push'   => true,
            'profile_view_push'    => true,
            'topic_reply_push'     => true,
            'new_topic_push'       => false,
            'admin_announcement_push' => true,
        ];
    }

    private static function isEnabledForUser(string $userId, string $type): bool
    {
        $col = self::typeToColumn($type);
        if ($col === null) return true;

        $defaults = self::prefDefaults();
        try {
            $stmt = Database::pdo()->prepare(
                "SELECT {$col} FROM notification_preferences WHERE user_id = ?"
            );
            $stmt->execute([$userId]);
            $row = $stmt->fetch(\PDO::FETCH_ASSOC);
            return $row ? (bool) $row[$col] : ($defaults[$col] ?? true);
        } catch (\Throwable) {
            return true;
        }
    }

    /**
     * Batch-load notification preferences for multiple users — 1 query instead of N.
     * Returns [ userId => bool ] indicating whether the given type is enabled for each user.
     */
    private static function batchIsEnabled(array $userIds, string $type): array
    {
        $col = self::typeToColumn($type);
        if ($col === null) {
            // Unknown type — always enabled for everyone
            return array_fill_keys($userIds, true);
        }

        $defaults = self::prefDefaults();
        $default  = $defaults[$col] ?? true;

        if (empty($userIds)) return [];

        try {
            $placeholders = implode(',', array_fill(0, count($userIds), '?'));
            $stmt = Database::pdo()->prepare(
                "SELECT user_id, {$col} AS enabled FROM notification_preferences WHERE user_id IN ({$placeholders})"
            );
            $stmt->execute($userIds);
            $rows = array_column($stmt->fetchAll(\PDO::FETCH_ASSOC), 'enabled', 'user_id');
        } catch (\Throwable) {
            // On DB error, default to enabled so notifications aren't silently dropped
            return array_fill_keys($userIds, true);
        }

        $result = [];
        foreach ($userIds as $uid) {
            $result[$uid] = isset($rows[$uid]) ? (bool) $rows[$uid] : $default;
        }
        return $result;
    }

    private static function pushUrl(string $type, array $data): string
    {
        return match ($type) {
            'dm_message'                      => '/conversations',
            'event_message', 'event_join',
            'new_event'                       => isset($data['eventId']) ? "/event/{$data['eventId']}" : '/',
            'channel_message', 'city_join'    => '/',
            'friend_request_received'         => '/friend-requests',
            'friend_request_accepted'         => isset($data['accepterUserId']) ? "/user/{$data['accepterUserId']}" : '/me',
            // Legacy friend_added rows (pre-refactor) keep deep-linking to the
            // adder's profile so old notifications still work after upgrade.
            'friend_added'                    => isset($data['senderUserId']) ? "/user/{$data['senderUserId']}" : '/notifications',
            'vibe_received'                   => '/me',
            'profile_view'                    => isset($data['viewerId']) ? "/user/{$data['viewerId']}" : '/notifications',
            'topic_message', 'new_topic'      => isset($data['topicId']) ? "/topic/{$data['topicId']}" : '/',
            // Admin broadcasts can include a custom deepLink; falls back to
            // the notifications screen so the row is at least viewable.
            'admin_announcement'              => $data['deepLink'] ?? '/notifications',
            default                           => '/',
        };
    }

    private static function pushTag(string $type, array $data): string
    {
        return match ($type) {
            'dm_message'              => 'dm-'           . ($data['conversationId'] ?? 'dm'),
            'event_message',
            'event_join'              => 'event-'         . ($data['eventId'] ?? 'event'),
            'new_event'               => 'new-event-'     . ($data['eventId'] ?? 'event'),
            'channel_message'         => 'channel-'       . ($data['channelId'] ?? 'city'),
            'city_join'               => 'cityjoin-'      . ($data['channelId'] ?? 'city'),
            'friend_request_received' => 'friend-req-'    . ($data['senderUserId'] ?? 'user'),
            'friend_request_accepted' => 'friend-acc-'    . ($data['accepterUserId'] ?? 'user'),
            'friend_added'            => 'friend-'        . ($data['senderUserId'] ?? 'user'),
            'vibe_received'           => 'vibe-'          . ($data['actorId'] ?? 'user'),
            'profile_view'            => 'profile-view-'  . ($data['viewerId'] ?? 'user'),
            'topic_message'           => 'topic-'         . ($data['topicId'] ?? 'topic'),
            'new_topic'               => 'new-topic-'     . ($data['topicId'] ?? 'topic'),
            'admin_announcement'      => 'admin-'         . ($data['broadcastId'] ?? 'b'),
            default                   => 'hilads-' . $type,
        };
    }

    // ── Bell vs envelope split ────────────────────────────────────────────────
    //
    // The bell icon's badge / list / mark-all action is for "general" activity:
    // friend requests, vibes, profile views, pulses, event-roster activity, etc.
    // DM / event-chat / city-channel-chat notifications are tracked separately
    // by the envelope icon (its unread comes from conversation_participants
    // last_read_at + the per-event chat unread state on the client). Listing
    // those rows in the bell would double-count them and inflate the badge.
    //
    // Centralised here so listForUser / unreadCount / markAllRead all stay in
    // sync — adding a new "envelope-only" type only requires editing this list.
    private const BELL_EXCLUDED_TYPES = ['dm_message', 'event_message', 'channel_message'];

    private static function bellExclusionSql(): string
    {
        // Inlined — types are hardcoded constants, no injection surface.
        $quoted = array_map(fn($t) => "'" . $t . "'", self::BELL_EXCLUDED_TYPES);
        return 'type NOT IN (' . implode(',', $quoted) . ')';
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    public static function listForUser(string $userId, int $limit = 50, int $offset = 0): array
    {
        $exclude = self::bellExclusionSql();
        $stmt = Database::pdo()->prepare("
            SELECT id, user_id, type, title, body, data::text, is_read,
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at
            FROM notifications
            WHERE user_id = ? AND $exclude
            ORDER BY created_at DESC
            LIMIT ?
            OFFSET ?
        ");
        $stmt->execute([$userId, $limit, $offset]);
        return array_map([self::class, 'normalise'], $stmt->fetchAll(\PDO::FETCH_ASSOC));
    }

    public static function unreadCount(string $userId): int
    {
        $exclude = self::bellExclusionSql();
        $stmt = Database::pdo()->prepare("
            SELECT COUNT(*) FROM notifications
            WHERE user_id = ? AND is_read = FALSE AND $exclude
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
        // Only marks bell-visible rows. DM/event/channel chat notifications are
        // tracked separately by the envelope icon and their read state is
        // governed by per-conversation / per-event last_read_at, not by this
        // table — touching them here would silently break the envelope's badge.
        $exclude = self::bellExclusionSql();
        Database::pdo()->prepare("
            UPDATE notifications SET is_read = TRUE
            WHERE user_id = ? AND is_read = FALSE AND $exclude
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
        $userIds = $stmt->fetchAll(\PDO::FETCH_COLUMN);
        if (empty($userIds)) return;

        // Batch-load preferences — 1 query regardless of participant count
        $enabled = self::batchIsEnabled($userIds, $type);
        foreach ($userIds as $uid) {
            if ($enabled[$uid] ?? true) {
                self::createUnchecked($uid, $type, $title, $body, $data);
            }
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
        $userIds = $stmt->fetchAll(\PDO::FETCH_COLUMN);
        if (empty($userIds)) return;

        // Batch-load preferences — 1 query regardless of online user count
        $enabled = self::batchIsEnabled($userIds, $type);
        foreach ($userIds as $uid) {
            if ($enabled[$uid] ?? true) {
                self::createUnchecked($uid, $type, $title, $body, $data);
            }
        }
    }

    /**
     * Notify all registered subscribers of a topic, excluding one user (the sender).
     * Subscribers are added automatically when a user creates or messages in a topic.
     */
    public static function notifyTopicSubscribers(
        string  $topicId,
        ?string $excludeUserId,
        string  $type,
        string  $title,
        ?string $body,
        array   $data
    ): void {
        $stmt = Database::pdo()->prepare("
            SELECT user_id FROM topic_subscriptions
            WHERE topic_id = ?
              AND (CAST(? AS text) IS NULL OR user_id::text != CAST(? AS text))
        ");
        $stmt->execute([$topicId, $excludeUserId, $excludeUserId]);
        $userIds = $stmt->fetchAll(\PDO::FETCH_COLUMN);
        if (empty($userIds)) return;

        // Batch-load preferences — 1 query regardless of subscriber count
        $enabled = self::batchIsEnabled($userIds, $type);
        foreach ($userIds as $uid) {
            if ($enabled[$uid] ?? true) {
                self::createUnchecked($uid, $type, $title, $body, $data);
            }
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
