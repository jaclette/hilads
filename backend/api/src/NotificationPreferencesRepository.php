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
            'new_event_push'       => false,
            'channel_message_push' => false,
            'city_join_push'       => false,
            'friend_request_push'    => true,
            'vibe_received_push'   => true,
            'profile_view_push'    => true,
            'topic_reply_push'     => true,   // replies in topics I joined
            'new_topic_push'       => false,  // new topics in my city
        ];
    }

    public static function get(string $userId): array
    {
        try {
            $stmt = Database::pdo()->prepare("
                SELECT dm_push, event_message_push, event_join_push, new_event_push,
                       channel_message_push, city_join_push, friend_request_push, vibe_received_push,
                       profile_view_push, topic_reply_push, new_topic_push
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
                'channel_message_push' => (bool) $row['channel_message_push'],
                'city_join_push'       => (bool) $row['city_join_push'],
                'friend_request_push'    => (bool) ($row['friend_request_push'] ?? true),
                'vibe_received_push'   => (bool) ($row['vibe_received_push'] ?? true),
                'profile_view_push'    => (bool) ($row['profile_view_push'] ?? true),
                'topic_reply_push'     => (bool) ($row['topic_reply_push'] ?? true),
                'new_topic_push'       => (bool) ($row['new_topic_push'] ?? false),
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

        $dm            = isset($prefs['dm_push'])              ? (bool) $prefs['dm_push']              : $defaults['dm_push'];
        $eventMsg      = isset($prefs['event_message_push'])   ? (bool) $prefs['event_message_push']   : $defaults['event_message_push'];
        $eventJoin     = isset($prefs['event_join_push'])      ? (bool) $prefs['event_join_push']      : $defaults['event_join_push'];
        $newEvent      = isset($prefs['new_event_push'])       ? (bool) $prefs['new_event_push']       : $defaults['new_event_push'];
        $chanMsg       = isset($prefs['channel_message_push']) ? (bool) $prefs['channel_message_push'] : $defaults['channel_message_push'];
        $cityJoin      = isset($prefs['city_join_push'])       ? (bool) $prefs['city_join_push']       : $defaults['city_join_push'];
        $friendReq     = isset($prefs['friend_request_push'])    ? (bool) $prefs['friend_request_push']    : $defaults['friend_request_push'];
        $vibeReceived  = isset($prefs['vibe_received_push'])   ? (bool) $prefs['vibe_received_push']   : $defaults['vibe_received_push'];
        $profileView   = isset($prefs['profile_view_push'])    ? (bool) $prefs['profile_view_push']    : $defaults['profile_view_push'];
        $topicReply    = isset($prefs['topic_reply_push'])     ? (bool) $prefs['topic_reply_push']     : $defaults['topic_reply_push'];
        $newTopic      = isset($prefs['new_topic_push'])       ? (bool) $prefs['new_topic_push']       : $defaults['new_topic_push'];

        $resolved = [
            'dm_push'              => $dm,
            'event_message_push'   => $eventMsg,
            'event_join_push'      => $eventJoin,
            'new_event_push'       => $newEvent,
            'channel_message_push' => $chanMsg,
            'city_join_push'       => $cityJoin,
            'friend_request_push'    => $friendReq,
            'vibe_received_push'   => $vibeReceived,
            'profile_view_push'    => $profileView,
            'topic_reply_push'     => $topicReply,
            'new_topic_push'       => $newTopic,
        ];

        // PDO serialises PHP bool false as "" (empty string) which PostgreSQL rejects for BOOLEAN columns.
        // Cast every boolean to int (1/0) so PostgreSQL receives a valid boolean literal.
        $b = static fn(bool $v): int => $v ? 1 : 0;

        Database::pdo()->prepare("
            INSERT INTO notification_preferences
                (user_id, dm_push, event_message_push, event_join_push, new_event_push,
                 channel_message_push, city_join_push, friend_request_push, vibe_received_push,
                 profile_view_push, topic_reply_push, new_topic_push)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_id) DO UPDATE
               SET dm_push              = EXCLUDED.dm_push,
                   event_message_push   = EXCLUDED.event_message_push,
                   event_join_push      = EXCLUDED.event_join_push,
                   new_event_push       = EXCLUDED.new_event_push,
                   channel_message_push = EXCLUDED.channel_message_push,
                   city_join_push       = EXCLUDED.city_join_push,
                   friend_request_push    = EXCLUDED.friend_request_push,
                   vibe_received_push   = EXCLUDED.vibe_received_push,
                   profile_view_push    = EXCLUDED.profile_view_push,
                   topic_reply_push     = EXCLUDED.topic_reply_push,
                   new_topic_push       = EXCLUDED.new_topic_push
        ")->execute([
            $userId,
            $b($dm), $b($eventMsg), $b($eventJoin), $b($newEvent),
            $b($chanMsg), $b($cityJoin), $b($friendReq), $b($vibeReceived), $b($profileView),
            $b($topicReply), $b($newTopic),
        ]);

        return $resolved;
    }
}
