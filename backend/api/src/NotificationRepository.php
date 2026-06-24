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
        array   $data = [],
        bool    $push = true
    ): array {
        // Skip if recipient has disabled this notification type
        if (!self::isEnabledForUser($userId, $type)) {
            return [];
        }
        return self::createUnchecked($userId, $type, $title, $body, $data, null, $push);
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
        array   $data = [],
        ?string $locale = null,
        bool    $push = true
    ): array {
        // Crawler / bot accounts: drop EVERYTHING they would trigger as an actor
        // - no bell row written, no web push, no native push. Recipients of
        // their actions (mentions, DMs from them, profile-view of them, …) see
        // nothing. Reads / crawl are unaffected (gate is here on the write/push
        // side, not on the request). Common actor keys are inspected via
        // BotAccountService::isBotActor; arrivals are gated separately upstream
        // in emitCityArrival because they don't go through this path.
        if (BotAccountService::isBotActor($data)) {
            return [];
        }

        // Localize per recipient - covers the stored bell row AND both push
        // channels below, since they all read $title/$body from here. English /
        // unknown locales and untranslated fields fall back to the caller's text.
        if (NotificationI18n::isTranslatable($type)) {
            $loc = $locale ?? self::userLocale($userId);
            if ($loc !== 'en') {
                [$lt, $lb] = NotificationI18n::render($type, $loc, $data);
                if ($lt !== null) $title = $lt;
                if ($lb !== null) $body  = $lb;
            }
        }

        $stmt = Database::pdo()->prepare("
            INSERT INTO notifications (user_id, type, title, body, data)
            VALUES (?, ?, ?, ?, ?::jsonb)
            RETURNING id, user_id, type, title, body, data::text, is_read,
                      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at
        ");
        $stmt->execute([$userId, $type, $title, $body, json_encode($data)]);
        $notif = self::normalise($stmt->fetch(\PDO::FETCH_ASSOC));

        // Push is suppressed for the actor's own reveal (e.g. the challenger who
        // just validated): they get the celebration modal directly via the WS
        // ping + reveal refetch, so a push would be redundant/confusing. The bell
        // row above is still written (the reveal gate reads it, ack on close).
        if ($push) {
            // Web push (browser VAPID) - fire-and-forget
            PushService::send($userId, $type, $title, $body, self::pushUrl($type, $data), self::pushTag($type, $data), $data);

            // Native push (iOS/Android via Expo) - fire-and-forget
            MobilePushService::send($userId, $type, $title, $body, $data);
        }

        return $notif;
    }

    private static function typeToColumn(string $type): ?string
    {
        return match ($type) {
            'dm_message'                                                => 'dm_push',
            'event_message'                                             => 'event_message_push',
            'event_join'                                                => 'event_join_push',
            'new_event'                                                 => 'new_event_push',
            'new_challenge'                                             => 'new_challenge_push',
            'mention'                                                   => 'mention_push',
            'channel_message'                                           => 'channel_message_push',
            // @here broadcast - gated by the same city-chat push toggle, so
            // muting city chat also mutes being @here'd.
            'city_here'                                                 => 'channel_message_push',
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
            // Hangout join-request flow: notify participants of a request, and
            // notify the requester when accepted. Both gated by one pref.
            'join_request',
            'join_request_accepted'                                     => 'join_request_push',
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
            'new_event_push'       => true,
            'new_challenge_push'   => true,
            'mention_push'         => true,
            'channel_message_push' => false,
            'city_join_push'       => false,
            'friend_request_push'  => true,
            'vibe_received_push'   => true,
            'profile_view_push'    => true,
            'topic_reply_push'     => true,
            'new_topic_push'       => false,
            'join_request_push'    => true,
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
     * Batch-load notification preferences for multiple users - 1 query instead of N.
     * Returns [ userId => bool ] indicating whether the given type is enabled for each user.
     */
    private static function batchIsEnabled(array $userIds, string $type): array
    {
        $col = self::typeToColumn($type);
        if ($col === null) {
            // Unknown type - always enabled for everyone
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

    // Per-request cache so a user who gets several notifications in one request
    // (e.g. channel_message + mention) is only looked up once.
    private static array $localeCache = [];

    /** Recipient's UI language (en/fr/vi). Defaults to 'en' on miss/error. */
    private static function userLocale(string $userId): string
    {
        if (isset(self::$localeCache[$userId])) return self::$localeCache[$userId];
        try {
            $stmt = Database::pdo()->prepare("SELECT locale FROM users WHERE id = ?");
            $stmt->execute([$userId]);
            $loc = $stmt->fetchColumn();
        } catch (\Throwable) {
            $loc = false;
        }
        return self::$localeCache[$userId] = ($loc ?: 'en');
    }

    /** Batch-load locales for a fan-out - 1 query instead of N. Returns [uid => locale]. */
    private static function batchLocale(array $userIds): array
    {
        if (empty($userIds)) return [];
        try {
            $ph   = implode(',', array_fill(0, count($userIds), '?'));
            $stmt = Database::pdo()->prepare("SELECT id, locale FROM users WHERE id IN ({$ph})");
            $stmt->execute($userIds);
            $rows = array_column($stmt->fetchAll(\PDO::FETCH_ASSOC), 'locale', 'id');
        } catch (\Throwable) {
            $rows = [];
        }
        $out = [];
        foreach ($userIds as $uid) {
            $out[$uid] = self::$localeCache[$uid] = ($rows[$uid] ?? 'en');
        }
        return $out;
    }

    private static function pushUrl(string $type, array $data): string
    {
        return match ($type) {
            'dm_message'                      => '/conversations',
            'event_message', 'event_join',
            'new_event'                       => isset($data['eventId']) ? "/event/{$data['eventId']}" : '/',
            'new_challenge'                   => isset($data['challengeId']) ? "/challenge/{$data['challengeId']}" : '/',
            // Mention deep-links to the message's context: event chat, pulse, or city chat.
            'mention'                         => isset($data['eventId']) ? "/event/{$data['eventId']}"
                                                : (isset($data['topicId']) ? "/topic/{$data['topicId']}" : '/'),
            'channel_message', 'city_join'    => '/',
            'friend_request_received'         => '/friend-requests',
            'friend_request_accepted'         => isset($data['accepterUserId']) ? "/user/{$data['accepterUserId']}" : '/me',
            // Legacy friend_added rows (pre-refactor) keep deep-linking to the
            // adder's profile so old notifications still work after upgrade.
            'friend_added'                    => isset($data['senderUserId']) ? "/user/{$data['senderUserId']}" : '/notifications',
            'vibe_received'                   => '/me',
            'profile_view'                    => isset($data['viewerId']) ? "/user/{$data['viewerId']}" : '/notifications',
            'topic_message', 'new_topic',
            'join_request', 'join_request_accepted' => isset($data['topicId']) ? "/topic/{$data['topicId']}" : '/',
            // Admin broadcasts can include a custom deepLink; falls back to
            // the notifications screen so the row is at least viewable.
            'admin_announcement'              => $data['deepLink'] ?? '/notifications',
            // Tap → open the challenge. Push action buttons (Accept / Ignore)
            // close the loop on the invitation directly without the user
            // having to land in the app.
            'challenge_invitation'            => isset($data['challengeId']) ? "/challenge/{$data['challengeId']}" : '/notifications',
            // Cross-city heads-up - tap lands the user on the challenge so
            // they can decide whether to take it on.
            'challenge_international_target'  => isset($data['challengeId']) ? "/challenge/{$data['challengeId']}" : '/(tabs)/now',
            // PR47 - mutual rating complete. Tap → channel; the
            // ScoreCelebrationLaunchGate on app-open also surfaces the
            // popin with the newly-earned debrief points.
            'challenge_rated_complete'        => isset($data['challengeId']) ? "/challenge/{$data['challengeId']}" : '/notifications',
            // FIRST rating landed → push the counterparty back to the
            // challenge so the RatePromptLaunchGate can surface the
            // RateSheet for the side that hasn't rated yet.
            'rating_received'                 => isset($data['challengeId']) ? "/challenge/{$data['challengeId']}" : '/notifications',
            // Date proposed - tap lands the recipient in the channel
            // where the ScheduleBlock surfaces the Approve / Counter-
            // propose buttons.
            'challenge_date_proposed'         => isset($data['challengeId']) ? "/challenge/{$data['challengeId']}" : '/notifications',
            // Taker left - creator taps through to their (now reopened) challenge.
            'challenge_acceptor_left'         => isset($data['challengeId']) ? "/challenge/{$data['challengeId']}" : '/notifications',
            // Creator restarted - removed taker taps through to the (reopened) challenge.
            'challenge_restarted'             => isset($data['challengeId']) ? "/challenge/{$data['challengeId']}" : '/notifications',
            // Date approved - same target as proposed; recipient lands
            // in the channel to see "✅ Meet on …" + the celebration
            // popin the SCG re-fires off the WS broadcast on entry.
            'challenge_date_approved'         => isset($data['challengeId']) ? "/challenge/{$data['challengeId']}" : '/notifications',
            // New message in a challenge channel - fan-out to creator,
            // active takers, and explicit spectators. Tap lands in the
            // challenge chat just like an event message lands in the
            // event chat.
            'challenge_message'               => isset($data['challengeId']) ? "/challenge/{$data['challengeId']}" : '/notifications',
            // Group result reveal (winner picked / presence validated) - tap
            // opens the challenge; the ChallengeResultLaunchGate surfaces the
            // role-specific reveal modal off the unread notification's data.
            'challenge_group_result_photo',
            'challenge_group_result_meet'     => isset($data['challengeId']) ? "/challenge/{$data['challengeId']}" : '/notifications',
            'challenge_group_join'            => isset($data['challengeId']) ? "/challenge/{$data['challengeId']}" : '/notifications',
            'challenge_takeon_request'        => isset($data['challengeId']) ? "/challenge/{$data['challengeId']}" : '/notifications',
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
            'mention'                 => 'mention-'       . ($data['messageId'] ?? 'm'),
            'channel_message'         => 'channel-'       . ($data['channelId'] ?? 'city'),
            'city_join'               => 'cityjoin-'      . ($data['channelId'] ?? 'city'),
            'friend_request_received' => 'friend-req-'    . ($data['senderUserId'] ?? 'user'),
            'friend_request_accepted' => 'friend-acc-'    . ($data['accepterUserId'] ?? 'user'),
            'friend_added'            => 'friend-'        . ($data['senderUserId'] ?? 'user'),
            'vibe_received'           => 'vibe-'          . ($data['actorId'] ?? 'user'),
            'profile_view'            => 'profile-view-'  . ($data['viewerId'] ?? 'user'),
            'topic_message'           => 'topic-'         . ($data['topicId'] ?? 'topic'),
            'new_topic'               => 'new-topic-'     . ($data['topicId'] ?? 'topic'),
            'join_request'            => 'joinreq-'       . ($data['requestId'] ?? 'r'),
            'join_request_accepted'   => 'joinacc-'       . ($data['topicId'] ?? 'topic'),
            'admin_announcement'      => 'admin-'         . ($data['broadcastId'] ?? 'b'),
            'challenge_invitation'    => 'chinv-'         . ($data['invitationId'] ?? 'x'),
            'challenge_rated_complete' => 'chrated-'      . ($data['challengeId'] ?? 'c'),
            'rating_received'         => 'chrating-'     . ($data['challengeId'] ?? 'c'),
            'challenge_date_proposed' => 'chdate-'       . ($data['challengeId'] ?? 'c'),
            'challenge_date_approved' => 'chdateok-'     . ($data['challengeId'] ?? 'c'),
            // Tag per (challenge, conversation) so a burst of messages
            // collapses into one push group on the device (mirrors how
            // dm_message / event_message tag by their channel).
            'challenge_message'       => 'chmsg-'        . ($data['challengeId'] ?? 'c'),
            'challenge_group_result_photo',
            'challenge_group_result_meet' => 'chresult-' . ($data['challengeId'] ?? 'c'),
            'challenge_group_join'    => 'chjoin-'       . ($data['challengeId'] ?? 'c'),
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
    // sync - adding a new "envelope-only" type only requires editing this list.
    private const BELL_EXCLUDED_TYPES = ['dm_message', 'event_message', 'channel_message', 'challenge_message'];

    private static function bellExclusionSql(): string
    {
        // Inlined - types are hardcoded constants, no injection surface.
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
        // table - touching them here would silently break the envelope's badge.
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
        array   $data,
        array   $excludeUserIds = []
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
        if (!empty($excludeUserIds)) $userIds = array_values(array_diff($userIds, $excludeUserIds));
        if (empty($userIds)) return;

        // Batch-load preferences + locales - 1 query each regardless of count
        $enabled = self::batchIsEnabled($userIds, $type);
        $locales = self::batchLocale($userIds);
        foreach ($userIds as $uid) {
            if ($enabled[$uid] ?? true) {
                self::createUnchecked($uid, $type, $title, $body, $data, $locales[$uid] ?? 'en');
            }
        }
    }

    /**
     * Notify everyone watching a challenge's chat - creator + active takers +
     * explicit spectators - when a new message lands. Mirrors
     * notifyEventParticipants for events, gated by the per-(challenge, user)
     * preference written by the in-channel toggle pill.
     *
     * Recipient set is the UNION of:
     *   - creator                          (channel_challenges.created_by)
     *   - active takers                    (challenge_acceptances where phase <> 'rejected')
     *   - explicit joiners / spectators    (challenge_participants where user_id IS NOT NULL)
     *
     * Per-channel toggle: challenge_participants.notification_preference. 'off'
     * suppresses; anything else (default 'milestones', 'all') allows the push.
     * Users without a participation row default to enabled - important for the
     * creator (who never gets a row written for them) and for active takers
     * whose acceptance landed before they had a chance to toggle anything.
     */
    public static function notifyChallengeChannelMessage(
        string  $challengeId,
        ?string $excludeUserId,
        string  $type,
        string  $title,
        ?string $body,
        array   $data,
        array   $excludeUserIds = []
    ): void {
        // One round-trip: list every distinct user_id in any of the three
        // roles whose challenge_participants.notification_preference is not
        // 'off'. LEFT JOIN so a missing row falls back to the default via
        // COALESCE. $challengeId is bound four times - once for the
        // participants JOIN and once per UNION leg.
        $stmt = Database::pdo()->prepare("
            SELECT DISTINCT u.id
            FROM users u
            LEFT JOIN challenge_participants cp
              ON cp.channel_id = ? AND cp.user_id = u.id
            WHERE u.deleted_at IS NULL
              AND u.id IN (
                  SELECT created_by FROM channel_challenges
                  WHERE channel_id = ? AND created_by IS NOT NULL
                  UNION
                  SELECT acceptor_user_id FROM challenge_acceptances
                  WHERE challenge_id = ? AND phase <> 'rejected' AND acceptor_user_id IS NOT NULL
                  UNION
                  SELECT user_id FROM challenge_participants
                  WHERE channel_id = ? AND user_id IS NOT NULL
              )
              AND COALESCE(cp.notification_preference, 'milestones') <> 'off'
              AND (CAST(? AS text) IS NULL OR u.id::text != CAST(? AS text))
        ");
        $stmt->execute([
            $challengeId, $challengeId, $challengeId, $challengeId,
            $excludeUserId, $excludeUserId,
        ]);
        $userIds = $stmt->fetchAll(\PDO::FETCH_COLUMN);
        if (!empty($excludeUserIds)) $userIds = array_values(array_diff($userIds, $excludeUserIds));
        if (empty($userIds)) return;

        // batchIsEnabled is a no-op for 'challenge_message' (no typeToColumn
        // entry → null → enabled for everyone). Per-channel preference above
        // is the only gate for this type.
        $enabled = self::batchIsEnabled($userIds, $type);
        $locales = self::batchLocale($userIds);
        foreach ($userIds as $uid) {
            if ($enabled[$uid] ?? true) {
                self::createUnchecked($uid, $type, $title, $body, $data, $locales[$uid] ?? 'en');
            }
        }
    }

    /**
     * Notify all registered acceptors of a challenge, excluding one user.
     * Used when the creator validates the challenge (fan-out to acceptors).
     *
     * Reads from challenge_acceptances (the new model - one row per take-on).
     * The legacy challenge_participants table is no longer the source of truth
     * for take-on relationships; reading it here meant nobody got a push when
     * the creator marked the challenge accomplished.
     */
    public static function notifyChallengeParticipants(
        string  $challengeId,
        ?string $excludeUserId,
        string  $type,
        string  $title,
        ?string $body,
        array   $data,
        array   $excludeUserIds = []
    ): void {
        $stmt = Database::pdo()->prepare("
            SELECT DISTINCT acceptor_user_id AS user_id
            FROM challenge_acceptances
            WHERE challenge_id = ?
              AND acceptor_user_id IS NOT NULL
              AND phase <> 'rejected'
              AND (CAST(? AS text) IS NULL OR acceptor_user_id::text != CAST(? AS text))
        ");
        $stmt->execute([$challengeId, $excludeUserId, $excludeUserId]);
        $userIds = $stmt->fetchAll(\PDO::FETCH_COLUMN);
        if (!empty($excludeUserIds)) $userIds = array_values(array_diff($userIds, $excludeUserIds));
        if (empty($userIds)) return;

        $enabled = self::batchIsEnabled($userIds, $type);
        $locales = self::batchLocale($userIds);
        foreach ($userIds as $uid) {
            if ($enabled[$uid] ?? true) {
                self::createUnchecked($uid, $type, $title, $body, $data, $locales[$uid] ?? 'en');
            }
        }
    }

    /**
     * One "group result reveal" notification to a single participant: push +
     * bell + the data the reveal modal reads. The title/body CONCEAL the outcome
     * ("tap to see"); the winner and the recipient's OWN role/points live in
     * $data for the modal. Always enabled (typeToColumn default → null). Caller
     * loops every participant with role-specific $data. $format = 'photo'|'meet'.
     */
    public static function notifyGroupResult(
        string $userId,
        string $challengeId,
        string $format,
        string $challengerName,
        array  $data,
        bool   $push = true
    ): void {
        $type  = $format === 'meet' ? 'challenge_group_result_meet' : 'challenge_group_result_photo';
        $title = $format === 'meet'
            ? "🎉 {$challengerName} validated the meet"
            : "🏆 {$challengerName} chose the winning photo";
        // Lead the body with the challenge name so the recipient knows WHICH
        // challenge resolved (was missing - just said "Tap to see who won").
        $ctitle = isset($data['challengeTitle']) ? trim((string) $data['challengeTitle']) : '';
        $tail   = $format === 'meet' ? 'Tap to see how it went' : 'Tap to see who won';
        $body   = $ctitle !== '' ? "{$ctitle} · {$tail}" : $tail;
        // $push=false for the actor (host) - they get the modal directly, no push.
        self::create($userId, $type, $title, $body, array_merge($data, [
            'challengeId'    => $challengeId,
            'challengerName' => $challengerName,
            'name'           => $challengerName,   // {name} fallback for NotificationI18n
            'title'          => $ctitle,           // {title} for NotificationI18n bodies
        ]), $push);
    }

    /**
     * Notify registered users associated with a city channel, excluding one user.
     *
     * Recipient set depends on $type:
     *
     *   - 'new_event' / 'city_join': users whose current_city_id matches, active
     *     in the last 30 days. current_city_id is the canonical membership signal
     *     (the user's current/last city), so this reaches city members even when
     *     their app is closed - the whole point of a push. Mirrors how an event
     *     owner is notified of a join regardless of being online. Rate-limited to
     *     1 per (user, city) per 10 min.
     *
     *   - Anything else: users with a presence heartbeat in the last 3 minutes.
     *     Appropriate for transient signals like 'channel_message' where you
     *     only want to ping users actively engaged in the channel right now.
     */
    // "Someone arrived" re-notification cooldown for the SAME arriver (keyed
    // u:<userId> / g:<guestId> per city). Within this window a returning person
    // re-announces NOTHING - no feed "just landed" line, no in-app notification,
    // no push. A foreground/reconnect/quick-return all land inside it. Different
    // arrivers are NOT affected by this (each has its own key); they're throttled
    // only by the lighter per-recipient window in notifyCityOnlineUsers. Tune here.
    private const ARRIVAL_COOLDOWN_SECONDS = 3600; // 1 hour (same arriver, per city)

    // Cap the city-wide push fan-out (city_join / new_event) to the N most
    // recently-active city members. Bounds the per-arrival work - which runs
    // IN-REQUEST on non-FPM (see deploy notes) - so a large/active city can't
    // pin a worker with an unbounded synchronous push loop. Members past the cap
    // (the most dormant tail) don't get this push. Tune here.
    private const CITY_PUSH_FANOUT_CAP = 200;

    /**
     * Emit a genuine city arrival across BOTH surfaces - the feed "X just landed"
     * system message AND the "Someone arrived" push - behind a SINGLE atomic
     * cooldown claim, so the two can never duplicate or diverge. This is the ONLY
     * entry point the join/bootstrap paths should use for arrivals.
     *
     * $arriverUserId - the arriver's registered id, or null. Lean bootstrap (web)
     *   skips auth so it arrives null here; we resolve it from guest_id so the
     *   arriver is reliably excluded from their own push.
     *
     * The feed message is a channel message everyone polls; the arriver's own
     * client self-filters it so they never see their own arrival line.
     */
    public static function emitCityArrival(
        int     $channelId,
        ?string $arriverUserId,
        string  $arriverGuestId,
        string  $arriverNickname,
        ?string $cityName
    ): void {
        $cityChannelId = 'city_' . $channelId;

        // Resolve the arriver's registered id when the caller didn't (lean path),
        // so self-exclusion works and the cooldown keys on a stable identity.
        if ($arriverUserId === null && $arriverGuestId !== '') {
            $stmt = Database::pdo()->prepare("SELECT id FROM users WHERE guest_id = ?");
            $stmt->execute([$arriverGuestId]);
            $arriverUserId = $stmt->fetchColumn() ?: null;
        }

        // Crawler / bot accounts: their reads still work (POST /bootstrap
        // upstream already wrote presence), we just don't want them to
        // generate the visible noise of an arrival - no feed "X just landed"
        // line, no WS broadcast, no city-wide push fan-out. Check both the
        // resolved user_id and the nickname so a guest-mode bot is caught too.
        if (BotAccountService::isBotUserId($arriverUserId) || BotAccountService::isBotNickname($arriverNickname)) {
            return;
        }
        $arriverKey = $arriverUserId !== null ? ('u:' . $arriverUserId) : ('g:' . $arriverGuestId);

        // Single genuine-arrival gate for BOTH surfaces. Atomic + DB-backed, so it
        // holds across PHP-FPM workers and even if both join paths fire for one
        // arrival: only the first claim inside the cooldown window emits anything.
        $fresh = self::tryMarkArrival($arriverKey, $cityChannelId, self::ARRIVAL_COOLDOWN_SECONDS);

        // ALWAYS-on nickname gate as a secondary lock. Catches the cross-device /
        // lean-mode case for registered users: web /bootstrap in lean mode skips
        // AuthService::currentUser(), so $arriverUserId is null at the call site;
        // emitCityArrival then falls back to a `SELECT users WHERE guest_id = ?`,
        // which only matches if the request's guest_id equals the one stamped on
        // users at signup. A registered user on a different device (different
        // guest_id) falls through to arriverKey = 'g:<newGuestId>' - a brand-new
        // primary key that the 1h gate has never seen, so it fires even though
        // the same person arrived an hour earlier on another device under
        // 'u:<userId>'. The nickname gate (now run unconditionally) catches that
        // collision because the user's displayed nickname is the same in both
        // calls, locking them into the same secondary row.
        //
        // Edge cost: two distinct accounts choosing the SAME display nickname
        // arriving within the same hour - one of their arrival pings is muted.
        // Auto-generated handles (kitty_3-style) are unique per account so this
        // never happens for them; for hand-picked display names it's rare and the
        // worst-case symptom is a missed feed line, not over-spam.
        $nick = mb_strtolower(trim($arriverNickname));
        if ($nick !== '') {
            $nameFresh = self::tryMarkArrival('nm:' . $nick, $cityChannelId, self::ARRIVAL_COOLDOWN_SECONDS);
            $fresh = $fresh && $nameFresh;
        }

        if (!$fresh) {
            return;
        }

        // Feed system message ("X just landed"). Others see it; the arriver's own
        // client self-filters it. One per genuine arrival (gated above).
        try {
            // Origin country from Cloudflare's CF-IPCountry header (free) so the
            // BO can show where an arriving guest is connecting from.
            $country = Request::country();
            $joinMsg = MessageRepository::addJoinEvent($channelId, $arriverGuestId, $arriverNickname, $arriverUserId, $country, Request::ip(), Request::platform());
            // Broadcast over WS so clients already in the city see the line live.
            // Without this the join row is only written to the DB and appears for
            // others on their NEXT fetch (app restart) - chat messages broadcast,
            // arrivals didn't.
            self::broadcastMessageToWs($channelId, $joinMsg);
        } catch (\Throwable $e) {
            error_log('[arrival] join feed write/broadcast failed: ' . $e->getMessage());
        }

        // Push to opted-in city members, excluding the arriver.
        self::notifyCityOnlineUsers(
            $cityChannelId,
            $arriverUserId,
            'city_join',
            '👀 Someone arrived in ' . ($cityName ?? 'your city'),
            $arriverNickname . ' just landed',
            ['channelId' => $cityChannelId, 'arriverName' => $arriverNickname, 'cityName' => $cityName ?? 'your city'],
        );
    }

    /**
     * Atomic "claim the arrival slot" for (arriver, city). Returns true exactly once
     * per cooldown window - concurrent join requests race here, only one wins.
     * Backed by the DB (not APCu) so the cooldown survives across PHP-FPM workers
     * and APCu being disabled; this is the server-side source of truth.
     */
    private static function tryMarkArrival(string $arriverKey, string $channelId, int $cooldownSeconds): bool
    {
        $stmt = Database::pdo()->prepare("
            INSERT INTO arrival_cooldown (arriver_key, channel_id, last_notified_at)
            VALUES (?, ?, now())
            ON CONFLICT (arriver_key, channel_id) DO UPDATE SET last_notified_at = now()
                WHERE arrival_cooldown.last_notified_at < now() - (? || ' seconds')::interval
            RETURNING 1
        ");
        $stmt->execute([$arriverKey, $channelId, (string) $cooldownSeconds]);
        return (bool) $stmt->fetchColumn();
    }

    /**
     * Atomic per-(viewer, target) cooldown for "viewed your profile" notifications.
     * Returns true at most once per $cooldownSeconds (default 10 min). Reuses the
     * race-free arrival_cooldown gate, so rapid/duplicate profile fetches can't
     * fan out a burst of bell rows + pushes - the prior SELECT-then-insert dedup
     * could be raced by deferred concurrent requests. Keys are namespaced
     * (pv:/u:) so they never collide with city-arrival keys.
     */
    public static function shouldNotifyProfileView(string $viewerId, string $targetId, int $cooldownSeconds = 600): bool
    {
        return self::tryMarkArrival('pv:' . $viewerId, 'u:' . $targetId, $cooldownSeconds);
    }

    /**
     * Fire-and-forget: push a message into a city room via the WS server so
     * clients already in the room render it live. Mirrors the API's
     * broadcastMessageToWs (routes/api.php), including the internal token -
     * $channelId MUST be the integer city id so the WS server keys the city room.
     */
    private static function broadcastMessageToWs(int|string $channelId, array $message): void
    {
        $wsUrl   = rtrim(getenv('WS_INTERNAL_URL') ?: 'http://localhost:8082', '/');
        $token   = getenv('WS_INTERNAL_TOKEN') ?: '';
        $payload = json_encode(['channelId' => $channelId, 'message' => $message]);

        $headers = "Content-Type: application/json\r\nContent-Length: " . strlen($payload) . "\r\n";
        if ($token !== '') {
            $headers .= "X-Internal-Token: {$token}\r\n";
        }

        $ctx = stream_context_create(['http' => [
            'method'        => 'POST',
            'header'        => $headers,
            'content'       => $payload,
            'timeout'       => 2,
            'ignore_errors' => true,
        ]]);

        if (@file_get_contents($wsUrl . '/broadcast/message', false, $ctx) === false) {
            $err = error_get_last();
            error_log('[arrival] ws broadcast failed: ' . ($err['message'] ?? 'unknown'));
        }
    }

    public static function notifyCityOnlineUsers(
        string  $cityChannelId,
        ?string $excludeUserId,
        string  $type,
        string  $title,
        ?string $body,
        array   $data,
        array   $excludeUserIds = []
    ): void {
        // city_join targets city *members* (current_city_id), not just whoever is
        // online this minute - a user wants "someone arrived in my city" for the
        // city they belong to whether or not the app is open right now.
        //
        // challenge_international_target follows the same model: it's the
        // cross-city heads-up fired to everyone whose current_city_id matches
        // the target city when a creator in city A targets city B.
        $useCurrentCity = $type === 'new_event'
                       || $type === 'new_challenge'
                       || $type === 'city_join'
                       || $type === 'challenge_international_target'
                       // @here: tag every active member of the city, not just
                       // whoever is online this minute.
                       || $type === 'city_here';

        $cap = self::CITY_PUSH_FANOUT_CAP;
        if ($type === 'city_here') {
            // @here = EVERYONE in the city: active members (current_city_id) UNION
            // whoever is present in the channel right now. The union matters -
            // a traveller chatting here whose current_city_id points to their
            // home city is "here" too and must get tagged, but wouldn't match
            // the members-only query.
            // No location-confirmation TTL here (unlike the arrival fan-out):
            // @here is a deliberate, rate-limited, capped tag, so reach EVERY
            // member of the city - even one whose location wasn't re-confirmed
            // recently - plus whoever is present right now. Ordered by recency
            // so the cap keeps the most-active members.
            $stmt = Database::pdo()->prepare("
                SELECT m.id FROM (
                    SELECT u.id, u.current_city_last_confirmed_at AS srt
                    FROM users u
                    WHERE u.current_city_id = :cc
                      AND u.deleted_at IS NULL
                    UNION
                    SELECT u.id, now() AS srt
                    FROM presence p
                    JOIN users u ON (u.id = p.user_id OR u.guest_id = p.guest_id)
                    WHERE p.channel_id = :cc
                      AND p.last_seen_at > now() - interval '3 minutes'
                      AND u.deleted_at IS NULL
                ) m
                WHERE (CAST(:ex AS text) IS NULL OR m.id::text != CAST(:ex AS text))
                GROUP BY m.id
                ORDER BY MAX(m.srt) DESC NULLS LAST
                LIMIT {$cap}
            ");
            $stmt->execute([':cc' => $cityChannelId, ':ex' => $excludeUserId]);
            $userIds = $stmt->fetchAll(\PDO::FETCH_COLUMN);
            if (!empty($excludeUserIds)) $userIds = array_values(array_diff($userIds, $excludeUserIds));
            error_log('[@here] city=' . $cityChannelId . ' sender=' . ($excludeUserId ?? 'null') . ' recipients=' . count($userIds));
            if (empty($userIds)) return;
            $enabled = self::batchIsEnabled($userIds, $type);
            $locales = self::batchLocale($userIds);
            foreach ($userIds as $uid) {
                if (!($enabled[$uid] ?? true)) continue;
                $rlKey = "notif:{$type}:{$uid}:{$cityChannelId}";
                if (!RateLimiter::allow($rlKey, 1, 600)) continue;
                self::createUnchecked($uid, $type, $title, $body, $data, $locales[$uid] ?? 'en');
            }
            return;
        }
        if ($useCurrentCity) {
            // current_city_last_confirmed_at TTL: 30 days. Users who haven't
            // had a positive location signal in that window are excluded so
            // we don't push to dormant accounts whose city is just remembered
            // from an old visit.
            $stmt = Database::pdo()->prepare("
                SELECT u.id FROM users u
                WHERE u.current_city_id = ?
                  AND u.current_city_last_confirmed_at > now() - interval '30 days'
                  AND u.deleted_at IS NULL
                  AND (CAST(? AS text) IS NULL OR u.id::text != CAST(? AS text))
                ORDER BY u.current_city_last_confirmed_at DESC NULLS LAST
                LIMIT {$cap}
            ");
        } else {
            // Resolve the registered user behind each live presence row. Two links,
            // because neither alone is reliable:
            //   • p.user_id   - stamped on the row at join/bootstrap (see
            //                   PresenceRepository::stampUser). The dependable link
            //                   for multi-device accounts.
            //   • p.guest_id  - fallback for rows not yet stamped. NOT reliable on
            //                   its own: users.guest_id holds a single (often stale)
            //                   value while a user's presence guest_id drifts across
            //                   devices, so a guest_id-only match misses them.
            // Matching presence.user_id directly used to return zero recipients
            // (the column was never written), silently disabling city_join /
            // channel_message pushes entirely.
            $stmt = Database::pdo()->prepare("
                SELECT DISTINCT u.id
                FROM presence p
                JOIN users u ON (u.id = p.user_id OR u.guest_id = p.guest_id)
                WHERE p.channel_id = ?
                  AND p.last_seen_at > now() - interval '3 minutes'
                  AND u.deleted_at IS NULL
                  AND (CAST(? AS text) IS NULL OR u.id::text != CAST(? AS text))
            ");
        }
        $stmt->execute([$cityChannelId, $excludeUserId, $excludeUserId]);
        $userIds = $stmt->fetchAll(\PDO::FETCH_COLUMN);
        if (!empty($excludeUserIds)) $userIds = array_values(array_diff($userIds, $excludeUserIds));
        if (empty($userIds)) return;

        // Batch-load preferences + locales - 1 query each regardless of recipient count
        $enabled = self::batchIsEnabled($userIds, $type);
        $locales = self::batchLocale($userIds);
        foreach ($userIds as $uid) {
            if (!($enabled[$uid] ?? true)) continue;

            // Rate limit per (recipient, city, type) - this is the DIFFERENT-arriver
            // floor. city_join arrivals fire near-real-time (1 per 5s) so distinct
            // people arriving seconds apart each surface a notification + push; the
            // heavier new_event stays at 10 min so event creators can't spam.
            // challenge_international_target rides the same 10-min window - a
            // creator with a fresh challenge shouldn't be able to ping the same
            // user twice in quick succession even by editing + re-creating.
            // MobilePushService applies the same per-type window to native push.
            if ($useCurrentCity) {
                $window = $type === 'city_join' ? 5 : 600;
                $rlKey  = "notif:{$type}:{$uid}:{$cityChannelId}";
                if (!RateLimiter::allow($rlKey, 1, $window)) continue;
            }

            self::createUnchecked($uid, $type, $title, $body, $data, $locales[$uid] ?? 'en');
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
        array   $data,
        array   $excludeUserIds = []
    ): void {
        $stmt = Database::pdo()->prepare("
            SELECT user_id FROM topic_subscriptions
            WHERE topic_id = ?
              AND (CAST(? AS text) IS NULL OR user_id::text != CAST(? AS text))
        ");
        $stmt->execute([$topicId, $excludeUserId, $excludeUserId]);
        $userIds = $stmt->fetchAll(\PDO::FETCH_COLUMN);
        if (!empty($excludeUserIds)) $userIds = array_values(array_diff($userIds, $excludeUserIds));
        if (empty($userIds)) return;

        // Batch-load preferences + locales - 1 query each regardless of subscriber count
        $enabled = self::batchIsEnabled($userIds, $type);
        $locales = self::batchLocale($userIds);
        foreach ($userIds as $uid) {
            if ($enabled[$uid] ?? true) {
                self::createUnchecked($uid, $type, $title, $body, $data, $locales[$uid] ?? 'en');
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
