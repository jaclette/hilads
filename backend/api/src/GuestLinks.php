<?php

declare(strict_types=1);

/**
 * Guest sessions ↔ accounts. A guest id is a device's (or browser's) anonymous
 * identity; when that device signs up or signs in, the guest id is linked to the
 * account so its history (arrivals, messages, reports) belongs to the person.
 *
 * One account can have several guest ids (phone, laptop); a guest id belongs to
 * one account (the first link wins: a browser shared by two accounts stays with
 * the first). Methods: signup (the guest id sent at sign-up), device (a later
 * arrival carried both ids), backfill_signup (users.guest_id), backfill_device
 * (past arrivals that carried both ids, only when that guest id was only ever
 * seen with one account).
 *
 * personSql() is the one rule for "who is this row": the account, else the
 * guest's linked account, else the guest. Fails open before the migration.
 */
final class GuestLinks
{
    public static function link(?string $userId, ?string $guestId, string $method): void
    {
        if ($userId === null || $userId === '' || $guestId === null || $guestId === '' || $guestId === 'bot') return;
        try {
            Database::pdo()->prepare("INSERT INTO user_guest_links (guest_id, user_id, method) VALUES (?, ?, ?) ON CONFLICT (guest_id) DO NOTHING")
                ->execute([$guestId, $userId, $method]);
        } catch (\Throwable $e) {
            error_log('[guest-links] link skipped: ' . $e->getMessage());
        }
    }

    /** The account behind a row with these columns: an SQL expression ($u = user id column, $g = guest id column). */
    public static function accountSql(string $u = 'm.user_id', string $g = 'm.guest_id'): string
    {
        return "coalesce({$u}, (SELECT gl.user_id FROM user_guest_links gl WHERE gl.guest_id = {$g}))";
    }

    /** One id per person: the account (direct or linked), else 'g:' + the guest id. */
    public static function personSql(string $u = 'm.user_id', string $g = 'm.guest_id'): string
    {
        return 'coalesce(' . self::accountSql($u, $g) . ", 'g:' || {$g})";
    }

    /** [guest id => {user_id, username, display_name, method}] for these guest ids. */
    public static function accountsFor(array $guestIds): array
    {
        $guestIds = array_values(array_unique(array_filter($guestIds)));
        if ($guestIds === []) return [];
        try {
            $stmt = Database::pdo()->prepare("
                SELECT gl.guest_id, gl.user_id, gl.method, u.username, u.display_name
                FROM user_guest_links gl JOIN users u ON u.id = gl.user_id
                WHERE gl.guest_id IN (" . implode(',', array_fill(0, count($guestIds), '?')) . ")
            ");
            $stmt->execute($guestIds);
            $out = [];
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) $out[$r['guest_id']] = $r;
            return $out;
        } catch (\Throwable) {
            return [];
        }
    }

    /** The guest ids of an account, oldest link first. */
    public static function guestIdsOf(string $userId): array
    {
        try {
            $stmt = Database::pdo()->prepare("SELECT guest_id FROM user_guest_links WHERE user_id = ? ORDER BY linked_at");
            $stmt->execute([$userId]);
            return $stmt->fetchAll(PDO::FETCH_COLUMN);
        } catch (\Throwable) {
            return [];
        }
    }

    /**
     * Link past sign-ups where it is reliable. Returns counts per method and the
     * number of accounts created in the last $recentDays that now have a guest history.
     */
    public static function backfill(int $recentDays = 30): array
    {
        $pdo = Database::pdo();
        // 1. The guest id sent at sign-up (stored on the account).
        $a = $pdo->exec("
            INSERT INTO user_guest_links (guest_id, user_id, method, linked_at)
            SELECT u.guest_id, u.id, 'backfill_signup', to_timestamp(u.created_at)
            FROM users u
            WHERE u.guest_id IS NOT NULL AND u.guest_id NOT IN ('', 'bot')
            ON CONFLICT (guest_id) DO NOTHING
        ");
        // 2. Arrivals that carried both ids, when that guest id was only ever seen with one account.
        $b = $pdo->exec("
            INSERT INTO user_guest_links (guest_id, user_id, method, linked_at)
            SELECT m.guest_id, min(m.user_id), 'backfill_device', min(m.created_at)
            FROM messages m JOIN users u ON u.id = m.user_id
            WHERE m.type = 'system' AND m.event = 'join' AND m.user_id IS NOT NULL
              AND m.guest_id IS NOT NULL AND m.guest_id NOT IN ('', 'bot')
            GROUP BY m.guest_id
            HAVING count(DISTINCT m.user_id) = 1
            ON CONFLICT (guest_id) DO NOTHING
        ");
        // Recent sign-ups whose guest arrivals are now attached to them.
        $stmt = $pdo->prepare("
            SELECT count(DISTINCT u.id) FROM users u
            WHERE u.deleted_at IS NULL AND u.created_at >= extract(epoch FROM now() - (? * interval '1 day'))
              AND EXISTS (SELECT 1 FROM user_guest_links gl JOIN messages m ON m.guest_id = gl.guest_id AND m.user_id IS NULL
                          WHERE gl.user_id = u.id AND m.type = 'system' AND m.event = 'join')
        ");
        $stmt->execute([$recentDays]);
        $withHistory = (int) $stmt->fetchColumn();
        $stmt = $pdo->prepare("SELECT count(*) FROM users u WHERE u.deleted_at IS NULL
                               AND u.created_at >= extract(epoch FROM now() - (? * interval '1 day'))");
        $stmt->execute([$recentDays]);
        return ['by_signup' => (int) $a, 'by_device' => (int) $b, 'recent_signups' => (int) $stmt->fetchColumn(),
                'recent_with_guest_history' => $withHistory];
    }
}
