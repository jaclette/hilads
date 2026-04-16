<?php

declare(strict_types=1);

class MessageRepository
{
    private const DEFAULT_LIMIT = 50;
    private const MAX_LIMIT     = 100;

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

        $msg = [
            'id'        => $row['id'],
            'channelId' => $channelId,
            'guestId'   => $row['guest_id'],
            'userId'    => $row['user_id'] ?? null,
            'nickname'  => $row['nickname'],
            'content'   => $row['content'],
            'createdAt' => $createdAt,
        ];

        // reply_to_id may be absent from the row if the migration has not run yet,
        // or if the parent was deleted (ON DELETE SET NULL → null).
        // Use ?? null throughout so a missing key never causes an undefined-index notice
        // or a 500 — replies degrade silently rather than breaking message delivery.
        $replyId = $row['reply_to_id'] ?? null;
        if (!empty($replyId)) {
            $msg['replyTo'] = [
                'id'       => $replyId,
                'nickname' => $row['reply_to_nickname'] ?? '',
                'content'  => $row['reply_to_content']  ?? '',
                'type'     => $row['reply_to_type']     ?? 'text',
            ];
        }

        return $msg;
    }

    // ── Reads ─────────────────────────────────────────────────────────────────

    /**
     * Returns paginated messages for a channel, oldest-first.
     *
     * @param beforeId  Cursor: fetch messages older than this message ID.
     *                  null = fetch the most recent $limit messages.
     * @param limit     Page size (1-100, default 50).
     * @return array{ messages: array, hasMore: bool }
     */
    public static function getByChannel(int|string $channelId, ?string $beforeId = null, int $limit = self::DEFAULT_LIMIT): array
    {
        $dbChan = self::dbKey($channelId);
        $limit  = max(1, min(self::MAX_LIMIT, $limit));
        $fetch  = $limit + 1; // fetch one extra to detect hasMore

        // Fetch messages with a pure index scan — no JOIN inside the LIMIT subquery.
        // The LEFT JOIN to users for retroactive userId resolution is done as a separate
        // batch query below, applied only to the small set of rows that actually need it.
        // This guarantees the planner uses idx_messages_channel (channel_id, created_at DESC)
        // as a straight index scan + LIMIT, with no risk of a hash-join strategy that would
        // scan the entire channel before applying the limit.
        //
        // IMPORTANT: retroactive resolution is intentionally skipped for system messages
        // (type = 'system'). A ghost join must remain a ghost join — see original comment.

        if ($beforeId !== null) {
            // Cursor-based: fetch messages strictly older than the given message's created_at.
            $stmt = Database::pdo()->prepare("
                SELECT id, channel_id, type, event,
                       guest_id, user_id, nickname, content, image_url, created_at,
                       reply_to_id, reply_to_nickname, reply_to_content, reply_to_type
                FROM (
                    SELECT
                        id, channel_id, type, event,
                        guest_id, user_id, nickname, content, image_url,
                        reply_to_id, reply_to_nickname, reply_to_content, reply_to_type,
                        EXTRACT(EPOCH FROM created_at)::INTEGER AS created_at
                    FROM messages
                    WHERE channel_id = ?
                      AND created_at < (SELECT created_at FROM messages WHERE id = ?)
                    ORDER BY created_at DESC
                    LIMIT ?
                ) sub
                ORDER BY created_at ASC
            ");
            $stmt->execute([$dbChan, $beforeId, $fetch]);
        } else {
            $stmt = Database::pdo()->prepare("
                SELECT id, channel_id, type, event,
                       guest_id, user_id, nickname, content, image_url, created_at,
                       reply_to_id, reply_to_nickname, reply_to_content, reply_to_type
                FROM (
                    SELECT
                        id, channel_id, type, event,
                        guest_id, user_id, nickname, content, image_url,
                        reply_to_id, reply_to_nickname, reply_to_content, reply_to_type,
                        EXTRACT(EPOCH FROM created_at)::INTEGER AS created_at
                    FROM messages
                    WHERE channel_id = ?
                    ORDER BY created_at DESC
                    LIMIT ?
                ) sub
                ORDER BY created_at ASC
            ");
            $stmt->execute([$dbChan, $fetch]);
        }

        $rows    = $stmt->fetchAll();
        $hasMore = count($rows) > $limit;
        if ($hasMore) {
            array_shift($rows); // remove the oldest probe row (index 0 after ASC sort)
        }

        // Retroactive userId resolution — only for text/image messages where user_id was
        // never written (messages sent before account linking or before the api.php fix).
        // In practice this is rare on modern data; the batch query typically touches 0 rows.
        $needsResolution = array_filter(
            $rows,
            static fn($r) => ($r['type'] === 'text' || $r['type'] === 'image')
                          && empty($r['user_id'])
                          && !empty($r['guest_id'])
        );

        if (!empty($needsResolution)) {
            $guestIds    = array_values(array_unique(array_column($needsResolution, 'guest_id')));
            $in          = implode(',', array_fill(0, count($guestIds), '?'));
            $ustmt       = Database::pdo()->prepare(
                "SELECT id, guest_id FROM users WHERE guest_id IN ($in)"
            );
            $ustmt->execute($guestIds);
            $guestToUser = array_column($ustmt->fetchAll(), 'id', 'guest_id');

            foreach ($rows as &$row) {
                if (
                    empty($row['user_id'])
                    && !empty($row['guest_id'])
                    && ($row['type'] === 'text' || $row['type'] === 'image')
                    && isset($guestToUser[$row['guest_id']])
                ) {
                    $row['user_id'] = $guestToUser[$row['guest_id']];
                }
            }
            unset($row);
        }

        return [
            'messages' => array_map([self::class, 'format'], $rows),
            'hasMore'  => $hasMore,
        ];
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
                    COUNT(*)                                                                         AS message_count,
                    COUNT(*) FILTER (WHERE m.created_at > NOW() - INTERVAL '24 hours')              AS recent_message_count,
                    EXTRACT(EPOCH FROM MAX(m.created_at))::INTEGER                                   AS last_activity_at
                FROM messages m
                JOIN channels c ON c.id = m.channel_id AND c.type = 'city'
                GROUP BY m.channel_id
            ")
            ->fetchAll(PDO::FETCH_ASSOC);

        $stats = [];
        foreach ($rows as $row) {
            $cityId         = (int) substr($row['channel_id'], 5);
            $stats[$cityId] = [
                'messageCount'       => (int) $row['message_count'],
                'recentMessageCount' => (int) $row['recent_message_count'],
                'lastActivityAt'     => $row['last_activity_at'] ? (int) $row['last_activity_at'] : null,
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

    public static function add(
        int|string $channelId,
        string $guestId,
        string $nickname,
        string $content,
        ?string $userId = null,
        ?string $replyToId = null,
        ?string $replyToNickname = null,
        ?string $replyToContent = null,
        string $replyToType = 'text'
    ): array {
        $id = bin2hex(random_bytes(8));

        Database::pdo()->prepare("
            INSERT INTO messages
                (id, channel_id, type, guest_id, user_id, nickname, content,
                 reply_to_id, reply_to_nickname, reply_to_content, reply_to_type)
            VALUES (?, ?, 'text', ?, ?, ?, ?, ?, ?, ?, ?)
        ")->execute([
            $id, self::dbKey($channelId), $guestId, $userId, $nickname, $content,
            $replyToId, $replyToNickname, $replyToContent, $replyToType,
        ]);

        $result = [
            'id'        => $id,
            'channelId' => $channelId,
            'guestId'   => $guestId,
            'userId'    => $userId,
            'nickname'  => $nickname,
            'content'   => $content,
            'createdAt' => time(),
        ];

        if ($replyToId !== null) {
            $result['replyTo'] = [
                'id'       => $replyToId,
                'nickname' => $replyToNickname ?? '',
                'content'  => $replyToContent  ?? '',
                'type'     => $replyToType,
            ];
        }

        return $result;
    }

    // ── Reactions ─────────────────────────────────────────────────────────────

    /**
     * Batch-loads reactions for a list of message IDs and injects them into
     * the messages array in-place.  One query for counts, one for self-detection.
     *
     * Each message gains: "reactions": [{"emoji":"❤️","count":2,"self":false}, …]
     * Sorted by first-reaction time so the order is stable.
     *
     * @param array   $messages         Reference — modified in place.
     * @param ?string $viewerGuestId    Current viewer's guestId (may be null).
     * @param ?string $viewerUserId     Current viewer's userId  (may be null).
     * @param string  $table            'message_reactions' or 'conversation_message_reactions'.
     */
    public static function attachReactions(
        array  &$messages,
        ?string $viewerGuestId,
        ?string $viewerUserId,
        string  $table = 'message_reactions'
    ): void {
        $ids = array_filter(array_column($messages, 'id'), fn($id) => !empty($id));
        if (empty($ids)) return;

        $placeholders = implode(',', array_fill(0, count($ids), '?'));

        // Aggregate counts per (message_id, emoji) and detect self-reaction in one pass.
        // BOOL_OR handles the three possible viewer states:
        //   registered viewer  → match on user_id
        //   guest viewer       → match on guest_id (only when user_id IS NULL — prevents
        //                        a registered user from double-counting via their old guestId)
        //   no viewer info     → always false
        $selfUserExpr  = ($viewerUserId  !== null) ? 'user_id = ?' : 'FALSE';
        $selfGuestExpr = ($viewerGuestId !== null) ? '(guest_id = ? AND user_id IS NULL)' : 'FALSE';
        $selfExpr      = "BOOL_OR({$selfUserExpr} OR {$selfGuestExpr})";

        // Build execute params: IDs for IN clause, then viewer identity for BOOL_OR
        $execParams = array_values($ids);
        if ($viewerUserId  !== null) $execParams[] = $viewerUserId;
        if ($viewerGuestId !== null) $execParams[] = $viewerGuestId;

        $sql = "
            SELECT message_id,
                   emoji,
                   COUNT(*)   AS cnt,
                   {$selfExpr} AS self_reacted
              FROM {$table}
             WHERE message_id IN ({$placeholders})
             GROUP BY message_id, emoji
             ORDER BY MIN(created_at) ASC
        ";

        $stmt = Database::pdo()->prepare($sql);
        $stmt->execute($execParams);
        $rows = $stmt->fetchAll();

        // Build a map: message_id → [{emoji, count, self}]
        $map = [];
        foreach ($rows as $r) {
            $map[$r['message_id']][] = [
                'emoji' => $r['emoji'],
                'count' => (int) $r['cnt'],
                'self'  => (bool) $r['self_reacted'],
            ];
        }

        foreach ($messages as &$msg) {
            $msg['reactions'] = $map[$msg['id'] ?? ''] ?? [];
        }
        unset($msg);
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
