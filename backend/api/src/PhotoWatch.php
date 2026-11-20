<?php

declare(strict_types=1);

/**
 * Every photo people publish (Daily photos, chat photos, profile photos) is
 * listed in Back office › Photos, and the admin (ADMIN_TEST_USER_ID) gets a
 * push, at most one every ALERT_EVERY seconds: "@linh in Saigon chat · 3 new".
 * Photos go live at once; this is for checking them after (delete in the
 * back office). Direct messages are private and not listed.
 *
 * Best effort: a failure here never breaks the post.
 */
final class PhotoWatch
{
    public const ALERT_EVERY = 600;   // seconds between "new photos" pushes to the admin
    public const SOURCES = ['daily' => 'Daily', 'chat' => 'Chat', 'avatar' => 'Profile photo'];

    /**
     * $source: daily | chat | avatar. $refId: the proof, message or user id.
     * $author: a user row (id, username, display_name) or ['nickname' =>, 'guest_id' =>] for a guest.
     */
    public static function published(string $source, string $refId, ?string $url, array $author, ?string $where): void
    {
        if ($url === null || $url === '' || !empty($author['is_demo']) || !empty($author['is_fake'])) {
            return;
        }
        try {
            $who = isset($author['username']) && $author['username'] !== '' ? '@' . $author['username']
                 : (string) ($author['display_name'] ?? $author['nickname'] ?? '?');
            Database::pdo()->prepare("
                INSERT INTO photo_watch (source, ref_id, url, user_id, guest_id, author, place)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ")->execute([$source, $refId, $url, $author['id'] ?? null, $author['guest_id'] ?? null,
                         mb_substr($who, 0, 60), $where !== null ? mb_substr($where, 0, 80) : null]);
            self::alert($source, $who, $where, $author['id'] ?? null);
        } catch (\Throwable $e) {
            error_log('[photo-watch] ' . $source . ' ' . $refId . ': ' . $e->getMessage());
        }
    }

    /** The admin push, at most one every ALERT_EVERY seconds, counting the photos not yet seen. */
    private static function alert(string $source, string $who, ?string $where, ?string $authorId): void
    {
        $adminId = trim((string) getenv('ADMIN_TEST_USER_ID'));
        // Never about my own photos.
        if ($adminId === '' || $adminId === $authorId || !DbRateLimiter::allow('photo_watch_alert', 1, self::ALERT_EVERY)) {
            return;
        }
        $n = self::unseenCount();
        $what = match ($source) {
            'daily'  => 'Daily photo',
            'avatar' => 'profile photo',
            default  => 'chat photo',
        };
        $body = $who . ($where !== null && $where !== '' ? " in {$where}" : '') . " · {$what}"
              . ($n > 1 ? " · {$n} new" : '');
        NotificationRepository::createUnchecked($adminId, 'daily_admin', 'New photo published', $body, ['url' => '/admin/photos'], 'en');
    }

    public static function unseenCount(): int
    {
        try {
            return (int) Database::pdo()->query("SELECT count(*) FROM photo_watch WHERE seen_at IS NULL")->fetchColumn();
        } catch (\Throwable) {
            return 0;
        }
    }

    /** Newest first; $unseenOnly: the ones not marked seen. */
    public static function list(bool $unseenOnly, int $limit = 120, int $offset = 0): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT id, source, ref_id, url, user_id, guest_id, author, place, seen_at, removed_at,
                   EXTRACT(EPOCH FROM created_at)::BIGINT AS created_ts
            FROM photo_watch" . ($unseenOnly ? ' WHERE seen_at IS NULL' : '') . "
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?
        ");
        $stmt->bindValue(1, $limit, PDO::PARAM_INT);
        $stmt->bindValue(2, $offset, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /** Mark seen: these ids, or every photo up to $upToId. */
    public static function markSeen(?array $ids = null, ?int $upToId = null): int
    {
        if ($ids !== null) {
            $ids = array_values(array_filter(array_map('intval', $ids)));
            if ($ids === []) {
                return 0;
            }
            $stmt = Database::pdo()->prepare('UPDATE photo_watch SET seen_at = now() WHERE seen_at IS NULL AND id = ANY (?::bigint[])');
            $stmt->execute(['{' . implode(',', $ids) . '}']);
            return $stmt->rowCount();
        }
        $stmt = Database::pdo()->prepare('UPDATE photo_watch SET seen_at = now() WHERE seen_at IS NULL AND id <= ?');
        $stmt->execute([(int) $upToId]);
        return $stmt->rowCount();
    }
}
