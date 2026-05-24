<?php

declare(strict_types=1);

class TopicRepository
{
    private const ALLOWED_CATEGORIES = ['general', 'tips', 'food', 'drinks', 'help', 'meetup'];
    private const DEFAULT_TTL_HOURS  = 24;

    // ── Shared SELECT (topic + message stats) ─────────────────────────────────

    private const SELECT = "
        SELECT
            c.id,
            ct.city_id,
            ct.created_by,
            ct.guest_id,
            ct.title,
            ct.description,
            ct.category,
            ct.venue_lat,
            ct.venue_lng,
            COUNT(m.id)                                        AS message_count,
            EXTRACT(EPOCH FROM MAX(m.created_at))::INTEGER     AS last_activity_at,
            EXTRACT(EPOCH FROM ct.expires_at)::INTEGER         AS expires_at,
            EXTRACT(EPOCH FROM c.created_at)::INTEGER          AS created_at
        FROM channels c
        JOIN channel_topics ct ON ct.channel_id = c.id
        LEFT JOIN messages m ON m.channel_id = c.id AND m.type IN ('text', 'image')
    ";

    private static function format(array $row): array
    {
        return [
            'id'               => $row['id'],
            'city_id'          => $row['city_id'],
            'created_by'       => $row['created_by'],
            'guest_id'         => $row['guest_id'],
            'title'            => $row['title'],
            'description'      => $row['description'],
            'category'         => $row['category'],
            'venue_lat'        => isset($row['venue_lat']) ? (float) $row['venue_lat'] : null,
            'venue_lng'        => isset($row['venue_lng']) ? (float) $row['venue_lng'] : null,
            'message_count'    => (int) ($row['message_count'] ?? 0),
            'last_activity_at' => isset($row['last_activity_at']) ? (int) $row['last_activity_at'] : null,
            'expires_at'       => (int) $row['expires_at'],
            'created_at'       => (int) $row['created_at'],
            // Populated by getByCity (batched); default so the field is always present.
            'participants_preview' => [],
            'participant_count'    => 0,
        ];
    }

    // ── Reads ─────────────────────────────────────────────────────────────────

