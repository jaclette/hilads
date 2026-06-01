<?php

declare(strict_types=1);

/**
 * Challenge (Défi) — third primary entity alongside events + hangouts.
 *
 * Mirrors TopicRepository / EventRepository structure but with a status
 * lifecycle:
 *   - 'open'      → active feed (NOW screen, top 5 by recency)
 *   - 'validated' → archive (CTA "See past challenges"); chat still accessible
 *   - hard-delete → channels.status = 'deleted' (same as events/hangouts)
 *
 * Persistence model: no TTL. expires_at defaults to a 2999 sentinel so any
 * shared `expires_at > now()` guards keep working without conditional logic.
 *
 * Participation: mirrors event_participants (guest_id + optional user_id).
 * Guests CAN accept challenges — same anonymous-allowed UX as events.
 */
class ChallengeRepository
{
    public const ALLOWED_TYPES     = ['food', 'place', 'culture', 'help'];
    public const ALLOWED_AUDIENCES = ['locals', 'explorers'];
    public const ALLOWED_STATUSES  = ['open', 'validated'];

    // ── Shared SELECT (challenge + message stats) ─────────────────────────────

    private const SELECT = "
        SELECT
            c.id,
            cc.city_id,
            cc.created_by,
            cc.guest_id,
            cc.title,
            cc.challenge_type,
            cc.audience,
            cc.status,
            COUNT(m.id)                                            AS message_count,
            EXTRACT(EPOCH FROM MAX(m.created_at))::INTEGER         AS last_activity_at,
            EXTRACT(EPOCH FROM cc.validated_at)::INTEGER           AS validated_at,
            EXTRACT(EPOCH FROM cc.created_at)::INTEGER             AS created_at
        FROM channels c
        JOIN channel_challenges cc ON cc.channel_id = c.id
        LEFT JOIN messages m ON m.channel_id = c.id AND m.type IN ('text', 'image')
    ";

    private static function format(array $row): array
    {
        return [
            'id'                   => $row['id'],
            'city_id'              => $row['city_id'],
            'created_by'           => $row['created_by'],
            'guest_id'             => $row['guest_id'],
            'title'                => $row['title'],
            'challenge_type'       => $row['challenge_type'],
            'audience'             => $row['audience'],
            'status'               => $row['status'],
            'message_count'        => (int) ($row['message_count'] ?? 0),
            'last_activity_at'     => isset($row['last_activity_at']) ? (int) $row['last_activity_at'] : null,
            'validated_at'         => isset($row['validated_at'])     ? (int) $row['validated_at']     : null,
            'created_at'           => (int) $row['created_at'],
            // Populated by batched queries; default so the field is always present.
            'participants_preview' => [],
            'participant_count'    => 0,
        ];
    }

    // ── Reads ─────────────────────────────────────────────────────────────────

