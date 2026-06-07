<?php

declare(strict_types=1);

/**
 * MobilePushService — delivers push notifications to native (iOS/Android) devices
 * via the Expo Push Notifications API.
 *
 * Architecture:
 *   NotificationRepository::create()
 *     → MobilePushService::send()       ← this file
 *     → PushService::send()             ← existing web-push (VAPID)
 *
 * Anti-noise rules:
 *   event_join  — max 1 push per (user, event) per 5 minutes
 *   new_event   — max 1 push per (user, city channel) per 1 hour
 *   dm_message  — no cooldown (each message is relevant)
 *   event_message — no cooldown
 *
 * Token lifecycle:
 *   - Tokens stored in mobile_push_tokens table (one row per device)
 *   - DeviceNotRegistered response → token deleted automatically
 */
class MobilePushService
{
    private const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

    // Expo accepts up to 100 messages per HTTP request. We queue every message
    // built during a request and flush them in 100-message batches at shutdown,
    // so a fan-out to N recipients costs ~ceil(messages/100) HTTP calls instead
    // of N — critical on non-FPM where this runs in-request (see deploy notes).
    private const EXPO_BATCH_SIZE = 100;
    /** @var array<int, array{message: array, token: string}> */
    private static array $queue = [];
    private static bool $flushRegistered = false;

    /** Map notification type → notification_preferences column */
    private static function prefColumn(string $type): ?string
    {
        return match ($type) {
            'dm_message'      => 'dm_push',
            'event_message'   => 'event_message_push',
            'event_join'      => 'event_join_push',
            'new_event'       => 'new_event_push',
            'mention'         => 'mention_push',
            'channel_message' => 'channel_message_push',
            'city_join'       => 'city_join_push',
            'vibe_received'   => 'vibe_received_push',
            'profile_view'    => 'profile_view_push',
            'topic_message'   => 'topic_reply_push',
            'new_topic'       => 'new_topic_push',
            default           => null,
        };
    }

    /** Anti-noise cooldown in seconds (0 = no cooldown) */
    private static function cooldownSeconds(string $type): int
    {
        return match ($type) {
            'dm_message'      => 5,     // 5s — one push per conversation (same sender) per recipient
            'event_message'   => 5,     // 5s — one push per event (any sender) per recipient
            'channel_message' => 5,     // 5s — one push per city channel (any sender) per recipient
            'event_join'      => 300,   // 5 min — avoid bursts when many people join
            'new_event'       => 3600,  // 1 hour — city events should not spam
            'city_join'       => 5,     // 5s — different-arriver floor; same-arriver 1h gate is upstream (NotificationRepository)
            'topic_message'   => 120,   // 2 min — prevents burst spam on active topics
            default           => 0,
        };
    }

    /** Extract the deduplication ref ID for cooldown checks */
    private static function refId(string $type, array $data): string
    {
        return match ($type) {
            'dm_message'                   => $data['conversationId'] ?? '',
            'event_message',
            'event_join'                   => $data['eventId'] ?? '',
            'new_event',
            'channel_message',
            'city_join'                    => $data['channelId'] ?? '',
            // Friend-request types dedupe per pair so a sender can't burst
            // pushes by tapping Add → cancel → Add → cancel.
            'friend_request_received',
            'friend_added'                 => $data['senderUserId'] ?? '',
            'friend_request_accepted'      => $data['accepterUserId'] ?? '',
            'profile_view'                 => $data['viewerId'] ?? '',
            'topic_message',
            'new_topic'                    => $data['topicId'] ?? '',
            default                        => '',
        };
    }