    /**
     * Active topic count per city — used for the city list summary.
     * Returns an array keyed by integer city channel ID (e.g. 3), value = count.
     */
    public static function getCountsPerCity(): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT ct.city_id, COUNT(*) AS topic_count
            FROM channel_topics ct
            JOIN channels c ON c.id = ct.channel_id
            WHERE c.status     = 'active'
              AND ct.expires_at > now()
            GROUP BY ct.city_id
        ");
        $stmt->execute();
        $result = [];
        foreach ($stmt->fetchAll() as $row) {
            // city_id is stored as 'city_3' — extract the numeric ID to match EventRepository
            $numericId           = (int) str_replace('city_', '', $row['city_id']);
            $result[$numericId]  = (int) $row['topic_count'];
        }
        return $result;
    }

    /**
     * Active topics for a city, sorted by last activity DESC.
     * $cityId is the channel ID string, e.g. 'city_3'.
     *
     * Uses two targeted queries instead of one expensive LEFT JOIN + GROUP BY:
     *   1. Fetch active topic metadata (fast index scan on idx_channel_topics_city)
     *   2. Batch-fetch message stats for those topic IDs (uses idx_messages_channel_type_time)
     * PHP merges and sorts the results, then slices to 20.
     */
    public static function getByCity(string $cityId): array
    {
        $pdo = Database::pdo();

        // Query 1: active topic metadata — no message aggregation.
        // Uses idx_channel_topics_city (city_id, expires_at DESC).
        $stmt = $pdo->prepare("
            SELECT
                c.id,
                ct.city_id,
                ct.created_by,
                ct.guest_id,
                ct.title,
                ct.description,
                ct.category,
                ct.venue_lat,
                ct.venue_lng,
                EXTRACT(EPOCH FROM ct.expires_at)::INTEGER AS expires_at,
                EXTRACT(EPOCH FROM c.created_at)::INTEGER  AS created_at
            FROM channels c
            JOIN channel_topics ct ON ct.channel_id = c.id
            WHERE ct.city_id    = :city_id
              AND c.status      = 'active'
              AND ct.expires_at > now()
        ");
        $stmt->execute(['city_id' => $cityId]);
        $topics = $stmt->fetchAll();

        if (empty($topics)) return [];

        // Query 2: message stats for those topic channels in one batch.
        // Uses idx_messages_channel_type_time (channel_id, type, created_at DESC)
        // WHERE type IN ('text', 'image').
        $ids      = array_column($topics, 'id');
        $in       = implode(',', array_fill(0, count($ids), '?'));
        $stmt     = $pdo->prepare("
            SELECT
                channel_id,
                COUNT(*)                                       AS message_count,
                EXTRACT(EPOCH FROM MAX(created_at))::INTEGER   AS last_activity_at
            FROM messages
            WHERE channel_id IN ($in)
              AND type IN ('text', 'image')
            GROUP BY channel_id
        ");
        $stmt->execute($ids);
        $statsMap = [];
        foreach ($stmt->fetchAll() as $row) {
            $statsMap[$row['channel_id']] = $row;
        }

        // Merge, format, sort by most recent activity DESC, slice to 20.
        $result = [];
        foreach ($topics as $topic) {
            $stats    = $statsMap[$topic['id']] ?? null;
            $result[] = self::format([
                'id'               => $topic['id'],
                'city_id'          => $topic['city_id'],
                'created_by'       => $topic['created_by'],
                'guest_id'         => $topic['guest_id'],
                'title'            => $topic['title'],
                'description'      => $topic['description'],
                'category'         => $topic['category'],
                'venue_lat'        => $topic['venue_lat'] ?? null,
                'venue_lng'        => $topic['venue_lng'] ?? null,
                'message_count'    => $stats !== null ? $stats['message_count']    : 0,
                'last_activity_at' => $stats !== null ? $stats['last_activity_at'] : null,
                'expires_at'       => $topic['expires_at'],
                'created_at'       => $topic['created_at'],
            ]);
        }

        usort($result, static function (array $a, array $b): int {
            $aAct = $a['last_activity_at'] ?? $a['created_at'] ?? 0;
            $bAct = $b['last_activity_at'] ?? $b['created_at'] ?? 0;
            return $bAct <=> $aAct;
        });

        $result = array_slice($result, 0, 20);

        // Attach member avatars + count (batched) so hangout NOW cards show
        // participants like events. The creator is always a participant.
        $topicIds = array_column($result, 'id');
        $preview  = self::participantPreviewBatch($topicIds);
        $counts   = self::participantCountBatch($topicIds);
        foreach ($result as &$t) {
            $t['participants_preview'] = $preview[$t['id']] ?? [];
            $t['participant_count']    = $counts[$t['id']]  ?? 0;
        }
        unset($t);

        return $result;
    }

    /**
     * Past (expired) pulses for a city — the archive query. A pulse is "past"
     * once its 24h lifespan elapses (expires_at <= now()). Most-recent-first.
     * `beforeTs` is a recency cursor; `fromTs`/`toTs` bound a date window (the
     * caller has already clamped it to ≤14 days).
     */
    public static function getPastByCity(int $channelId, ?int $beforeTs, int $limit, ?int $fromTs = null, ?int $toTs = null): array
    {
        $pdo    = Database::pdo();
        $where  = "ct.city_id = ? AND ct.expires_at <= now()";
        $params = ['city_' . $channelId];
        if ($fromTs !== null && $toTs !== null) {
            $where   .= " AND ct.expires_at >= to_timestamp(?) AND ct.expires_at < to_timestamp(?)";
            $params[] = $fromTs;
            $params[] = $toTs;
        }
        // Recency cursor — combines with the window so windowed views paginate too.
        if ($beforeTs !== null) {
            $where   .= " AND ct.expires_at < to_timestamp(?)";
            $params[] = $beforeTs;
        }
        $limit = max(1, min(50, $limit));
        $stmt  = $pdo->prepare("
            SELECT c.id, ct.city_id, ct.created_by, ct.guest_id, ct.title, ct.description, ct.category,
                   EXTRACT(EPOCH FROM ct.expires_at)::INTEGER AS expires_at,
                   EXTRACT(EPOCH FROM c.created_at)::INTEGER  AS created_at
            FROM channels c
            JOIN channel_topics ct ON ct.channel_id = c.id
            WHERE $where
            ORDER BY ct.expires_at DESC
            LIMIT " . $limit . "
        ");
        $stmt->execute($params);
        $topics = $stmt->fetchAll();
        if (empty($topics)) return [];

        $ids  = array_column($topics, 'id');
        $in   = implode(',', array_fill(0, count($ids), '?'));
        $s2   = $pdo->prepare("
            SELECT channel_id, COUNT(*) AS message_count,
                   EXTRACT(EPOCH FROM MAX(created_at))::INTEGER AS last_activity_at
            FROM messages WHERE channel_id IN ($in) AND type IN ('text','image') GROUP BY channel_id
        ");
        $s2->execute($ids);
        $statsMap = [];
        foreach ($s2->fetchAll() as $r) $statsMap[$r['channel_id']] = $r;

        $out = [];
        foreach ($topics as $t) {
            $stats = $statsMap[$t['id']] ?? null;
            $out[] = self::format([
                'id'               => $t['id'],
                'city_id'          => $t['city_id'],
                'created_by'       => $t['created_by'],
                'guest_id'         => $t['guest_id'],
                'title'            => $t['title'],
                'description'      => $t['description'],
                'category'         => $t['category'],
                'message_count'    => $stats['message_count']    ?? 0,
                'last_activity_at' => $stats['last_activity_at'] ?? null,
                'expires_at'       => $t['expires_at'],
                'created_at'       => $t['created_at'],
            ]);
        }
        return $out;
    }

    /**
     * Single active topic by channel ID. Returns null if not found or expired.
     */
    public static function findById(string $topicId): ?array
    {
        $stmt = Database::pdo()->prepare(self::SELECT . "
            WHERE c.id        = :id
              AND c.status    = 'active'
              AND ct.expires_at > now()
            GROUP BY c.id, ct.city_id, ct.created_by, ct.guest_id,
                     ct.title, ct.description, ct.category, ct.venue_lat, ct.venue_lng, ct.expires_at
        ");
        $stmt->execute(['id' => $topicId]);
        $row = $stmt->fetch();
        return $row ? self::format($row) : null;
    }

    // ── Writes ────────────────────────────────────────────────────────────────

    /**
     * Create a new topic channel + metadata row.
     * Returns the newly created topic (via findById for consistent shape).
     */
    public static function create(
        string $cityId,
        string $guestId,
        string $title,
        ?string $description,
        string $category = 'general',
        ?string $userId = null,
        int $ttlHours = self::DEFAULT_TTL_HOURS,
        ?float $lat = null,
        ?float $lng = null
    ): array {
        $pdo       = Database::pdo();
        $id        = bin2hex(random_bytes(8));
        $expiresAt = time() + $ttlHours * 3600;

        $pdo->prepare("
            INSERT INTO channels (id, type, parent_id, name, status, created_at, updated_at)
            VALUES (:id, 'topic', :parent_id, :name, 'active', now(), now())
        ")->execute([
            'id'        => $id,
            'parent_id' => $cityId,
            'name'      => $title,
        ]);

        $pdo->prepare("
            INSERT INTO channel_topics
                (channel_id, city_id, created_by, guest_id, title, description, category, venue_lat, venue_lng, expires_at)
            VALUES
                (:channel_id, :city_id, :created_by, :guest_id, :title, :description, :category,
                 :venue_lat, :venue_lng, to_timestamp(:expires_at))
        ")->execute([
            'channel_id'  => $id,
            'city_id'     => $cityId,
            'created_by'  => $userId,
            'guest_id'    => $guestId,
            'title'       => $title,
            'description' => $description,
            'category'    => $category,
            'venue_lat'   => $lat,
            'venue_lng'   => $lng,
            'expires_at'  => $expiresAt,
        ]);

        // Auto-subscribe the registered creator so they get notified on replies.
        if ($userId !== null) {
            self::subscribe($id, $userId);
            // …and add them as the first participant (members-only hangouts).
            self::addParticipant($id, $userId);
        }

        return self::findById($id) ?? [
            'id'               => $id,
            'city_id'          => $cityId,
            'created_by'       => $userId,
            'guest_id'         => $guestId,
            'title'            => $title,
            'description'      => $description,
            'category'         => $category,
            'venue_lat'        => $lat,
            'venue_lng'        => $lng,
            'message_count'    => 0,
            'last_activity_at' => null,
            'expires_at'       => $expiresAt,
            'created_at'       => time(),
            'participants_preview' => [],
            'participant_count'    => $userId !== null ? 1 : 0,
        ];
    }

    // ── Hangout participants (members-only) ───────────────────────────────────

    public static function addParticipant(string $topicId, string $userId): void
    {
        Database::pdo()->prepare("
            INSERT INTO topic_participants (topic_id, user_id) VALUES (?, ?)
            ON CONFLICT (topic_id, user_id) DO NOTHING
        ")->execute([$topicId, $userId]);
    }

    public static function isParticipant(string $topicId, string $userId): bool
    {
        $stmt = Database::pdo()->prepare("SELECT 1 FROM topic_participants WHERE topic_id = ? AND user_id = ? LIMIT 1");
        $stmt->execute([$topicId, $userId]);
        return (bool) $stmt->fetchColumn();
    }

    /** Registered user_ids of a hangout's participants (for push fan-out). */
    public static function participantUserIds(string $topicId): array
    {
        $stmt = Database::pdo()->prepare("SELECT user_id FROM topic_participants WHERE topic_id = ?");
        $stmt->execute([$topicId]);
        return $stmt->fetchAll(\PDO::FETCH_COLUMN);
    }

    /** Up to $limit participant avatar previews (most-recent-joined first). */
    public static function participantPreview(string $topicId, int $limit = 5): array
    {
        $limit = max(1, min(20, $limit));
        $stmt  = Database::pdo()->prepare("
            SELECT u.id, u.display_name, u.profile_thumb_photo_url, u.profile_photo_url
            FROM topic_participants tp
            JOIN users u ON u.id = tp.user_id AND u.deleted_at IS NULL
            WHERE tp.topic_id = ?
            ORDER BY tp.joined_at DESC
            LIMIT " . $limit);
        $stmt->execute([$topicId]);
        return array_map(static fn(array $r): array => [
            'id'             => $r['id'],
            'displayName'    => $r['display_name'] ?? 'Member',
            'thumbAvatarUrl' => $r['profile_thumb_photo_url'] ?? $r['profile_photo_url'] ?? null,
        ], $stmt->fetchAll(\PDO::FETCH_ASSOC));
    }

    public static function participantCount(string $topicId): int
    {
        $stmt = Database::pdo()->prepare("SELECT COUNT(*) FROM topic_participants WHERE topic_id = ?");
        $stmt->execute([$topicId]);
        return (int) $stmt->fetchColumn();
    }

    /**
     * Batched participant previews for the NOW feed — one windowed query.
     * Returns [topicId => [ {id, displayName, thumbAvatarUrl}, … ] ] (≤$limit each,
     * most-recent-joined first).
     */
    public static function participantPreviewBatch(array $topicIds, int $limit = 5): array
    {
        if (empty($topicIds)) return [];
        $limit = max(1, min(20, $limit));
        $in    = implode(',', array_fill(0, count($topicIds), '?'));
        $stmt  = Database::pdo()->prepare("
            SELECT topic_id, id, display_name, thumb_url, full_url FROM (
                SELECT tp.topic_id, u.id, u.display_name,
                       u.profile_thumb_photo_url AS thumb_url,
                       u.profile_photo_url       AS full_url,
                       row_number() OVER (PARTITION BY tp.topic_id ORDER BY tp.joined_at DESC) AS rn
                FROM topic_participants tp
                JOIN users u ON u.id = tp.user_id AND u.deleted_at IS NULL
                WHERE tp.topic_id IN ($in)
            ) t WHERE rn <= " . $limit);
        $stmt->execute(array_values($topicIds));
        $map = [];
        foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $r) {
            $map[$r['topic_id']][] = [
                'id'             => $r['id'],
                'displayName'    => $r['display_name'] ?? 'Member',
                'thumbAvatarUrl' => $r['thumb_url'] ?? $r['full_url'] ?? null,
            ];
        }
        return $map;
    }

    /**
     * Full participant list for the members modal — canonical UserDTOs
     * (id, displayName, username, avatarUrl, accountType, badges, vibe…),
     * joined-order. Participants are always registered users (user_id).
     */
    public static function getParticipants(string $topicId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT tp.user_id,
                   EXTRACT(EPOCH FROM tp.joined_at)::int AS joined_at,
                   CASE WHEN u.deleted_at IS NULL THEN u.display_name      ELSE NULL END AS display_name,
                   CASE WHEN u.deleted_at IS NULL THEN u.profile_photo_url ELSE NULL END AS profile_photo_url,
                   CASE WHEN u.deleted_at IS NULL THEN u.vibe              ELSE NULL END AS vibe,
                   CASE WHEN u.deleted_at IS NULL THEN u.created_at        ELSE NULL END AS created_at
            FROM topic_participants tp
            LEFT JOIN users u ON u.id = tp.user_id
            WHERE tp.topic_id = ?
            ORDER BY tp.joined_at ASC
        ");
        $stmt->execute([$topicId]);
        return array_map(static function (array $r): array {
            $joinedAt = (int) $r['joined_at'];
            if ($r['display_name'] !== null) {
                return array_merge(UserResource::fromUser([
                    'id'                => $r['user_id'],
                    'display_name'      => $r['display_name'],
                    'profile_photo_url' => $r['profile_photo_url'],
                    'vibe'              => $r['vibe'],
                    'created_at'        => $r['created_at'],
                    'home_city'         => null,
                ]), ['joinedAt' => $joinedAt]);
            }
            // Deleted account — show discreetly, not tappable to a dead profile.
            return array_merge(UserResource::fromGuest($r['user_id'], 'Former member'), ['joinedAt' => $joinedAt]);
        }, $stmt->fetchAll(\PDO::FETCH_ASSOC));
    }

    /** Batched participant counts. Returns [topicId => count]. */
    public static function participantCountBatch(array $topicIds): array
    {
        if (empty($topicIds)) return [];
        $in   = implode(',', array_fill(0, count($topicIds), '?'));
        $stmt = Database::pdo()->prepare("
            SELECT topic_id, COUNT(*) AS c FROM topic_participants
            WHERE topic_id IN ($in) GROUP BY topic_id");
        $stmt->execute(array_values($topicIds));
        $map = [];
        foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $r) {
            $map[$r['topic_id']] = (int) $r['c'];
        }
        return $map;
    }

    // ── Hangout join requests ─────────────────────────────────────────────────

    public const REQUEST_COOLDOWN = 300; // 5 min before a rejected user may re-request

    /**
     * Create a pending join request. Returns ['id'=>…] on success, or
     * ['error'=>'duplicate'|'cooldown'|'already_participant'] on a no-op.
     * The partial unique index enforces one PENDING request per (topic,user).
     */
    public static function createJoinRequest(string $topicId, string $userId, string $requesterName): array
    {
        $pdo = Database::pdo();

        if (self::isParticipant($topicId, $userId)) {
            return ['error' => 'already_participant'];
        }

        // Re-request cooldown after a recent rejection (anti-spam).
        $cd = $pdo->prepare("
            SELECT 1 FROM topic_join_requests
            WHERE topic_id = ? AND requester_id = ? AND status = 'rejected'
              AND resolved_at > now() - (? || ' seconds')::interval
            LIMIT 1
        ");
        $cd->execute([$topicId, $userId, self::REQUEST_COOLDOWN]);
        if ($cd->fetchColumn()) return ['error' => 'cooldown'];

        $id   = bin2hex(random_bytes(8));
        $stmt = $pdo->prepare("
            INSERT INTO topic_join_requests (id, topic_id, requester_id, requester_name)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (topic_id, requester_id) WHERE status = 'pending' DO NOTHING
        ");
        $stmt->execute([$id, $topicId, $userId, $requesterName]);
        if ($stmt->rowCount() === 0) return ['error' => 'duplicate'];

        return ['id' => $id, 'requester_id' => $userId, 'requester_name' => $requesterName, 'status' => 'pending'];
    }

    /**
     * Resolve a pending request. First-write-wins: the UPDATE only matches a
     * PENDING row, so a second concurrent caller gets null (already resolved).
     * On accept the requester is added as a participant. $action ∈ {accept,reject}.
     */
    public static function resolveJoinRequest(string $requestId, string $topicId, string $action, string $resolverId, string $resolverName): ?array
    {
        $status = $action === 'accept' ? 'accepted' : 'rejected';
        $pdo    = Database::pdo();
        $stmt   = $pdo->prepare("
            UPDATE topic_join_requests
            SET status = ?, resolved_by = ?, resolved_by_name = ?, resolved_at = now()
            WHERE id = ? AND topic_id = ? AND status = 'pending'
            RETURNING requester_id, requester_name
        ");
        $stmt->execute([$status, $resolverId, $resolverName, $requestId, $topicId]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$row) return null; // already resolved or not found → first-write-wins

        if ($status === 'accepted') {
            self::addParticipant($topicId, $row['requester_id']);
        }
        return [
            'request_id'       => $requestId,
            'requester_id'     => $row['requester_id'],
            'requester_name'   => $row['requester_name'],
            'status'           => $status,
            'resolved_by'      => $resolverId,
            'resolved_by_name' => $resolverName,
        ];
    }

    /**
     * Soft-delete a topic (caller must own it).
     * Returns false if the topic was not found or the caller is not the owner.
     */
    public static function delete(string $topicId, string $guestId, ?string $userId): bool
    {
        $pdo = Database::pdo();

        if ($userId !== null) {
            $check = $pdo->prepare("
                SELECT 1 FROM channel_topics
                WHERE channel_id = :id AND (guest_id = :guest_id OR created_by = :user_id)
            ");
            $check->execute(['id' => $topicId, 'guest_id' => $guestId, 'user_id' => $userId]);
        } else {
            $check = $pdo->prepare("
                SELECT 1 FROM channel_topics WHERE channel_id = :id AND guest_id = :guest_id
            ");
            $check->execute(['id' => $topicId, 'guest_id' => $guestId]);
        }
        if (!$check->fetch()) return false;

        $pdo->prepare("UPDATE channels      SET status = 'deleted', updated_at = now() WHERE id = :id")->execute(['id' => $topicId]);
        $pdo->prepare("UPDATE channel_topics SET expires_at = now()                     WHERE channel_id = :id")->execute(['id' => $topicId]);

        return true;
    }

    /**
     * Owner-gated edit of a hangout's title / description / category.
     * Returns the updated topic, or null if not found / not the owner.
     */
    public static function update(
        string $topicId,
        string $guestId,
        ?string $userId,
        string $title,
        ?string $description,
        string $category
    ): ?array {
        $pdo = Database::pdo();

        if ($userId !== null) {
            $check = $pdo->prepare("
                SELECT 1 FROM channel_topics
                WHERE channel_id = :id AND expires_at > now()
                  AND (guest_id = :guest_id OR created_by = :user_id)
            ");
            $check->execute(['id' => $topicId, 'guest_id' => $guestId, 'user_id' => $userId]);
        } else {
            $check = $pdo->prepare("
                SELECT 1 FROM channel_topics WHERE channel_id = :id AND guest_id = :guest_id AND expires_at > now()
            ");
            $check->execute(['id' => $topicId, 'guest_id' => $guestId]);
        }
        if (!$check->fetch()) return null;

        $cat = in_array($category, self::ALLOWED_CATEGORIES, true) ? $category : 'general';
        $pdo->prepare("
            UPDATE channel_topics SET title = :t, description = :d, category = :c WHERE channel_id = :id
        ")->execute(['t' => $title, 'd' => $description, 'c' => $cat, 'id' => $topicId]);
        // Keep the channel name in sync (used as the hangout's display name).
        $pdo->prepare("UPDATE channels SET name = :n, updated_at = now() WHERE id = :id")
            ->execute(['n' => $title, 'id' => $topicId]);

        return self::findById($topicId);
    }

    /**
     * The user's current ACTIVE (non-expired) hangout, if any — used to enforce
     * one-hangout-per-user at creation. Returns ['id','title'] or null.
     */
    public static function findActiveByUser(string $userId): ?array
    {
        $stmt = Database::pdo()->prepare("
            SELECT ct.channel_id AS id, ct.title
            FROM channel_topics ct
            JOIN channels c ON c.id = ct.channel_id
            WHERE ct.created_by = ? AND c.status = 'active' AND ct.expires_at > now()
            ORDER BY ct.created_at DESC
            LIMIT 1
        ");
        $stmt->execute([$userId]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    // ── Subscriptions ─────────────────────────────────────────────────────────

    /**
     * Subscribe a registered user to a topic's notifications.
     * Idempotent — safe to call on every message send.
     */
    public static function subscribe(string $topicId, string $userId): void
    {
        Database::pdo()->prepare("
            INSERT INTO topic_subscriptions (topic_id, user_id)
            VALUES (?, ?)
            ON CONFLICT (topic_id, user_id) DO NOTHING
        ")->execute([$topicId, $userId]);
    }

    /**
     * Admin create: no guestId required — sets created_by to the given userId (or null).
     */
    public static function adminCreate(
        string $cityId,
        string $title,
        ?string $description,
        string $category = 'general',
        ?string $creatorId = null,
        int $ttlHours = self::DEFAULT_TTL_HOURS
    ): string {
        $pdo       = Database::pdo();
        $id        = bin2hex(random_bytes(8));
        $expiresAt = time() + $ttlHours * 3600;

        $pdo->beginTransaction();
        try {
            $pdo->prepare("
                INSERT INTO channels (id, type, parent_id, name, status, created_at, updated_at)
                VALUES (:id, 'topic', :parent_id, :name, 'active', now(), now())
            ")->execute([
                'id'        => $id,
                'parent_id' => $cityId,
                'name'      => $title,
            ]);

            $pdo->prepare("
                INSERT INTO channel_topics
                    (channel_id, city_id, created_by, guest_id, title, description, category, expires_at)
                VALUES
                    (:channel_id, :city_id, :created_by, NULL, :title, :description, :category,
                     to_timestamp(:expires_at))
            ")->execute([
                'channel_id'  => $id,
                'city_id'     => $cityId,
                'created_by'  => $creatorId,
                'title'       => $title,
                'description' => $description,
                'category'    => $category,
                'expires_at'  => $expiresAt,
            ]);

            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        // Auto-subscribe the chosen creator so they get notified on replies.
        // Run outside the transaction — a subscription failure should not undo topic creation.
        if ($creatorId !== null) {
            try {
                self::subscribe($id, $creatorId);
            } catch (\Throwable $e) {
                error_log("[topic-admin] subscribe failed for creator {$creatorId} on topic {$id}: " . $e->getMessage());
            }
        }

        return $id;
    }

    /**
     * Admin update: no ownership check. Pass null for $expiresAt to leave it unchanged.
     */
    public static function adminUpdate(
        string $topicId,
        string $title,
        ?string $description,
        string $category,
        ?int $expiresAt
    ): void {
        $pdo    = Database::pdo();
        $params = [
            'title'       => $title,
            'description' => $description,
            'category'    => $category,
            'id'          => $topicId,
        ];

        $expiryClause = '';
        if ($expiresAt !== null) {
            $expiryClause         = ', expires_at = to_timestamp(:expires_at)';
            $params['expires_at'] = $expiresAt;
        }

        $pdo->prepare("
            UPDATE channel_topics
            SET title = :title, description = :description, category = :category{$expiryClause}
            WHERE channel_id = :id
        ")->execute($params);

        // Keep channels.name in sync so any channel-name lookup stays consistent.
        $pdo->prepare("
            UPDATE channels SET name = :name, updated_at = now() WHERE id = :id
        ")->execute(['name' => $title, 'id' => $topicId]);
    }

    /**
     * Admin hard-delete: no ownership check.
     */
    public static function adminDelete(string $topicId): void
    {
        $pdo = Database::pdo();
        $pdo->prepare("UPDATE channels      SET status = 'deleted', updated_at = now() WHERE id = :id")->execute(['id' => $topicId]);
        $pdo->prepare("UPDATE channel_topics SET expires_at = now()                     WHERE channel_id = :id")->execute(['id' => $topicId]);
    }

    public static function allowedCategories(): array
    {
        return self::ALLOWED_CATEGORIES;
    }
}
