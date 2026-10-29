<?php

declare(strict_types=1);

/**
 * Comments on Daily Challenge photos (docs/photo-comments-audit.md).
 *
 * One flat thread per photo, oldest first. A reply only quotes another comment
 * of the same photo. Registered users write, like and are mentioned (as with
 * votes); everyone reads. A comment is soft deleted by its writer or the
 * photo's author, and hidden once REPORT_HIDE_THRESHOLD people reported it.
 * daily_proofs.comment_count is kept by a trigger. Comments earn no points.
 *
 * Mentions are parsed here from "@handle" against registered usernames
 * (unknown handles are plain text) and returned as {userId, username}; the
 * apps highlight "@username" in the body.
 */
final class PhotoComments
{
    public const MAX_LENGTH            = 300;
    public const PAGE                  = 30;
    public const PREVIEW               = 2;
    public const RATE_LIMIT            = 10; // comments per user per minute
    public const REPORT_HIDE_THRESHOLD = 3;
    public const REPORT_REASONS        = ['inappropriate', 'harassment', 'spam', 'other'];
    private const MAX_MENTIONS         = 10;

    private const SELECT = "
        SELECT c.id, c.photo_id, c.user_id, c.body, c.reply_to_comment_id, c.created_at, c.edited_at,
               u.username, u.display_name, u.profile_photo_url, cc.country AS user_country, ch.name AS user_city,
               p.user_id AS photo_user_id,
               r.user_id AS reply_user_id, ru.username AS reply_username, r.body AS reply_body,
               (r.deleted_at IS NOT NULL OR r.hidden_at IS NOT NULL) AS reply_gone,
               (SELECT count(*) FROM photo_comment_likes l WHERE l.comment_id = c.id) AS like_count,
               EXISTS (SELECT 1 FROM photo_comment_likes l WHERE l.comment_id = c.id AND l.user_id = :viewer) AS my_like,
               (SELECT json_agg(json_build_object('userId', mu.id, 'username', mu.username))
                  FROM photo_comment_mentions m JOIN users mu ON mu.id = m.mentioned_user_id
                 WHERE m.comment_id = c.id AND mu.deleted_at IS NULL AND mu.username IS NOT NULL) AS mentions
        FROM photo_comments c
        JOIN users u            ON u.id = c.user_id
        JOIN daily_proofs p     ON p.id = c.photo_id
        LEFT JOIN channels ch   ON ch.id = u.current_city_id
        LEFT JOIN cities cc     ON cc.channel_id = u.current_city_id
        LEFT JOIN photo_comments r ON r.id = c.reply_to_comment_id
        LEFT JOIN users ru      ON ru.id = r.user_id
    ";

    private const VISIBLE = "c.deleted_at IS NULL AND c.hidden_at IS NULL AND u.deleted_at IS NULL";

    /**
     * A page of a photo's thread, oldest first: the latest PAGE comments, or
     * the PAGE before comment $before. {items, hasMore}.
     */
    public static function list(string $photoId, ?string $viewerId, array $blockedUserIds, ?int $before = null): array
    {
        [$notBlocked, $args] = self::notBlocked($blockedUserIds);
        $sql = self::SELECT . " WHERE c.photo_id = :photo AND " . self::VISIBLE . $notBlocked
             . ($before !== null ? " AND c.id < :before" : '')
             . " ORDER BY c.id DESC LIMIT " . (self::PAGE + 1);
        $args += ['photo' => $photoId, 'viewer' => $viewerId ?? ''];
        if ($before !== null) {
            $args['before'] = $before;
        }
        $stmt = Database::pdo()->prepare($sql);
        $stmt->execute($args);
        $rows    = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $hasMore = count($rows) > self::PAGE;
        $rows    = array_reverse(array_slice($rows, 0, self::PAGE));
        return ['items' => array_map(fn(array $r) => self::format($r, $viewerId), $rows), 'hasMore' => $hasMore];
    }

