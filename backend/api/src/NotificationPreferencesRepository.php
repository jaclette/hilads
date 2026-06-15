<?php

declare(strict_types=1);

class NotificationPreferencesRepository
{
    public static function defaults(): array
    {
        return [
            'dm_push'              => true,
            'event_message_push'   => true,
            'event_join_push'      => false,
            'new_event_push'       => true,
            'new_challenge_push'   => true,
            'mention_push'         => true,
            'channel_message_push' => false,
            'city_join_push'       => false,
            'friend_request_push'    => true,
            'vibe_received_push'   => true,
            'profile_view_push'    => true,
            'topic_reply_push'     => true,   // replies in topics I joined
            'new_topic_push'       => false,  // new topics in my city
            'admin_announcement_push' => true, // product announcements from /admin/push
        ];
    }

    public static function get(string $userId): array
    {
        try {
            $stmt = Database::pdo()->prepare("
                SELECT dm_push, event_message_push, event_join_push, new_event_push, new_challenge_push, mention_push,
                       channel_message_push, city_join_push, friend_request_push, vibe_received_push,
                       profile_view_push, topic_reply_push, new_topic_push, admin_announcement_push
                FROM notification_preferences
                WHERE user_id = ?
            ");
            $stmt->execute([$userId]);
            $row = $stmt->fetch(\PDO::FETCH_ASSOC);

            if (!$row) {
                return self::defaults();
            }

            return [
                'dm_push'              => (bool) $row['dm_push'],
                'event_message_push'   => (bool) $row['event_message_push'],
                'event_join_push'      => (bool) $row['event_join_push'],
                'new_event_push'       => (bool) $row['new_event_push'],
                'new_challenge_push'   => (bool) ($row['new_challenge_push'] ?? true),
                'mention_push'         => (bool) ($row['mention_push'] ?? true),
                'channel_message_push' => (bool) $row['channel_message_push'],
                'city_join_push'       => (bool) $row['city_join_push'],
                'friend_request_push'    => (bool) ($row['friend_request_push'] ?? true),
                'vibe_received_push'   => (bool) ($row['vibe_received_push'] ?? true),
                'profile_view_push'    => (bool) ($row['profile_view_push'] ?? true),
                'topic_reply_push'     => (bool) ($row['topic_reply_push'] ?? true),
                'new_topic_push'       => (bool) ($row['new_topic_push'] ?? false),
                'admin_announcement_push' => (bool) ($row['admin_announcement_push'] ?? true),
            ];
        } catch (\Throwable $e) {
            // Most likely cause: profile_view_push column not yet migrated in production.
            // Run: ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS profile_view_push BOOLEAN NOT NULL DEFAULT TRUE
            error_log('[notification-preferences] get failed for user ' . $userId . ': ' . $e->getMessage());
            return self::defaults();
        }
    }

    public static function upsert(string $userId, array $prefs): array
    {
        $defaults = self::defaults();
        // PDO serialises PHP bool false as "" which PostgreSQL rejects for BOOLEAN.
        // Cast to int (1/0) so PostgreSQL receives a valid boolean literal.
        $b = static fn(bool $v): int => $v ? 1 : 0;

        // PARTIAL update: only the keys the client actually sent are changed.
        // Absent keys keep their existing DB value - toggling one preference must
        // NOT reset the others (the old full-row upsert reset every absent key to
        // its default, so the two false-default toggles could never both stay on).
        // Column names come from defaults() (hardcoded), so interpolation is safe.
        $present = array_intersect_key($prefs, $defaults);

        // New rows need a complete row → defaults overlaid with any present values.
        $full = $defaults;
        foreach ($present as $k => $v) $full[$k] = (bool) $v;

        $cols   = array_keys($defaults);
        $params = [$userId];
        foreach ($cols as $c) $params[] = $b($full[$c]);

        $insertCols   = 'user_id, ' . implode(', ', $cols);
        $placeholders = implode(', ', array_fill(0, count($cols) + 1, '?'));

        if (!empty($present)) {
            $updateSet = implode(', ', array_map(static fn($k) => "$k = EXCLUDED.$k", array_keys($present)));
            $conflict  = "ON CONFLICT (user_id) DO UPDATE SET $updateSet";
        } else {
            $conflict  = "ON CONFLICT (user_id) DO NOTHING";
        }

        Database::pdo()
            ->prepare("INSERT INTO notification_preferences ($insertCols) VALUES ($placeholders) $conflict")
            ->execute($params);

        // Return the actual stored state (not the request echo).
        return self::get($userId);
    }
}