    /**
     * Active (open) challenge count per city — for the city list summary.
     * Returns an array keyed by integer city channel ID (e.g. 3), value = count.
     */
    public static function getCountsPerCity(): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT cc.city_id, COUNT(*) AS challenge_count
            FROM channel_challenges cc
            JOIN channels c ON c.id = cc.channel_id
            WHERE c.status   = 'active'
              AND cc.status  = 'open'
            GROUP BY cc.city_id
        ");
        $stmt->execute();
        $result = [];
        foreach ($stmt->fetchAll() as $row) {
            // city_id is stored as 'city_3' — extract the numeric ID to match EventRepository.
            $numericId           = (int) str_replace('city_', '', $row['city_id']);
            $result[$numericId]  = (int) $row['challenge_count'];
        }
        return $result;
    }

    /**
     * Active (open) challenges for a city, sorted by created_at DESC.
     * $cityId is the channel ID string, e.g. 'city_3'.
     * $limit is capped at 200 — feed is meant for "top 5" display anyway, but
     * the See-All screen can request more.
     */
    public static function getByCity(string $cityId, int $limit = 50): array
    {
        $limit = max(1, min(200, $limit));
        $pdo   = Database::pdo();

        $stmt = $pdo->prepare(self::SELECT . "
            WHERE cc.city_id = :city_id
              AND c.status   = 'active'
              AND cc.status  = 'open'
            GROUP BY c.id, cc.city_id, cc.created_by, cc.guest_id,
                     cc.title, cc.challenge_type, cc.audience, cc.status,
                     cc.validated_at, cc.created_at
            ORDER BY cc.created_at DESC
            LIMIT $limit
        ");
        $stmt->execute(['city_id' => $cityId]);
        $rows = $stmt->fetchAll();
        if (empty($rows)) return [];

        $out = array_map(static fn(array $r): array => self::format($r), $rows);
        return self::enrichWithParticipants($out);
    }

    /**
     * Validated (archived) challenges for a city — feeds the "See past
     * challenges" CTA. Most-recently-validated first.
     */
    public static function getValidatedByCity(string $cityId, int $limit = 30, ?int $beforeTs = null): array
    {
        $limit  = max(1, min(100, $limit));
        $params = ['city_id' => $cityId];
        $where  = "cc.city_id = :city_id AND c.status = 'active' AND cc.status = 'validated'";
        if ($beforeTs !== null) {
            $where             .= " AND cc.validated_at < to_timestamp(:before)";
            $params['before']   = $beforeTs;
        }

        $stmt = Database::pdo()->prepare(self::SELECT . "
            WHERE $where
            GROUP BY c.id, cc.city_id, cc.created_by, cc.guest_id,
                     cc.title, cc.challenge_type, cc.audience, cc.status,
                     cc.validated_at, cc.created_at
            ORDER BY cc.validated_at DESC NULLS LAST, cc.created_at DESC
            LIMIT $limit
        ");
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        if (empty($rows)) return [];

        return self::enrichWithParticipants(array_map(static fn(array $r): array => self::format($r), $rows));
    }

    public static function findById(string $challengeId): ?array
    {
        $stmt = Database::pdo()->prepare(self::SELECT . "
            WHERE c.id     = :id
              AND c.status = 'active'
            GROUP BY c.id, cc.city_id, cc.created_by, cc.guest_id,
                     cc.title, cc.challenge_type, cc.audience, cc.status,
                     cc.validated_at, cc.created_at
        ");
        $stmt->execute(['id' => $challengeId]);
        $row = $stmt->fetch();
        if (!$row) return null;

        $item                       = self::format($row);
        $item['participant_count']  = self::participantCount($challengeId);
        $item['participants_preview'] = self::participantPreview($challengeId, 5);
        return $item;
    }

    /**
     * Challenges a user created OR accepted — for the profile "Challenges" tab.
     * Includes is_owner flag. Most-recent first.
     */
    public static function getByUser(string $userId): array
    {
        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("
            SELECT c.id, cc.city_id, cc.created_by, cc.guest_id, cc.title,
                   cc.challenge_type, cc.audience, cc.status,
                   EXTRACT(EPOCH FROM cc.validated_at)::INTEGER AS validated_at,
                   EXTRACT(EPOCH FROM cc.created_at)::INTEGER   AS created_at
            FROM channels c
            JOIN channel_challenges cc ON cc.channel_id = c.id
            WHERE c.status = 'active'
              AND (cc.created_by = :owner_id
                   OR EXISTS (SELECT 1 FROM challenge_participants cp WHERE cp.channel_id = c.id AND cp.user_id = :part_id))
            ORDER BY cc.created_at DESC
            LIMIT 50
        ");
        $stmt->execute(['owner_id' => $userId, 'part_id' => $userId]);
        $challenges = $stmt->fetchAll();
        if (empty($challenges)) return [];

        // Batch message stats.
        $ids = array_column($challenges, 'id');
        $in  = implode(',', array_fill(0, count($ids), '?'));
        $s2  = $pdo->prepare("
            SELECT channel_id, COUNT(*) AS message_count,
                   EXTRACT(EPOCH FROM MAX(created_at))::INTEGER AS last_activity_at
            FROM messages WHERE channel_id IN ($in) AND type IN ('text','image') GROUP BY channel_id
        ");
        $s2->execute($ids);
        $statsMap = [];
        foreach ($s2->fetchAll() as $r) $statsMap[$r['channel_id']] = $r;

        $out = [];
        foreach ($challenges as $ch) {
            $stats         = $statsMap[$ch['id']] ?? null;
            $item          = self::format([
                'id'               => $ch['id'],
                'city_id'          => $ch['city_id'],
                'created_by'       => $ch['created_by'],
                'guest_id'         => $ch['guest_id'],
                'title'            => $ch['title'],
                'challenge_type'   => $ch['challenge_type'],
                'audience'         => $ch['audience'],
                'status'           => $ch['status'],
                'message_count'    => $stats['message_count']    ?? 0,
                'last_activity_at' => $stats['last_activity_at'] ?? null,
                'validated_at'     => $ch['validated_at'],
                'created_at'       => $ch['created_at'],
            ]);
            $item['is_owner'] = ($ch['created_by'] === $userId);
            $out[]            = $item;
        }
        return self::enrichWithParticipants($out);
    }

    // ── Writes ────────────────────────────────────────────────────────────────

    /**
     * Create a new challenge channel + metadata row.
     * Auto-joins the creator as the first participant (mirror events).
     * Returns the freshly-built challenge via findById (consistent shape).
     */
    public static function create(
        string $cityId,
        string $guestId,
        ?string $userId,
        ?string $nickname,
        string $title,
        string $challengeType,
        string $audience
    ): array {
        if (!in_array($challengeType, self::ALLOWED_TYPES,     true)) $challengeType = 'food';
        if (!in_array($audience,      self::ALLOWED_AUDIENCES, true)) $audience      = 'locals';

        $pdo = Database::pdo();
        $id  = bin2hex(random_bytes(8));

        $pdo->prepare("
            INSERT INTO channels (id, type, parent_id, name, status, created_at, updated_at)
            VALUES (:id, 'challenge', :parent_id, :name, 'active', now(), now())
        ")->execute([
            'id'        => $id,
            'parent_id' => $cityId,
            'name'      => $title,
        ]);

        // expires_at uses the table default (2999 sentinel) — challenges are persistent.
        $pdo->prepare("
            INSERT INTO channel_challenges
                (channel_id, city_id, created_by, guest_id, title, challenge_type, audience, status)
            VALUES
                (:channel_id, :city_id, :created_by, :guest_id, :title, :challenge_type, :audience, 'open')
        ")->execute([
            'channel_id'     => $id,
            'city_id'        => $cityId,
            'created_by'     => $userId,
            'guest_id'       => $guestId,
            'title'          => $title,
            'challenge_type' => $challengeType,
            'audience'       => $audience,
        ]);

        // Auto-join the creator (guests included).
        self::addParticipant($id, $guestId, $userId, $nickname);

        return self::findById($id) ?? [
            'id'                   => $id,
            'city_id'              => $cityId,
            'created_by'           => $userId,
            'guest_id'             => $guestId,
            'title'                => $title,
            'challenge_type'       => $challengeType,
            'audience'             => $audience,
            'status'               => 'open',
            'message_count'        => 0,
            'last_activity_at'     => null,
            'validated_at'         => null,
            'created_at'           => time(),
            'participants_preview' => [],
            'participant_count'    => 1,
        ];
    }

    /**
     * Owner-gated edit of title / challenge_type / audience.
     * Returns the updated challenge, or null if not found / not the owner.
     * Status cannot be flipped here — use validate() instead.
     */
    public static function update(
        string $challengeId,
        string $guestId,
        ?string $userId,
        string $title,
        string $challengeType,
        string $audience
    ): ?array {
        if (!self::ownerCheck($challengeId, $guestId, $userId)) return null;

        if (!in_array($challengeType, self::ALLOWED_TYPES,     true)) $challengeType = 'food';
        if (!in_array($audience,      self::ALLOWED_AUDIENCES, true)) $audience      = 'locals';

        $pdo = Database::pdo();
        $pdo->prepare("
            UPDATE channel_challenges
            SET title = :t, challenge_type = :tp, audience = :a
            WHERE channel_id = :id
        ")->execute(['t' => $title, 'tp' => $challengeType, 'a' => $audience, 'id' => $challengeId]);

        // Keep the channel name in sync with the title (used as display name).
        $pdo->prepare("UPDATE channels SET name = :n, updated_at = now() WHERE id = :id")
            ->execute(['n' => $title, 'id' => $challengeId]);

        return self::findById($challengeId);
    }

    /**
     * Move challenge from 'open' → 'validated'. Idempotent: a re-validate is a
     * no-op but still returns the row.
     *
     * Returns:
     *   - array on success
     *   - null  if not found / not the owner
     */
    public static function validate(
        string $challengeId,
        string $guestId,
        ?string $userId
    ): ?array {
        if (!self::ownerCheck($challengeId, $guestId, $userId)) return null;

        Database::pdo()->prepare("
            UPDATE channel_challenges
            SET status = 'validated', validated_at = COALESCE(validated_at, now())
            WHERE channel_id = :id AND status = 'open'
        ")->execute(['id' => $challengeId]);

        return self::findById($challengeId);
    }

    /**
     * Soft-delete (channels.status='deleted'). Caller must own the challenge.
     * Returns false if not found / not the owner.
     */
    public static function delete(string $challengeId, string $guestId, ?string $userId): bool
    {
        if (!self::ownerCheck($challengeId, $guestId, $userId)) return false;

        Database::pdo()->prepare("UPDATE channels SET status = 'deleted', updated_at = now() WHERE id = :id")
            ->execute(['id' => $challengeId]);

        return true;
    }

    /**
     * Owner check — accepts the request if EITHER the guest_id OR the
     * registered user_id matches the creator. Identical pattern to Topics.
     */
    private static function ownerCheck(string $challengeId, string $guestId, ?string $userId): bool
    {
        $pdo = Database::pdo();
        if ($userId !== null) {
            $stmt = $pdo->prepare("
                SELECT 1 FROM channel_challenges
                WHERE channel_id = :id AND (guest_id = :guest_id OR created_by = :user_id)
            ");
            $stmt->execute(['id' => $challengeId, 'guest_id' => $guestId, 'user_id' => $userId]);
        } else {
            $stmt = $pdo->prepare("
                SELECT 1 FROM channel_challenges WHERE channel_id = :id AND guest_id = :guest_id
            ");
            $stmt->execute(['id' => $challengeId, 'guest_id' => $guestId]);
        }
        return (bool) $stmt->fetchColumn();
    }

    // ── Participants ──────────────────────────────────────────────────────────

    /** Idempotent join. Updates nickname if the row already exists. */
    public static function addParticipant(
        string $challengeId,
        string $guestId,
        ?string $userId,
        ?string $nickname
    ): void {
        Database::pdo()->prepare("
            INSERT INTO challenge_participants (channel_id, guest_id, user_id, nickname)
            VALUES (:channel_id, :guest_id, :user_id, :nickname)
            ON CONFLICT (channel_id, guest_id) DO UPDATE
            SET user_id  = COALESCE(EXCLUDED.user_id, challenge_participants.user_id),
                nickname = COALESCE(EXCLUDED.nickname, challenge_participants.nickname)
        ")->execute([
            'channel_id' => $challengeId,
            'guest_id'   => $guestId,
            'user_id'    => $userId,
            'nickname'   => $nickname,
        ]);
    }

    public static function removeParticipant(string $challengeId, string $guestId): void
    {
        Database::pdo()->prepare("
            DELETE FROM challenge_participants WHERE channel_id = ? AND guest_id = ?
        ")->execute([$challengeId, $guestId]);
    }

    public static function isParticipant(string $challengeId, string $guestId): bool
    {
        $stmt = Database::pdo()->prepare("
            SELECT 1 FROM challenge_participants WHERE channel_id = ? AND guest_id = ? LIMIT 1
        ");
        $stmt->execute([$challengeId, $guestId]);
        return (bool) $stmt->fetchColumn();
    }

    public static function participantCount(string $challengeId): int
    {
        $stmt = Database::pdo()->prepare("SELECT COUNT(*) FROM challenge_participants WHERE channel_id = ?");
        $stmt->execute([$challengeId]);
        return (int) $stmt->fetchColumn();
    }

    /** Registered user_ids of a challenge's participants (for push fan-out on validate). */
    public static function participantUserIds(string $challengeId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT user_id FROM challenge_participants WHERE channel_id = ? AND user_id IS NOT NULL
        ");
        $stmt->execute([$challengeId]);
        return $stmt->fetchAll(\PDO::FETCH_COLUMN);
    }

    /** Up to $limit participant avatar previews (most-recent-joined first). */
    public static function participantPreview(string $challengeId, int $limit = 5): array
    {
        $limit = max(1, min(20, $limit));
        $stmt  = Database::pdo()->prepare("
            SELECT u.id, u.display_name, u.profile_thumb_photo_url, u.profile_photo_url
            FROM challenge_participants cp
            JOIN users u ON u.id = cp.user_id AND u.deleted_at IS NULL
            WHERE cp.channel_id = ?
            ORDER BY cp.joined_at DESC
            LIMIT " . $limit);
        $stmt->execute([$challengeId]);
        return array_map(static fn(array $r): array => [
            'id'             => $r['id'],
            'displayName'    => $r['display_name'] ?? 'Member',
            'thumbAvatarUrl' => $r['profile_thumb_photo_url'] ?? $r['profile_photo_url'] ?? null,
        ], $stmt->fetchAll(\PDO::FETCH_ASSOC));
    }

    /** Batched preview for the NOW feed (one windowed query). */
    public static function participantPreviewBatch(array $challengeIds, int $limit = 5): array
    {
        if (empty($challengeIds)) return [];
        $limit = max(1, min(20, $limit));
        $in    = implode(',', array_fill(0, count($challengeIds), '?'));
        $stmt  = Database::pdo()->prepare("
            SELECT channel_id, id, display_name, thumb_url, full_url FROM (
                SELECT cp.channel_id, u.id, u.display_name,
                       u.profile_thumb_photo_url AS thumb_url,
                       u.profile_photo_url       AS full_url,
                       row_number() OVER (PARTITION BY cp.channel_id ORDER BY cp.joined_at DESC) AS rn
                FROM challenge_participants cp
                JOIN users u ON u.id = cp.user_id AND u.deleted_at IS NULL
                WHERE cp.channel_id IN ($in)
            ) t WHERE rn <= " . $limit);
        $stmt->execute(array_values($challengeIds));
        $map = [];
        foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $r) {
            $map[$r['channel_id']][] = [
                'id'             => $r['id'],
                'displayName'    => $r['display_name'] ?? 'Member',
                'thumbAvatarUrl' => $r['thumb_url'] ?? $r['full_url'] ?? null,
            ];
        }
        return $map;
    }

    /** Batched count for the NOW feed. */
    public static function participantCountBatch(array $challengeIds): array
    {
        if (empty($challengeIds)) return [];
        $in   = implode(',', array_fill(0, count($challengeIds), '?'));
        $stmt = Database::pdo()->prepare("
            SELECT channel_id, COUNT(*) AS cnt
            FROM challenge_participants
            WHERE channel_id IN ($in)
            GROUP BY channel_id
        ");
        $stmt->execute(array_values($challengeIds));
        $map = [];
        foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $r) {
            $map[$r['channel_id']] = (int) $r['cnt'];
        }
        return $map;
    }

    /**
     * Full participant list for the members modal — canonical UserDTOs
     * (id, displayName, username, avatarUrl, accountType, badges, vibe…),
     * joined-order. Handles both registered users AND guests (challenges
     * accept guest participants, unlike hangouts which are members-only).
     */
    public static function getParticipants(string $challengeId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT cp.user_id,
                   cp.guest_id,
                   cp.nickname AS guest_nickname,
                   EXTRACT(EPOCH FROM cp.joined_at)::int AS joined_at,
                   CASE WHEN u.deleted_at IS NULL THEN u.display_name      ELSE NULL END AS display_name,
                   CASE WHEN u.deleted_at IS NULL THEN u.profile_photo_url ELSE NULL END AS profile_photo_url,
                   CASE WHEN u.deleted_at IS NULL THEN u.vibe              ELSE NULL END AS vibe,
                   CASE WHEN u.deleted_at IS NULL THEN u.created_at        ELSE NULL END AS user_created_at
            FROM challenge_participants cp
            LEFT JOIN users u ON u.id = cp.user_id
            WHERE cp.channel_id = ?
            ORDER BY cp.joined_at ASC
        ");
        $stmt->execute([$challengeId]);
        return array_map(static function (array $r): array {
            $joinedAt = (int) $r['joined_at'];
            // Registered user (with a live account) → full UserDTO.
            if ($r['user_id'] !== null && $r['display_name'] !== null) {
                return array_merge(UserResource::fromUser([
                    'id'                => $r['user_id'],
                    'display_name'      => $r['display_name'],
                    'profile_photo_url' => $r['profile_photo_url'],
                    'vibe'              => $r['vibe'],
                    'created_at'        => $r['user_created_at'],
                    'home_city'         => null,
                ]), ['joinedAt' => $joinedAt]);
            }
            // Registered user whose account was deleted → discreet placeholder.
            if ($r['user_id'] !== null) {
                return array_merge(UserResource::fromGuest($r['user_id'], 'Former member'), ['joinedAt' => $joinedAt]);
            }
            // Pure guest — show the nickname they used when accepting.
            return array_merge(
                UserResource::fromGuest($r['guest_id'], $r['guest_nickname'] ?? 'Guest'),
                ['joinedAt' => $joinedAt],
            );
        }, $stmt->fetchAll(\PDO::FETCH_ASSOC));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** Hydrate a batch of challenge rows with participant preview + count. */
    private static function enrichWithParticipants(array $challenges): array
    {
        if (empty($challenges)) return [];
        $ids      = array_map(static fn(array $c): string => $c['id'], $challenges);
        $previews = self::participantPreviewBatch($ids, 5);
        $counts   = self::participantCountBatch($ids);
        foreach ($challenges as &$c) {
            $c['participants_preview'] = $previews[$c['id']] ?? [];
            $c['participant_count']    = $counts[$c['id']]   ?? 0;
        }
        return $challenges;
    }

    public static function allowedTypes(): array     { return self::ALLOWED_TYPES; }
    public static function allowedAudiences(): array { return self::ALLOWED_AUDIENCES; }
}
