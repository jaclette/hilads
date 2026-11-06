<?php

declare(strict_types=1);

class NotificationPreferencesRepository
{
    /** Integer preferences (minutes of the day, or null); every other key is a boolean. */
    public const MINUTE_KEYS = ['quiet_start', 'quiet_end'];

    /** True when $now falls in the user's quiet hours (prefs from get()). */
    public static function inQuietHours(array $prefs, DateTimeImmutable $localNow): bool
    {
        $from = $prefs['quiet_start'] ?? null;
        $to   = $prefs['quiet_end'] ?? null;
        if ($from === null || $to === null || $from === $to) return false;
        $m = (int) $localNow->format('G') * 60 + (int) $localNow->format('i');
        return $from < $to ? ($m >= $from && $m < $to) : ($m >= $from || $m < $to);
    }

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
            'world_arrival_push'   => false,  // World channel arrivals (opt-in; unused since V6)
            'friend_arrival_push'  => true,   // V6: a friend landed somewhere (world_arrival rows)
            'friend_request_push'    => true,
            'vibe_received_push'   => true,
            'profile_view_push'    => true,
            'topic_reply_push'     => true,   // replies in topics I joined
            'new_topic_push'       => false,  // new topics in my city
            'admin_announcement_push' => true, // product announcements from /admin/push
            'daily_challenge_push' => true,   // Daily Challenge morning/reminder/digest pushes
            'comment_push'         => true,   // comments on my photos and in threads I joined (mentions: mention_push)
            // V6
            'like_push'            => true,   // likes on my photos (bell row and push)
            'results_push'         => true,   // yesterday's results in the bell
            'rank_push'            => true,   // my rank changes
            'stamp_push'           => true,   // stamps, Local Pass
            'reminder_push'        => true,   // the evening reminder (and the city streak at risk)
            // Quiet hours, minutes in the user's local time (null = off): no push between them.
            'quiet_start'          => null,
            'quiet_end'            => null,
        ];
    }

    public static function get(string $userId): array
    {
        try {
            // SELECT *: a column not migrated yet just keeps its default
            // (listing columns made one missing column reset every preference).
            $stmt = Database::pdo()->prepare("SELECT * FROM notification_preferences WHERE user_id = ?");
            $stmt->execute([$userId]);
            $row = $stmt->fetch(\PDO::FETCH_ASSOC);
            $out = self::defaults();
            if ($row) {
                foreach ($out as $k => $default) {
                    if (!array_key_exists($k, $row)) continue;
                    if (in_array($k, self::MINUTE_KEYS, true)) {
                        $out[$k] = $row[$k] === null ? null : (int) $row[$k];
                    } elseif ($row[$k] !== null) {
                        $out[$k] = DailyProofRepository::bool($row[$k]);
                    }
                }
            }
            return $out;
        } catch (\Throwable $e) {
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

        // Nothing valid to change → just return current state.
        if (empty($present)) {
            return self::get($userId);
        }

        // Only reference the columns actually being toggled. A brand-new row gets
        // DB-level DEFAULTs for every absent column, so we never list the full
        // column set - which means one column missing in production (e.g. a pref
        // added to defaults() but not yet migrated) can't 500 EVERY toggle; only
        // a toggle of that specific missing column would fail.
        $presentCols = array_keys($present);
        $params      = [$userId];
        foreach ($presentCols as $c) {
            if (in_array($c, self::MINUTE_KEYS, true)) {
                $v = $present[$c];
                $params[] = is_numeric($v) && (int) $v >= 0 && (int) $v < 1440 ? (int) $v : null;
            } else {
                $params[] = $b((bool) $present[$c]);
            }
        }

        $insertCols   = 'user_id, ' . implode(', ', $presentCols);
        $placeholders = implode(', ', array_fill(0, count($presentCols) + 1, '?'));
        $updateSet    = implode(', ', array_map(static fn($k) => "$k = EXCLUDED.$k", $presentCols));

        Database::pdo()
            ->prepare("INSERT INTO notification_preferences ($insertCols) VALUES ($placeholders) ON CONFLICT (user_id) DO UPDATE SET $updateSet")
            ->execute($params);

        // Return the actual stored state (not the request echo).
        return self::get($userId);
    }
}