    /**
     * Send a native push to all registered devices for $userId.
     *
     * Respects notification preferences and anti-noise cooldowns.
     * All errors are swallowed — in-app notification is already persisted.
     */
    public static function send(
        string  $userId,
        string  $type,
        string  $title,
        ?string $body,
        array   $data = []
    ): void {
        try {
            error_log("[push-send] recipient=$userId type=$type title=" . json_encode($title));

            // 1. Check user preference for this notification type
            $prefCol = self::prefColumn($type);
            if ($prefCol !== null) {
                $prefs = NotificationPreferencesRepository::get($userId);
                $prefValue = $prefs[$prefCol] ?? null;
                error_log("[push-send] pref[$prefCol]=" . json_encode($prefValue) . " for user=$userId");
                if (!$prefValue) {
                    error_log("[push-send] skipping $type for user=$userId — preference disabled");
                    return;
                }
            }

            // 2. Anti-noise cooldown
            $cooldown = self::cooldownSeconds($type);
            if ($cooldown > 0) {
                $refId = self::refId($type, $data);
                if (self::isOnCooldown($userId, $type, $refId, $cooldown)) {
                    error_log("[push-send] skipping $type for user=$userId refId=$refId — on cooldown");
                    return;
                }
                self::recordDelivery($userId, $type, $refId);
            }

            // 3. Fetch registered device tokens for this user,
            //    then exclude any token that is ALSO registered under the sender's user_id.
            //    This prevents a push reaching the sender's physical device when a push
            //    token was re-assigned between accounts (e.g. two accounts on one device).
            $stmt = Database::pdo()->prepare(
                "SELECT token FROM mobile_push_tokens WHERE user_id = ?"
            );
            $stmt->execute([$userId]);
            $tokens = $stmt->fetchAll(\PDO::FETCH_COLUMN);

            $senderUserId = $data['senderUserId'] ?? null;
            if ($senderUserId !== null && $senderUserId !== $userId && !empty($tokens)) {
                $senderStmt = Database::pdo()->prepare(
                    "SELECT token FROM mobile_push_tokens WHERE user_id = ?"
                );
                $senderStmt->execute([$senderUserId]);
                $senderTokens = array_flip($senderStmt->fetchAll(\PDO::FETCH_COLUMN));
                if (!empty($senderTokens)) {
                    $before = count($tokens);
                    $tokens = array_values(array_filter($tokens, fn($t) => !isset($senderTokens[$t])));
                    if (count($tokens) < $before) {
                        error_log("[push-send] removed " . ($before - count($tokens)) . " token(s) shared with sender=$senderUserId for recipient=$userId");
                    }
                }
            }

            error_log("[push-send] found " . count($tokens) . " mobile token(s) for user=$userId"
                . (count($tokens) > 0 ? ": " . implode(", ", $tokens) : ""));

            if (empty($tokens)) {
                error_log("[push-send] no mobile tokens for user=$userId — skipping $type");
                return;
            }

            // Interactive notification category (Accept/Decline action buttons).
            // The matching category is registered client-side in push.ts. Only
            // actionable types carry one; everything else opens on tap.
            $category = match ($type) {
                'friend_request_received' => 'friend_request',
                'join_request'            => 'join_request',
                'new_event'               => 'new_event',
                'challenge_invitation'    => 'challenge_invitation',
                default                   => null,
            };

            // PR35 — actionable pushes go out as heads-up (Android "high"
            // priority, iOS time-sensitive). Without this the notification
            // arrives collapsed in the system tray and the Accept / Ignore
            // buttons are hidden until the user manually expands the card —
            // the user complaint that triggered this change ("I don't see
            // the Accept CTA on the push"). High priority surfaces the
            // banner over the current screen with the action buttons
            // visible immediately.
            $isActionable = $category !== null;

            // 4. Build Expo push payload (one message per device)
            $payload = array_map(fn($token) => array_filter([
                'to'         => $token,
                'title'      => $title,
                'body'       => $body ?? '',
                'data'       => array_merge($data, ['type' => $type]),
                'sound'      => 'default',
                'channelId'  => 'default', // Android channel defined in push.ts
                'categoryId' => $category, // null → dropped by array_filter
                'priority'   => $isActionable ? 'high' : null,
                // iOS-only — make actionable pushes time-sensitive so the
                // system bypasses focus modes + shows the full banner.
                '_displayInForeground' => $isActionable ? true : null,
            ], fn($v) => $v !== null), $tokens);

            // 5. Queue the messages — they're POSTed to Expo in batches at
            //    shutdown (see flush()). $payload is index-aligned with $tokens.
            foreach ($tokens as $i => $token) {
                self::$queue[] = ['message' => $payload[$i], 'token' => $token];
            }
            if (!self::$flushRegistered) {
                self::$flushRegistered = true;
                register_shutdown_function([self::class, 'flush']);
            }
            error_log("[push-send] queued $type for user=$userId (" . count($tokens) . " device(s))");
        } catch (\Throwable $e) {
            error_log("[push-send] EXCEPTION for user=$userId type=$type: " . $e->getMessage() . "\n" . $e->getTraceAsString());
        }
    }

