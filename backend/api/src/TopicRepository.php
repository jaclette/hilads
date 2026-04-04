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
            'message_count'    => (int) ($row['message_count'] ?? 0),
            'last_activity_at' => isset($row['last_activity_at']) ? (int) $row['last_activity_at'] : null,
            'expires_at'       => (int) $row['expires_at'],
            'created_at'       => (int) $row['created_at'],
        ];
    }

    // ── Reads ─────────────────────────────────────────────────────────────────

    /**
     * Active topics for a city, sorted by last activity DESC.
     * $cityId is the channel ID string, e.g. 'city_3'.
     */
    public static function getByCity(string $cityId): array
    {
        $stmt = Database::pdo()->prepare(self::SELECT . "
            WHERE ct.city_id   = :city_id
              AND c.status     = 'active'
              AND ct.expires_at > now()
            GROUP BY c.id, ct.city_id, ct.created_by, ct.guest_id,
                     ct.title, ct.description, ct.category, ct.expires_at
            ORDER BY COALESCE(MAX(m.created_at), c.created_at) DESC
            LIMIT 20
        ");
        $stmt->execute(['city_id' => $cityId]);
        return array_map([self::class, 'format'], $stmt->fetchAll());
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
                     ct.title, ct.description, ct.category, ct.expires_at
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
        int $ttlHours = self::DEFAULT_TTL_HOURS
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
                (channel_id, city_id, created_by, guest_id, title, description, category, expires_at)
            VALUES
                (:channel_id, :city_id, :created_by, :guest_id, :title, :description, :category,
                 to_timestamp(:expires_at))
        ")->execute([
            'channel_id'  => $id,
            'city_id'     => $cityId,
            'created_by'  => $userId,
            'guest_id'    => $guestId,
            'title'       => $title,
            'description' => $description,
            'category'    => $category,
            'expires_at'  => $expiresAt,
        ]);

        return self::findById($id) ?? [
            'id'               => $id,
            'city_id'          => $cityId,
            'created_by'       => $userId,
            'guest_id'         => $guestId,
            'title'            => $title,
            'description'      => $description,
            'category'         => $category,
            'message_count'    => 0,
            'last_activity_at' => null,
            'expires_at'       => $expiresAt,
            'created_at'       => time(),
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
