<?php

declare(strict_types=1);

/**
 * Admin push broadcast pipeline.
 *
 * Resolves an audience (all users / city / specific user / test recipient),
 * then dispatches the notification through the existing
 * NotificationRepository::createUnchecked flow so each recipient gets:
 *   1. A row in `notifications` (visible in their bell)
 *   2. A web push (PushService::send) if they have VAPID subs
 *   3. A native push (MobilePushService::send) if they have device tokens
 *
 * Audience SQL filters by notification_preferences.admin_announcement_push so
 * users who opted out are excluded at the SQL layer — no per-user pref re-check
 * inside the dispatch loop. Users with no preferences row default to TRUE
 * (matches NotificationPreferencesRepository::defaults()).
 *
 * Dispatch is intentionally synchronous-but-batched (500 per chunk). For an
 * "all users" send of even 50k recipients, the loop completes in ~30-60s. The
 * admin/push.php route caller wraps the dispatch in
 *   register_shutdown_function + fastcgi_finish_request
 * so the HTTP response returns immediately and the loop runs after.
 */
final class PushBroadcastService
{
    private const BATCH_SIZE = 500;

    /**
     * Audience filter shape:
     *   ['all']                   — every registered user
     *   ['city', channelId: int]  — users with presence in that city channel
     *   ['user', userId: string]  — single registered user (admin search)
     *   ['test', userId: string]  — single user (admin's own ADMIN_TEST_USER_ID)
     *
     * Returns matching userIds (registered, not deleted, opted in).
     */
    public static function resolveAudience(string $type, array $filter): array
    {
        switch ($type) {
            case 'all':
                $stmt = Database::pdo()->prepare("
                    SELECT u.id
                    FROM users u
                    LEFT JOIN notification_preferences np ON np.user_id = u.id
                    WHERE u.deleted_at IS NULL
                      AND COALESCE(np.admin_announcement_push, TRUE) = TRUE
                ");
                $stmt->execute();
                return $stmt->fetchAll(\PDO::FETCH_COLUMN);

            case 'city':
                // 'Active in city' = a presence row in that channel within the
                // last 30 days. Avoids broadcasting to users who briefly
                // visited a city once and never came back.
                $channelId = (int) ($filter['channelId'] ?? 0);
                if ($channelId <= 0) return [];
                $stmt = Database::pdo()->prepare("
                    SELECT DISTINCT u.id
                    FROM users u
                    JOIN presence p ON p.user_id = u.id
                    LEFT JOIN notification_preferences np ON np.user_id = u.id
                    WHERE p.channel_id = ?
                      AND p.last_seen_at > now() - interval '30 days'
                      AND u.deleted_at IS NULL
                      AND COALESCE(np.admin_announcement_push, TRUE) = TRUE
                ");
                $stmt->execute(['city_' . $channelId]);
                return $stmt->fetchAll(\PDO::FETCH_COLUMN);

            case 'user':
            case 'test':
                $userId = $filter['userId'] ?? '';
                if (!is_string($userId) || $userId === '') return [];
                // Test sends bypass the pref check — the admin explicitly
                // wants the push to land on their own device.
                $prefClause = $type === 'test'
                    ? ''
                    : ' AND COALESCE(np.admin_announcement_push, TRUE) = TRUE';
                $stmt = Database::pdo()->prepare("
                    SELECT u.id
                    FROM users u
                    LEFT JOIN notification_preferences np ON np.user_id = u.id
                    WHERE u.id = ? AND u.deleted_at IS NULL
                    {$prefClause}
                ");
                $stmt->execute([$userId]);
                return $stmt->fetchAll(\PDO::FETCH_COLUMN);

            default:
                return [];
        }
    }

    /** Cheap pre-send count for the confirmation modal. Same filter logic. */
    public static function countAudience(string $type, array $filter): int
    {
        // Reuse resolveAudience and count — keeps the filter logic in one place.
        // O(N) on user count which is fine: this runs once per "Confirm send"
        // tap and the result is shown to the admin before the actual send.
        return count(self::resolveAudience($type, $filter));
    }

    /**
     * Search registered users by display name for the "specific user" audience.
     * Returns up to 10 matches. Used by /admin/push's user search field.
     */
    public static function searchUsers(string $query): array
    {
        $q = trim($query);
        if ($q === '') return [];
        $stmt = Database::pdo()->prepare("
            SELECT id, display_name, email, profile_photo_url
            FROM users
            WHERE deleted_at IS NULL
              AND display_name ILIKE ?
            ORDER BY display_name ASC
            LIMIT 10
        ");
        $stmt->execute(['%' . $q . '%']);
        return $stmt->fetchAll(\PDO::FETCH_ASSOC);
    }

    /**
     * Fire-and-update: send the notification to every recipient in $userIds and
     * update the push_broadcasts row counters as we go. Caller is expected to
     * have already INSERTed the broadcast row (status='sending') and gotten
     * its id back.
     *
     * Returns ['delivered' => N, 'failed' => N].
     */
    public static function dispatch(
        int    $broadcastId,
        array  $userIds,
        string $title,
        string $body,
        ?string $deepLink
    ): array {
        $delivered = 0;
        $failed    = 0;
        $data = [
            'broadcastId' => $broadcastId,
            'deepLink'    => $deepLink ?? '',
        ];

        // Batch the loop — gives us periodic checkpoints to update counters
        // and lets a long-running dispatch report progress to the history page
        // mid-flight. NotificationRepository::createUnchecked wraps a single
        // INSERT + 2 fire-and-forget HTTP calls (web + native push).
        foreach (array_chunk($userIds, self::BATCH_SIZE) as $batch) {
            foreach ($batch as $uid) {
                try {
                    NotificationRepository::createUnchecked($uid, 'admin_announcement', $title, $body, $data);
                    $delivered++;
                } catch (\Throwable $e) {
                    error_log('[push-broadcast] dispatch failed for user=' . $uid . ' err=' . $e->getMessage());
                    $failed++;
                }
            }
            // Progress checkpoint — admin's history page can poll this row.
            Database::pdo()
                ->prepare("UPDATE push_broadcasts SET delivered_count = ?, failed_count = ? WHERE id = ?")
                ->execute([$delivered, $failed, $broadcastId]);
        }

        Database::pdo()
            ->prepare("UPDATE push_broadcasts SET status = 'sent', sent_at = now(), delivered_count = ?, failed_count = ? WHERE id = ?")
            ->execute([$delivered, $failed, $broadcastId]);

        return ['delivered' => $delivered, 'failed' => $failed];
    }

    /**
     * Insert the broadcast audit row. Returns the new id.
     */
    public static function recordBroadcast(
        string  $adminUsername,
        ?string $adminIp,
        string  $title,
        string  $body,
        string  $audienceType,
        array   $audienceFilter,
        ?string $deepLink,
        int     $recipientCount
    ): int {
        $stmt = Database::pdo()->prepare("
            INSERT INTO push_broadcasts
                (admin_username, admin_ip, title, body, audience_type, audience_filter,
                 deep_link, recipient_count, status)
            VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, ?, 'sending')
            RETURNING id
        ");
        $stmt->execute([
            $adminUsername,
            $adminIp,
            $title,
            $body,
            $audienceType,
            json_encode($audienceFilter),
            $deepLink,
            $recipientCount,
        ]);
        return (int) $stmt->fetchColumn();
    }

    /**
     * Mark a broadcast as failed if the dispatch loop crashes or the audience
     * resolves to zero. Keeps the history honest.
     */
    public static function markFailed(int $broadcastId): void
    {
        Database::pdo()
            ->prepare("UPDATE push_broadcasts SET status = 'failed', sent_at = now() WHERE id = ?")
            ->execute([$broadcastId]);
    }

    /** History page — most recent broadcasts first. */
    public static function listRecent(int $limit = 50): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT id, admin_username, title, body, audience_type, audience_filter,
                   deep_link, recipient_count, delivered_count, failed_count, status,
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at,
                   to_char(sent_at    AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS sent_at
            FROM push_broadcasts
            ORDER BY created_at DESC
            LIMIT ?
        ");
        $stmt->bindValue(1, $limit, \PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll(\PDO::FETCH_ASSOC);
    }
}