    /**
     * Flush all queued Expo messages in batches of EXPO_BATCH_SIZE. Registered
     * once per request (incl. when send() is itself called from a shutdown
     * function — newly-registered shutdown fns still run). Expo returns receipts
     * in request order, so each batch maps response[i] → the i-th token for
     * DeviceNotRegistered cleanup.
     */
    public static function flush(): void
    {
        $queue = self::$queue;
        self::$queue = [];
        if (empty($queue)) return;

        try {
            foreach (array_chunk($queue, self::EXPO_BATCH_SIZE) as $chunk) {
                $messages = array_column($chunk, 'message');
                $response = self::postToExpo($messages);
                if ($response === null) {
                    error_log('[push-flush] Expo request failed for a batch of ' . count($messages));
                    continue;
                }
                $decoded = json_decode($response, true);
                if (!is_array($decoded['data'] ?? null)) continue;

                $invalid = [];
                foreach ($decoded['data'] as $i => $result) {
                    if (($result['status'] ?? '') === 'error'
                        && ($result['details']['error'] ?? '') === 'DeviceNotRegistered'
                        && isset($chunk[$i]['token'])) {
                        $invalid[] = $chunk[$i]['token'];
                    }
                }
                if (!empty($invalid)) {
                    $ph = implode(',', array_fill(0, count($invalid), '?'));
                    Database::pdo()
                        ->prepare("DELETE FROM mobile_push_tokens WHERE token IN ($ph)")
                        ->execute($invalid);
                }
            }
        } catch (\Throwable $e) {
            error_log('[push-flush] EXCEPTION: ' . $e->getMessage());
        }
    }

    // ── Cooldown helpers ──────────────────────────────────────────────────────

    private static function isOnCooldown(
        string $userId,
        string $type,
        string $refId,
        int    $cooldownSeconds // always a hardcoded constant — safe to interpolate
    ): bool {
        $stmt = Database::pdo()->prepare("
            SELECT 1 FROM push_delivery_log
            WHERE user_id = ? AND type = ? AND ref_id = ?
              AND sent_at > now() - interval '{$cooldownSeconds} seconds'
            LIMIT 1
        ");
        $stmt->execute([$userId, $type, $refId]);
        return (bool) $stmt->fetchColumn();
    }

    private static function recordDelivery(string $userId, string $type, string $refId): void
    {
        Database::pdo()->prepare(
            "INSERT INTO push_delivery_log (user_id, type, ref_id) VALUES (?, ?, ?)"
        )->execute([$userId, $type, $refId]);
    }

    // ── HTTP ──────────────────────────────────────────────────────────────────

    private static function postToExpo(array $payload): ?string
    {
        $context = stream_context_create([
            'http' => [
                'method'        => 'POST',
                'header'        => "Content-Type: application/json\r\nAccept: application/json\r\n",
                'content'       => json_encode($payload),
                'timeout'       => 2, // keep short: on non-FPM this runs in-request, per recipient
                'ignore_errors' => true,
            ],
        ]);
        $result = @file_get_contents(self::EXPO_PUSH_URL, false, $context);
        return $result !== false ? $result : null;
    }
}