    /** The PREVIEW latest visible comments of each photo, oldest first, keyed by photo id. One query. */
    public static function latest(array $photoIds, ?string $viewerId, array $blockedUserIds): array
    {
        if ($photoIds === []) {
            return [];
        }
        [$notBlocked, $args] = self::notBlocked($blockedUserIds);
        $stmt = Database::pdo()->prepare("
            SELECT * FROM (
                SELECT x.*, row_number() OVER (PARTITION BY x.photo_id ORDER BY x.id DESC) AS rn
                FROM (" . self::SELECT . " WHERE c.photo_id = ANY (string_to_array(:ids, ',')) AND " . self::VISIBLE . $notBlocked . ") x
            ) y WHERE rn <= " . self::PREVIEW . " ORDER BY id
        ");
        $stmt->execute($args + ['ids' => implode(',', $photoIds), 'viewer' => $viewerId ?? '']);
        $out = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $out[$r['photo_id']][] = self::format($r, $viewerId);
        }
        return $out;
    }

    /** One comment as the viewer sees it, or null. */
    public static function find(int $id, ?string $viewerId = null): ?array
    {
        $stmt = Database::pdo()->prepare(self::SELECT . " WHERE c.id = :id AND " . self::VISIBLE);
        $stmt->execute(['id' => $id, 'viewer' => $viewerId ?? '']);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row !== false ? $row : null;
    }

    /** Visible comment count of each photo (live state), keyed by photo id. */
    public static function counts(array $photoIds): array
    {
        if ($photoIds === []) {
            return [];
        }
        $stmt = Database::pdo()->prepare("SELECT id, comment_count FROM daily_proofs WHERE id = ANY (string_to_array(?, ','))");
        $stmt->execute([implode(',', $photoIds)]);
        return array_map('intval', $stmt->fetchAll(PDO::FETCH_KEY_PAIR));
    }

