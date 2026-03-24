<?php

declare(strict_types=1);

class NotificationPreferencesRepository
{
    private static function defaults(): array
    {
        return [
            'dm_push'            => true,
            'event_message_push' => true,
            'new_event_push'     => false,
        ];
    }

    public static function get(string $userId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT dm_push, event_message_push, new_event_push
            FROM notification_preferences
            WHERE user_id = ?
        ");
        $stmt->execute([$userId]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);

        if (!$row) {
            return self::defaults();
        }

        return [
            'dm_push'            => (bool) $row['dm_push'],
            'event_message_push' => (bool) $row['event_message_push'],
            'new_event_push'     => (bool) $row['new_event_push'],
        ];
    }

    public static function upsert(string $userId, array $prefs): array
    {
        $defaults = self::defaults();

        $dm       = isset($prefs['dm_push'])            ? (bool) $prefs['dm_push']            : $defaults['dm_push'];
        $eventMsg = isset($prefs['event_message_push']) ? (bool) $prefs['event_message_push'] : $defaults['event_message_push'];
        $newEvent = isset($prefs['new_event_push'])     ? (bool) $prefs['new_event_push']     : $defaults['new_event_push'];

        Database::pdo()->prepare("
            INSERT INTO notification_preferences (user_id, dm_push, event_message_push, new_event_push)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (user_id) DO UPDATE
               SET dm_push            = EXCLUDED.dm_push,
                   event_message_push = EXCLUDED.event_message_push,
                   new_event_push     = EXCLUDED.new_event_push
        ")->execute([$userId, $dm, $eventMsg, $newEvent]);

        return [
            'dm_push'            => $dm,
            'event_message_push' => $eventMsg,
            'new_event_push'     => $newEvent,
        ];
    }
}
