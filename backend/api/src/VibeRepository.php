<?php
declare(strict_types=1);

class VibeRepository
{
    /**
     * Upsert a vibe from $authorId for $targetId.
     * Returns the upserted vibe as a formatted array.
     */
    public static function upsert(string $authorId, string $targetId, int $rating, ?string $message): array
    {
        $pdo = Database::pdo();
        $pdo->prepare("
            INSERT INTO user_vibes (author_id, target_id, rating, message)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (author_id, target_id) DO UPDATE
               SET rating = EXCLUDED.rating,
                   message = EXCLUDED.message,
                   updated_at = now()
        ")->execute([$authorId, $targetId, $rating, $message]);

        // Return the upserted row
        $stmt = $pdo->prepare("
            SELECT v.id, v.rating, v.message, v.created_at, v.updated_at,
                   u.id AS author_id, u.display_name AS author_name, u.profile_photo_url AS author_photo
            FROM user_vibes v
            JOIN users u ON u.id = v.author_id
            WHERE v.author_id = ? AND v.target_id = ?
        ");
        $stmt->execute([$authorId, $targetId]);
        return self::formatRow($stmt->fetch(\PDO::FETCH_ASSOC));
    }

    /**
     * List vibes for a target user, newest first, paginated.
     */
    public static function listForUser(string $targetId, int $limit = 20, int $offset = 0): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT v.id, v.rating, v.message, v.created_at, v.updated_at,
                   u.id AS author_id, u.display_name AS author_name, u.profile_photo_url AS author_photo
            FROM user_vibes v
            JOIN users u ON u.id = v.author_id
            WHERE v.target_id = ?
            ORDER BY v.created_at DESC
            LIMIT ? OFFSET ?
        ");
        $stmt->execute([$targetId, $limit, $offset]);
        return array_map([self::class, 'formatRow'], $stmt->fetchAll(\PDO::FETCH_ASSOC));
    }

    /**
     * Returns ['score' => float|null, 'count' => int].
     * score is null when there are no vibes.
     */
    public static function scoreForUser(string $targetId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT COUNT(*) AS cnt, AVG(rating) AS avg_rating
            FROM user_vibes
            WHERE target_id = ?
        ");
        $stmt->execute([$targetId]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        $count = (int) $row['cnt'];
        return [
            'score' => $count > 0 ? round((float) $row['avg_rating'], 1) : null,
            'count' => $count,
        ];
    }

    /**
     * Returns the current viewer's vibe for a target user, or null.
     */
    public static function myVibeFor(string $authorId, string $targetId): ?array
    {
        $stmt = Database::pdo()->prepare("
            SELECT rating, message FROM user_vibes WHERE author_id = ? AND target_id = ?
        ");
        $stmt->execute([$authorId, $targetId]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    private static function formatRow(array $row): array
    {
        return [
            'id'          => (int) $row['id'],
            'rating'      => (int) $row['rating'],
            'message'     => $row['message'],
            'createdAt'   => $row['created_at'],
            'authorId'    => $row['author_id'],
            'authorName'  => $row['author_name'],
            'authorPhoto' => $row['author_photo'],
        ];
    }
}
