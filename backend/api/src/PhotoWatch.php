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
            self::alert($source, $who, $where, $author['id'] ?? null, $refId);
        } catch (\Throwable $e) {
            error_log('[photo-watch] ' . $source . ' ' . $refId . ': ' . $e->getMessage());
        }
    }

    /** The admin push, at most one every ALERT_EVERY seconds, counting the photos not yet seen. */
    private static function alert(string $source, string $who, ?string $where, ?string $authorId, ?string $refId = null): void
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
        // A Daily photo carries its id: the app opens that photo (NotificationCategory::deepLink).
        $data = ['url' => '/admin/photos'] + ($source === 'daily' && $refId !== null && $refId !== '' ? ['proofId' => $refId] : []);
        NotificationRepository::createUnchecked($adminId, 'daily_admin', 'New photo published', $body, $data, 'en');
    }

    /** Reports from different people that hide a chat photo until the admin decides (as Daily photos). */
    public const REPORT_HIDE_THRESHOLD = 3;

    /**
     * A photo was reported: its row (made now for a photo older than the watch) goes back
     * to "new" at the top with its report count and reasons, and the admin hears it at once
     * (once per photo, and again when it gets hidden). $count: the open reports so far.
     */
    public static function reported(string $source, string $refId, string $url, array $author, ?string $where,
                                    string $reason, int $count, bool $hidden): void
    {
        try {
            $pdo = Database::pdo();
            $st  = $pdo->prepare('SELECT id, report_reasons FROM photo_watch WHERE source = ? AND ref_id = ? AND url = ? ORDER BY id DESC LIMIT 1');
            $st->execute([$source, $refId, $url]);
            $row = $st->fetch(PDO::FETCH_ASSOC);
            $who = isset($author['username']) && $author['username'] !== '' ? '@' . $author['username']
                 : (string) ($author['display_name'] ?? $author['nickname'] ?? '?');
            if (!$row) {
                $ins = $pdo->prepare("
                    INSERT INTO photo_watch (source, ref_id, url, user_id, guest_id, author, place)
                    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
                ");
                $ins->execute([$source, $refId, $url, $author['id'] ?? null, $author['guest_id'] ?? null,
                               mb_substr($who, 0, 60), $where !== null ? mb_substr($where, 0, 80) : null]);
                $row = ['id' => (int) $ins->fetchColumn(), 'report_reasons' => null];
            }
            $reasons = array_values(array_unique(array_filter(array_merge(explode(',', (string) $row['report_reasons']), [$reason]))));
            $pdo->prepare("
                UPDATE photo_watch
                SET report_count = GREATEST(report_count, ?), report_reasons = ?, reported_at = now(), seen_at = NULL,
                    hidden_at = CASE WHEN ?::boolean THEN COALESCE(hidden_at, now()) ELSE hidden_at END
                WHERE id = ?
            ")->execute([$count, implode(',', $reasons), $hidden ? 'true' : 'false', $row['id']]);

            $adminId = trim((string) getenv('ADMIN_TEST_USER_ID'));
            $first   = DbRateLimiter::allow("photo_report|{$source}|{$refId}", 1, 86400 * 30);
            if ($adminId !== '' && ($first || $hidden)) {
                $what = $source === 'daily' ? 'Daily photo' : 'chat photo';
                $body = "{$who}" . ($where !== null && $where !== '' ? " in {$where}" : '') . " · {$what} · "
                      . str_replace('_', ' ', $reason) . ($hidden ? ' · hidden after ' . $count . ' reports' : '');
                NotificationRepository::createUnchecked($adminId, 'daily_admin', $hidden ? 'Photo hidden by reports' : 'Photo reported',
                    $body, ['url' => '/admin/photos'], 'en');
            }
        } catch (\Throwable $e) {
            error_log('[photo-watch] report ' . $source . ' ' . $refId . ': ' . $e->getMessage());
        }
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
                   report_count, report_reasons, hidden_at,
                   EXTRACT(EPOCH FROM created_at)::BIGINT AS created_ts
            FROM photo_watch" . ($unseenOnly ? ' WHERE seen_at IS NULL' : '') . "
            ORDER BY (seen_at IS NULL AND report_count > 0) DESC, created_at DESC, id DESC
            LIMIT ? OFFSET ?
        ");
        $stmt->bindValue(1, $limit, PDO::PARAM_INT);
        $stmt->bindValue(2, $offset, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /** Back office › Photos tabs: check (not seen yet), reported (open reports), removed, all. */
    public const TABS = ['check', 'reported', 'removed', 'all'];

    private static function where(string $tab, ?string $source, string $q, array &$args): string
    {
        $w = [match ($tab) {
            'check'    => 'seen_at IS NULL',
            'reported' => 'report_count > 0 AND removed_at IS NULL',
            'removed'  => 'removed_at IS NOT NULL',
            default    => 'TRUE',
        }];
        if ($source !== null && isset(self::SOURCES[$source])) { $w[] = 'source = ?'; $args[] = $source; }
        if ($q !== '') {
            $w[] = "(author ILIKE ? OR place ILIKE ? OR user_id = ? OR ref_id = ?)";
            $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], ltrim($q, '@')) . '%';
            array_push($args, $like, $like, $q, $q);
        }
        return implode(' AND ', $w);
    }

    /** One page of a tab (newest first; reported ones first on "check"), with the source / search filters. */
    public static function search(string $tab, ?string $source, string $q, int $limit, int $offset): array
    {
        $args = [];
        $where = self::where($tab, $source, $q, $args);
        $stmt = Database::pdo()->prepare("
            SELECT id, source, ref_id, url, user_id, guest_id, author, place, seen_at, removed_at,
                   report_count, report_reasons, hidden_at, reported_at,
                   EXTRACT(EPOCH FROM created_at)::BIGINT AS created_ts
            FROM photo_watch WHERE {$where}
            ORDER BY " . ($tab === 'check' ? '(report_count > 0) DESC, ' : '') . "created_at DESC, id DESC
            LIMIT {$limit} OFFSET {$offset}
        ");
        $stmt->execute($args);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /** How many photos in each tab (with the source / search filters). */
    public static function counts(?string $source, string $q): array
    {
        $out = [];
        foreach (self::TABS as $tab) {
            $args = [];
            $where = self::where($tab, $source, $q, $args);
            $st = Database::pdo()->prepare("SELECT count(*) FROM photo_watch WHERE {$where}");
            $st->execute($args);
            $out[$tab] = (int) $st->fetchColumn();
        }
        return $out;
    }

    public static function find(int $id): ?array
    {
        $st = Database::pdo()->prepare('SELECT * FROM photo_watch WHERE id = ?');
        $st->execute([$id]);
        return $st->fetch(PDO::FETCH_ASSOC) ?: null;
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