    /**
     * Write a comment on an approved photo. Returns the stored row (see find).
     * Throws InvalidArgumentException: invalid_body, moderation_blocked, invalid_reply.
     */
    public static function create(array $photo, array $user, string $body, ?int $replyToId): array
    {
        $body = self::clean($body);
        if ($body === '' || mb_strlen($body) > self::MAX_LENGTH) {
            throw new InvalidArgumentException('invalid_body');
        }
        if (ModerationService::check($body) !== null) {
            throw new InvalidArgumentException('moderation_blocked');
        }
        $pdo = Database::pdo();
        if ($replyToId !== null) {
            $stmt = $pdo->prepare("SELECT 1 FROM photo_comments WHERE id = ? AND photo_id = ? AND deleted_at IS NULL AND hidden_at IS NULL");
            $stmt->execute([$replyToId, $photo['id']]);
            if ($stmt->fetchColumn() === false) {
                throw new InvalidArgumentException('invalid_reply');
            }
        }

        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare("INSERT INTO photo_comments (photo_id, user_id, body, reply_to_comment_id) VALUES (?, ?, ?, ?) RETURNING id");
            $stmt->execute([$photo['id'], $user['id'], $body, $replyToId]);
            $id = (int) $stmt->fetchColumn();
            $mentioned = self::resolveHandles(self::parseHandles($body), $user['id']);
            if ($mentioned !== []) {
                $ins = $pdo->prepare("INSERT INTO photo_comment_mentions (comment_id, mentioned_user_id) VALUES (?, ?) ON CONFLICT DO NOTHING");
                foreach ($mentioned as $uid) {
                    $ins->execute([$id, $uid]);
                }
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return self::find($id, $user['id']);
    }

    /**
     * Soft delete: by its writer or the photo's author. Returns the deleted
     * comment's photo id, or throws InvalidArgumentException not_found / forbidden.
     */
    public static function delete(int $id, array $user): string
    {
        $row = self::find($id);
        if ($row === null) {
            throw new InvalidArgumentException('not_found');
        }
        if ($row['user_id'] !== $user['id'] && $row['photo_user_id'] !== $user['id']) {
            throw new InvalidArgumentException('forbidden');
        }
        Database::pdo()->prepare("UPDATE photo_comments SET deleted_at = now() WHERE id = ? AND deleted_at IS NULL")->execute([$id]);
        return (string) $row['photo_id'];
    }

    /** Like or unlike. Returns {likeCount, myLike}. */
    public static function like(int $id, string $userId, bool $on): array
    {
        $pdo = Database::pdo();
        if ($on) {
            $pdo->prepare("INSERT INTO photo_comment_likes (comment_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING")->execute([$id, $userId]);
        } else {
            $pdo->prepare("DELETE FROM photo_comment_likes WHERE comment_id = ? AND user_id = ?")->execute([$id, $userId]);
        }
        $stmt = $pdo->prepare("SELECT count(*) FROM photo_comment_likes WHERE comment_id = ?");
        $stmt->execute([$id]);
        return ['likeCount' => (int) $stmt->fetchColumn(), 'myLike' => $on];
    }

    /**
     * Report a comment. Returns 'reported', 'reported_hidden' (hidden at the
     * threshold) or 'already_reported'. Throws invalid_reason / own_comment.
     */
    public static function report(array $comment, ?string $userId, ?string $guestId, string $reasonCode): string
    {
        if (!in_array($reasonCode, self::REPORT_REASONS, true)) {
            throw new InvalidArgumentException('invalid_reason');
        }
        if ($userId !== null && $userId === $comment['user_id']) {
            throw new InvalidArgumentException('own_comment');
        }
        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("
            INSERT INTO photo_comment_reports (comment_id, reporter_user_id, reporter_guest_id, reason_code)
            VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id
        ");
        $stmt->execute([$comment['id'], $userId, $userId === null ? $guestId : null, $reasonCode]);
        if ($stmt->fetchColumn() === false) {
            return 'already_reported';
        }
        $count = $pdo->prepare("SELECT count(*) FROM photo_comment_reports WHERE comment_id = ? AND status = 'open'");
        $count->execute([$comment['id']]);
        if ((int) $count->fetchColumn() < self::REPORT_HIDE_THRESHOLD) {
            return 'reported';
        }
        $pdo->prepare("UPDATE photo_comments SET hidden_at = now() WHERE id = ? AND hidden_at IS NULL")->execute([$comment['id']]);
        error_log("[comments] comment {$comment['id']} hidden after " . self::REPORT_HIDE_THRESHOLD . ' reports');
        return 'reported_hidden';
    }

    /**
     * @-autocomplete for a photo's thread: its author and the people already in
     * it first, then the photo's city (people living there), then anyone, by
     * prefix. Registered users only, the caller and blocked people left out.
     */
    public static function mentionSuggestions(array $photo, string $q, ?string $viewerId, array $blockedUserIds): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT u.id, u.username, u.display_name, u.profile_thumb_photo_url, u.profile_photo_url
            FROM users u
            WHERE u.username IS NOT NULL AND u.deleted_at IS NULL AND lower(u.username) LIKE :q
              AND u.id <> :viewer AND NOT (u.id = ANY (string_to_array(:blocked, ',')))
            ORDER BY (u.id = :author) DESC,
                     EXISTS (SELECT 1 FROM photo_comments c WHERE c.photo_id = :photo AND c.user_id = u.id AND c.deleted_at IS NULL) DESC,
                     (u.current_city_id IS NOT DISTINCT FROM :city) DESC,
                     u.username
            LIMIT 8
        ");
        $stmt->execute([
            'q' => strtolower(trim($q)) . '%', 'viewer' => $viewerId ?? '', 'blocked' => implode(',', $blockedUserIds),
            'author' => $photo['user_id'], 'photo' => $photo['id'], 'city' => $photo['city_id'],
        ]);
        return array_map(static fn(array $r): array => [
            'userId'      => $r['id'],
            'username'    => $r['username'],
            'displayName' => $r['display_name'],
            'avatarUrl'   => $r['profile_thumb_photo_url'] ?? $r['profile_photo_url'] ?? null,
        ], $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    /** Reported comments with open reports, most reported first (back office › Daily › Today). */
    public static function reportedQueue(int $limit = 50): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT c.id, c.photo_id, c.body, c.created_at, c.hidden_at, u.username, u.display_name, p.photo_url,
                   count(r.id) AS report_count, string_agg(DISTINCT r.reason_code, ',') AS reasons
            FROM photo_comment_reports r
            JOIN photo_comments c ON c.id = r.comment_id AND c.deleted_at IS NULL
            JOIN users u          ON u.id = c.user_id
            JOIN daily_proofs p   ON p.id = c.photo_id
            WHERE r.status = 'open'
            GROUP BY c.id, u.username, u.display_name, p.photo_url
            ORDER BY count(r.id) DESC, c.id DESC
            LIMIT ?
        ");
        $stmt->execute([$limit]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /** Close a comment's open reports: 'keep' shows it again, 'remove' deletes it. */
    public static function resolveReports(int $id, string $decision): void
    {
        if (!in_array($decision, ['keep', 'remove'], true)) {
            throw new InvalidArgumentException('Unknown decision');
        }
        $pdo = Database::pdo();
        $pdo->prepare("UPDATE photo_comment_reports SET status = ? WHERE comment_id = ? AND status = 'open'")
            ->execute([$decision === 'keep' ? 'dismissed' : 'reviewed', $id]);
        $pdo->prepare($decision === 'keep'
            ? "UPDATE photo_comments SET hidden_at = NULL WHERE id = ?"
            : "UPDATE photo_comments SET deleted_at = now() WHERE id = ? AND deleted_at IS NULL")
            ->execute([$id]);
    }

    /** API shape of a comment row. */
    public static function format(array $r, ?string $viewerId): array
    {
        $mine    = $viewerId !== null && $viewerId === $r['user_id'];
        $replyOk = $r['reply_to_comment_id'] !== null && $r['reply_user_id'] !== null && !DailyProofRepository::bool($r['reply_gone']);
        return [
            'id'        => (int) $r['id'],
            'photoId'   => $r['photo_id'],
            'body'      => $r['body'],
            'user'      => [
                'id'          => $r['user_id'],
                'username'    => $r['username'],
                'displayName' => $r['display_name'],
                'photoUrl'    => R2Uploader::thumbProxy($r['profile_photo_url']),
                // The commenter's city: Berlin talking about Saigon.
                'city'        => $r['user_country'] !== null ? ['name' => $r['user_city'], 'country' => $r['user_country']] : null,
            ],
            'isAuthor'  => $r['user_id'] === $r['photo_user_id'],
            'isMine'    => $mine,
            'canDelete' => $mine || ($viewerId !== null && $viewerId === $r['photo_user_id']),
            'likeCount' => (int) $r['like_count'],
            'myLike'    => DailyProofRepository::bool($r['my_like']),
            'replyTo'   => $replyOk
                ? ['id' => (int) $r['reply_to_comment_id'], 'username' => $r['reply_username'], 'body' => mb_substr((string) $r['reply_body'], 0, 120)]
                : null,
            'mentions'  => is_string($r['mentions'] ?? null) ? json_decode($r['mentions'], true) : [],
            'createdAt' => DailyProofRepository::ts($r['created_at']),
            'editedAt'  => DailyProofRepository::ts($r['edited_at']),
        ];
    }

    /** Lowercase handles written as "@handle" in a body (at a start or after a space), unique, in order. */
    public static function parseHandles(string $body): array
    {
        preg_match_all('/(?:^|[^\w@])@([A-Za-z0-9_]{1,30})/u', $body, $m);
        return array_slice(array_values(array_unique(array_map('strtolower', $m[1]))), 0, self::MAX_MENTIONS);
    }

    /** Trimmed, line breaks kept (at most two in a row), other control characters out. */
    public static function clean(string $body): string
    {
        $body = str_replace(["\r\n", "\r"], "\n", $body);
        $body = preg_replace('/[^\P{C}\n]/u', '', $body) ?? '';
        $body = preg_replace("/\n{3,}/", "\n\n", $body) ?? '';
        return trim($body);
    }

    /** Ids of registered users with these handles, the writer left out. */
    private static function resolveHandles(array $handles, string $writerId): array
    {
        if ($handles === []) {
            return [];
        }
        $stmt = Database::pdo()->prepare("
            SELECT id FROM users
            WHERE lower(username) = ANY (string_to_array(?, ',')) AND deleted_at IS NULL AND id <> ?
        ");
        $stmt->execute([implode(',', $handles), $writerId]);
        return $stmt->fetchAll(PDO::FETCH_COLUMN);
    }

    /** SQL leaving out blocked users' comments, with its named args. */
    private static function notBlocked(array $blockedUserIds): array
    {
        if ($blockedUserIds === []) {
            return ['', []];
        }
        return [" AND NOT (c.user_id = ANY (string_to_array(:blocked, ',')))", ['blocked' => implode(',', $blockedUserIds)]];
    }
}
