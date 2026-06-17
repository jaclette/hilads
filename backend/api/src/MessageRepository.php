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
            // `id` is exposed so reverse-scroll pagination can use a system row as
            // the before_id cursor. Cities accumulate long runs of join lines, and
            // without an id the cursor stalls on them and the client refetches the
            // same page forever. Clients still key system rows off type/event for
            // rendering + dedup, so surfacing the id is display-inert.
            // Weather system messages carry display text in `content`.
            if ($row['event'] === 'weather') {
                return [
                    'id'        => $row['id'],
                    'type'      => 'system',
                    'event'     => 'weather',
                    'content'   => $row['content'] ?? '',
                    'createdAt' => $createdAt,
                ];
            }
            return [
                'id'        => $row['id'],
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

        $deletedAt = !empty($row['deleted_at']) ? (int) $row['deleted_at'] : null;
        $editedAt  = !empty($row['edited_at'])  ? (int) $row['edited_at']  : null;

        if ($row['type'] === 'image') {
            $img = [
                'id'        => $row['id'],
                'channelId' => $channelId,
                'guestId'   => $row['guest_id'],
                'userId'    => $row['user_id'] ?? null,
                'nickname'  => $row['nickname'],
                'type'      => 'image',
                'imageUrl'  => $deletedAt !== null ? null : $row['image_url'],
                'content'   => '',
                'createdAt' => $createdAt,
            ];
            if ($deletedAt !== null) $img['deletedAt'] = $deletedAt;
            if ($editedAt  !== null) $img['editedAt']  = $editedAt;
            return $img;
        }

        $msg = [
            'id'        => $row['id'],
            'channelId' => $channelId,
            'guestId'   => $row['guest_id'],
            'userId'    => $row['user_id'] ?? null,
            'nickname'  => $row['nickname'],
            // Deleted messages keep their slot (tombstone rendered client-side)
            // but the content is already cleared in the DB at delete time.
            'content'   => $deletedAt !== null ? '' : $row['content'],
            'createdAt' => $createdAt,
        ];
        if ($deletedAt !== null) $msg['deletedAt'] = $deletedAt;
        if ($editedAt  !== null) $msg['editedAt']  = $editedAt;

        // Preserve non-text types (e.g. 'join_request') so clients render the
        // styled card instead of dumping the JSON content as a text bubble.
        // Plain text stays type-less (clients treat absent type as 'text').
        if (($row['type'] ?? 'text') !== 'text') {
            $msg['type'] = $row['type'];
        }

        // @mentions: raw [{userId,offset,length}] here; getByChannel resolves
        // them to current usernames before returning. Omitted when empty.
        $rawMentions = $row['mentions'] ?? null;
        if (!empty($rawMentions)) {
            $decoded = json_decode((string) $rawMentions, true);
            if (is_array($decoded) && !empty($decoded)) $msg['mentions'] = $decoded;
        }

        // reply_to_id may be absent from the row if the migration has not run yet,
        // or if the parent was deleted (ON DELETE SET NULL → null).
        // Use ?? null throughout so a missing key never causes an undefined-index notice
        // or a 500 - replies degrade silently rather than breaking message delivery.
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
    public static function getByChannel(int|string $channelId, ?string $beforeId = null, int $limit = self::DEFAULT_LIMIT, bool $excludeJoins = false): array
    {
        $dbChan = self::dbKey($channelId);
        $limit  = max(1, min(self::MAX_LIMIT, $limit));
        $fetch  = $limit + 1; // fetch one extra to detect hasMore
        // City channels accumulate long runs of "X just landed" join rows that
        // otherwise fill the latest-N window and bury real chat. City reads pass
        // excludeJoins=true and fetch a small capped set of recent joins
        // separately (getRecentJoins) for the arrivals bar. No-op for
        // event/topic channels (they have no join rows).
        $joinFilter = $excludeJoins ? " AND NOT (type = 'system' AND event = 'join')" : '';

        // Fetch messages with a pure index scan - no JOIN inside the LIMIT subquery.
        // The LEFT JOIN to users for retroactive userId resolution is done as a separate
        // batch query below, applied only to the small set of rows that actually need it.
        // This guarantees the planner uses idx_messages_channel (channel_id, created_at DESC)
        // as a straight index scan + LIMIT, with no risk of a hash-join strategy that would
        // scan the entire channel before applying the limit.
        //
        // IMPORTANT: retroactive resolution is intentionally skipped for system messages
        // (type = 'system'). A ghost join must remain a ghost join - see original comment.

        if ($beforeId !== null) {
            // Cursor-based: fetch messages strictly older than the given message's created_at.
            $stmt = Database::pdo()->prepare("
                SELECT id, channel_id, type, event,
                       guest_id, user_id, nickname, content, image_url, created_at, mentions,
                       reply_to_id, reply_to_nickname, reply_to_content, reply_to_type,
                       edited_at, deleted_at
                FROM (
                    SELECT
                        id, channel_id, type, event,
                        guest_id, user_id, nickname, content, image_url, mentions,
                        reply_to_id, reply_to_nickname, reply_to_content, reply_to_type,
                        EXTRACT(EPOCH FROM created_at)::INTEGER AS created_at,
                        EXTRACT(EPOCH FROM edited_at)::INTEGER  AS edited_at,
                        EXTRACT(EPOCH FROM deleted_at)::INTEGER AS deleted_at
                    FROM messages
                    WHERE channel_id = ?$joinFilter
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
                       guest_id, user_id, nickname, content, image_url, created_at, mentions,
                       reply_to_id, reply_to_nickname, reply_to_content, reply_to_type,
                       edited_at, deleted_at
                FROM (
                    SELECT
                        id, channel_id, type, event,
                        guest_id, user_id, nickname, content, image_url, mentions,
                        reply_to_id, reply_to_nickname, reply_to_content, reply_to_type,
                        EXTRACT(EPOCH FROM created_at)::INTEGER AS created_at,
                        EXTRACT(EPOCH FROM edited_at)::INTEGER  AS edited_at,
                        EXTRACT(EPOCH FROM deleted_at)::INTEGER AS deleted_at
                    FROM messages
                    WHERE channel_id = ?$joinFilter
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

        // Retroactive userId resolution - only for text/image messages where user_id was
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

        $messages = array_map([self::class, 'format'], $rows);
        MentionService::resolveForMessages($messages); // raw mentions → current @usernames
        return [
            'messages' => $messages,
            'hasMore'  => $hasMore,
        ];
    }

    /**
     * Latest N "X just landed" join rows for a city, formatted like getByChannel
     * messages. Used to keep the arrivals bar populated when the main chat read
     * excludes joins (so arrivals don't bury real chat history).
     */
    public static function getRecentJoins(int|string $channelId, int $cap = 15): array
    {
        $dbChan = self::dbKey($channelId);
        $cap    = max(1, min(50, $cap));
        $stmt = Database::pdo()->prepare("
            SELECT id, channel_id, type, event,
                   guest_id, user_id, nickname, content, image_url, mentions,
                   reply_to_id, reply_to_nickname, reply_to_content, reply_to_type,
                   EXTRACT(EPOCH FROM created_at)::INTEGER AS created_at,
                   EXTRACT(EPOCH FROM edited_at)::INTEGER  AS edited_at,
                   EXTRACT(EPOCH FROM deleted_at)::INTEGER AS deleted_at
            FROM messages
            WHERE channel_id = ? AND type = 'system' AND event = 'join'
            ORDER BY created_at DESC
            LIMIT ?
        ");
        $stmt->execute([$dbChan, $cap]);
        return array_map([self::class, 'format'], $stmt->fetchAll());
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
        // Cached: this aggregates the WHOLE messages table (full GROUP BY scan)
        // on every /channels call - heavy DB load that grows with message volume.
        // It only feeds the cities-list counts + "active" ranking, where a few
        // minutes of staleness is fine. Live online-counts come from a separate
        // presence query (getCountBatch), which stays uncached.
        return Cache::remember('city_msg_stats_v1', 300, static function (): array {
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
        }) ?? [];
    }

    // ── Writes ────────────────────────────────────────────────────────────────

    /**
     * Inserts a weather system message into a city channel feed.
     * type='system', event='weather', content = display text.
     * No guest_id / nickname - weather has no author.
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

    /**
     * Generic system message - used for in-thread audit lines like
     * "✅ X accepted your take-on" / "✕ X declined your take-on" on the
     * challenge take-on flow. `event` is a label that lets clients style or
     * filter the bubble; content is the user-visible text. channel_id can be
     * either an int (city) or a 16-char hex (thread channels).
     */
    public static function addSystemMessage(int|string $channelId, string $content, string $event = 'system', ?string $challengeAcceptanceId = null): array
    {
        $id = bin2hex(random_bytes(8));
        Database::pdo()->prepare("
            INSERT INTO messages (id, channel_id, type, event, content, nickname, challenge_acceptance_id)
            VALUES (?, ?, 'system', ?, ?, '', ?)
        ")->execute([$id, self::dbKey($channelId), $event, $content, $challengeAcceptanceId]);

        return [
            'id'        => $id,
            'type'      => 'system',
            'event'     => $event,
            'content'   => $content,
            'createdAt' => time(),
        ];
    }

    /**
     * Read messages for a CHALLENGE channel, scoped to a single acceptance.
     *
     * - When $acceptanceId is non-null (a run is currently in progress), the
     *   result includes only messages stamped with that id. Previous runs'
     *   messages stay in the DB but are invisible to the current acceptor,
     *   giving them a clean conversation lane.
     * - When $acceptanceId is null (no active acceptance - between runs or
     *   pre-first-acceptance), only NULL-stamped messages surface. These
     *   are pre-acceptance system events + cross-run chatter; once a new
     *   run starts they vanish from the view of the new acceptor.
     *
     * Mirrors getByChannel's cursor + LIMIT + hasMore semantics so the
     * frontend pagination layer doesn't need a separate code path.
     */
    public static function getByChallengeChannel(
        int|string $channelId,
        ?string $acceptanceId,
        ?string $beforeId = null,
        int $limit = self::DEFAULT_LIMIT
    ): array {
        $dbChan = self::dbKey($channelId);
        $limit  = max(1, min(self::MAX_LIMIT, $limit));
        $fetch  = $limit + 1;

        // Match the same idx_messages_channel index strategy used by
        // getByChannel: index scan on (channel_id, created_at DESC), then
        // tighten on challenge_acceptance_id (or its IS NULL form). The
        // partial index from migrate.php speeds the non-null branch.
        $acceptanceClause = $acceptanceId === null
            ? 'AND challenge_acceptance_id IS NULL'
            : 'AND challenge_acceptance_id = :acc';

        if ($beforeId !== null) {
            $sql = "
                SELECT id, channel_id, type, event,
                       guest_id, user_id, nickname, content, image_url, created_at, mentions,
                       reply_to_id, reply_to_nickname, reply_to_content, reply_to_type,
                       edited_at, deleted_at
                FROM (
                    SELECT
                        id, channel_id, type, event,
                        guest_id, user_id, nickname, content, image_url, mentions,
                        reply_to_id, reply_to_nickname, reply_to_content, reply_to_type,
                        EXTRACT(EPOCH FROM created_at)::INTEGER AS created_at,
                        EXTRACT(EPOCH FROM edited_at)::INTEGER  AS edited_at,
                        EXTRACT(EPOCH FROM deleted_at)::INTEGER AS deleted_at
                    FROM messages
                    WHERE channel_id = :chan
                      AND created_at < (SELECT created_at FROM messages WHERE id = :before)
                      {$acceptanceClause}
                    ORDER BY created_at DESC
                    LIMIT :lim
                ) sub
                ORDER BY created_at ASC
            ";
            $stmt = Database::pdo()->prepare($sql);
            $stmt->bindValue(':chan',   $dbChan);
            $stmt->bindValue(':before', $beforeId);
            $stmt->bindValue(':lim',    $fetch, \PDO::PARAM_INT);
            if ($acceptanceId !== null) $stmt->bindValue(':acc', $acceptanceId);
            $stmt->execute();
        } else {
            $sql = "
                SELECT id, channel_id, type, event,
                       guest_id, user_id, nickname, content, image_url, created_at, mentions,
                       reply_to_id, reply_to_nickname, reply_to_content, reply_to_type,
                       edited_at, deleted_at
                FROM (
                    SELECT
                        id, channel_id, type, event,
                        guest_id, user_id, nickname, content, image_url, mentions,
                        reply_to_id, reply_to_nickname, reply_to_content, reply_to_type,
                        EXTRACT(EPOCH FROM created_at)::INTEGER AS created_at,
                        EXTRACT(EPOCH FROM edited_at)::INTEGER  AS edited_at,
                        EXTRACT(EPOCH FROM deleted_at)::INTEGER AS deleted_at
                    FROM messages
                    WHERE channel_id = :chan
                      {$acceptanceClause}
                    ORDER BY created_at DESC
                    LIMIT :lim
                ) sub
                ORDER BY created_at ASC
            ";
            $stmt = Database::pdo()->prepare($sql);
            $stmt->bindValue(':chan', $dbChan);
            $stmt->bindValue(':lim',  $fetch, \PDO::PARAM_INT);
            if ($acceptanceId !== null) $stmt->bindValue(':acc', $acceptanceId);
            $stmt->execute();
        }

        $rows    = $stmt->fetchAll();
        $hasMore = count($rows) > $limit;
        if ($hasMore) array_shift($rows);

        // Same retroactive userId resolution as getByChannel - copy/pasted
        // rather than abstracted out so this method stays a drop-in
        // replacement for the route layer.
        $needsResolution = array_filter(
            $rows,
            static fn($r) => ($r['type'] === 'text' || $r['type'] === 'image')
                          && empty($r['user_id'])
                          && !empty($r['guest_id'])
        );
        if (!empty($needsResolution)) {
            $guestIds    = array_values(array_unique(array_column($needsResolution, 'guest_id')));
            $in          = implode(',', array_fill(0, count($guestIds), '?'));
            $ustmt       = Database::pdo()->prepare("SELECT id, guest_id FROM users WHERE guest_id IN ($in)");
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

    public static function addJoinEvent(int $channelId, string $guestId, string $nickname, ?string $userId = null, ?string $country = null, ?string $ip = null): array
    {
        $id = bin2hex(random_bytes(8));
        // Stamp the arriver's IP too (alongside country) so a guest ban can
        // also block the IP a guest arrived from, even if they never posted.
        $ip = ($ip !== null && $ip !== '' && $ip !== 'unknown') ? $ip : null;
        Database::pdo()->prepare("
            INSERT INTO messages (id, channel_id, type, event, guest_id, user_id, nickname, country, ip_address)
            VALUES (?, ?, 'system', 'join', ?, ?, ?, ?, ?)
        ")->execute([$id, self::dbKey($channelId), $guestId, $userId, $nickname, $country, $ip]);

        // Return the id so the live WS broadcast carries it too - matches the
        // fetched (format()) shape so reverse-scroll pagination + dedup line up.
        return [
            'id'        => $id,
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
     * No DB migration needed - reuses existing event column (TEXT, nullable).
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
        string $replyToType = 'text',
        array $mentions = [],
        ?string $challengeAcceptanceId = null
    ): array {
        $id = bin2hex(random_bytes(8));

        Database::pdo()->prepare("
            INSERT INTO messages
                (id, channel_id, type, guest_id, user_id, nickname, content, mentions,
                 reply_to_id, reply_to_nickname, reply_to_content, reply_to_type,
                 challenge_acceptance_id)
            VALUES (?, ?, 'text', ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?)
        ")->execute([
            $id, self::dbKey($channelId), $guestId, $userId, $nickname, $content,
            json_encode(array_values($mentions)),
            $replyToId, $replyToNickname, $replyToContent, $replyToType,
            $challengeAcceptanceId,
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

        // Resolve mentions to current @usernames for the HTTP echo + WS broadcast.
        if (!empty($mentions)) {
            $result['mentions'] = MentionService::resolveOne($mentions);
        }

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
     * @param array   $messages         Reference - modified in place.
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
        //   guest viewer       → match on guest_id (only when user_id IS NULL - prevents
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

    public static function addImage(int|string $channelId, string $guestId, string $nickname, string $imageUrl, ?string $userId = null, ?string $challengeAcceptanceId = null): array
    {
        $id = bin2hex(random_bytes(8));

        Database::pdo()->prepare("
            INSERT INTO messages (id, channel_id, type, guest_id, user_id, nickname, image_url, content, challenge_acceptance_id)
            VALUES (?, ?, 'image', ?, ?, ?, ?, '', ?)
        ")->execute([$id, self::dbKey($channelId), $guestId, $userId, $nickname, $imageUrl, $challengeAcceptanceId]);

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

    // ── Edit / soft-delete ────────────────────────────────────────────────────

    /**
     * Locate a message by id and confirm the caller owns it. Ownership matches
     * by registered user_id when present, otherwise by guest_id. Returns the
     * row (with channel_id + edited_at + deleted_at) or null if not found / not
     * owned. Used to gate edit + delete.
     */
    public static function findOwned(string $messageId, ?string $userId, ?string $guestId): ?array
    {
        $stmt = Database::pdo()->prepare("
            SELECT id, channel_id, type, user_id, guest_id,
                   EXTRACT(EPOCH FROM created_at)::INTEGER AS created_at,
                   EXTRACT(EPOCH FROM deleted_at)::INTEGER AS deleted_at
              FROM messages
             WHERE id = ?
             LIMIT 1
        ");
        $stmt->execute([$messageId]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$row) return null;

        $ownsAsUser  = $userId  !== null && $userId  !== '' && ($row['user_id']  ?? null) === $userId;
        $ownsAsGuest = $guestId !== null && $guestId !== '' && ($row['guest_id'] ?? null) === $guestId;
        if (!$ownsAsUser && !$ownsAsGuest) return null;

        return $row;
    }

    /** Update message content + stamp edited_at = now(). Caller must already
     *  have verified ownership via findOwned(). Returns the new editedAt int. */
    public static function edit(string $messageId, string $newContent): int
    {
        Database::pdo()->prepare("
            UPDATE messages
               SET content    = ?,
                   edited_at  = now()
             WHERE id = ?
        ")->execute([$newContent, $messageId]);

        $stmt = Database::pdo()->prepare(
            "SELECT EXTRACT(EPOCH FROM edited_at)::INTEGER AS edited_at FROM messages WHERE id = ?"
        );
        $stmt->execute([$messageId]);
        return (int) $stmt->fetchColumn();
    }

    /** Soft-delete: clear content + image_url, stamp deleted_at = now(). The
     *  row stays so the client can render a tombstone in the message slot.
     *  Returns the new deletedAt int. */
    public static function softDelete(string $messageId): int
    {
        Database::pdo()->prepare("
            UPDATE messages
               SET content    = '',
                   image_url  = NULL,
                   deleted_at = now()
             WHERE id = ?
        ")->execute([$messageId]);

        $stmt = Database::pdo()->prepare(
            "SELECT EXTRACT(EPOCH FROM deleted_at)::INTEGER AS deleted_at FROM messages WHERE id = ?"
        );
        $stmt->execute([$messageId]);
        return (int) $stmt->fetchColumn();
    }
}
