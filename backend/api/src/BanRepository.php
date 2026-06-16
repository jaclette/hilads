<?php

declare(strict_types=1);

/**
 * Lightweight abuse ban list for anonymous guests.
 *
 * Soft-deleting a registered user blocks their account, but a banned person
 * can return as a fresh anonymous guest (one tap, new random guestId). This
 * gives ops a way to block that return: a ban targets either a guest_id or an
 * ip_address, with an expiry. The message-post path checks it on every send.
 *
 * Design notes:
 *  - Reads/writes are wrapped so a pre-migration deploy (table absent) FAILS
 *    OPEN: isBanned() returns false rather than 500-ing the whole chat. The
 *    feature simply activates once `php migrate.php` (or POST /internal/migrate)
 *    has been run.
 *  - Bans are time-boxed (default 7 days). A determined attacker can rotate
 *    IP/network to evade - this stops the casual repeat-spammer, which is the
 *    common case. No collateral: bans are per-guest / per-IP, never global.
 */
class BanRepository
{
    /**
     * Is this guest_id OR ip currently under an active (non-expired) ban?
     * Fails open (returns false) if the bans table doesn't exist yet.
     */
    public static function isBanned(?string $guestId, ?string $ip): bool
    {
        if (($guestId === null || $guestId === '') && ($ip === null || $ip === '')) {
            return false;
        }

        $conds  = [];
        $params = [];
        if ($guestId !== null && $guestId !== '') {
            $conds[]  = 'guest_id = ?';
            $params[] = $guestId;
        }
        if ($ip !== null && $ip !== '' && $ip !== 'unknown') {
            $conds[]  = 'ip_address = ?';
            $params[] = $ip;
        }
        if (empty($conds)) {
            return false;
        }

        $sql = "SELECT 1 FROM bans
                WHERE (expires_at IS NULL OR expires_at > now())
                  AND (" . implode(' OR ', $conds) . ")
                LIMIT 1";

        try {
            $stmt = Database::pdo()->prepare($sql);
            $stmt->execute($params);
            return (bool) $stmt->fetchColumn();
        } catch (\Throwable $e) {
            // Table not migrated yet (or transient DB error): never block posting.
            error_log('[bans] isBanned check skipped: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Ban a guest_id for $days, and also ban every distinct IP that guest has
     * posted from in the recent window (so a fresh guestId from the same
     * network is caught too). Returns ['ips' => int, 'days' => int].
     *
     * Throws on DB error (the admin action surfaces it as a flash) - unlike the
     * read path, a failed ban should be visible, not silently swallowed.
     */
    public static function banGuest(string $guestId, ?string $reason, ?string $createdBy, int $days = 7): array
    {
        $pdo     = Database::pdo();
        $expires = gmdate('c', time() + $days * 86400);

        // Ban the guest identity itself.
        $pdo->prepare(
            "INSERT INTO bans (guest_id, reason, created_by, expires_at) VALUES (?, ?, ?, ?)"
        )->execute([$guestId, $reason, $createdBy, $expires]);

        // Ban the IPs this guest recently posted from (city messages carry it).
        $ipStmt = $pdo->prepare(
            "SELECT DISTINCT ip_address
               FROM messages
              WHERE guest_id = ?
                AND ip_address IS NOT NULL
                AND created_at > now() - interval '7 days'"
        );
        $ipStmt->execute([$guestId]);
        $ips = array_column($ipStmt->fetchAll(), 'ip_address');

        if (!empty($ips)) {
            $ins = $pdo->prepare(
                "INSERT INTO bans (ip_address, reason, created_by, expires_at) VALUES (?, ?, ?, ?)"
            );
            foreach ($ips as $ip) {
                if ($ip === '' || $ip === 'unknown') continue;
                $ins->execute([$ip, $reason, $createdBy, $expires]);
            }
        }

        return ['ips' => count($ips), 'days' => $days];
    }

    /**
     * Ban a single IP address directly (admin "block by IP"). $days = 0 means a
     * permanent ban (expires_at NULL). Throws on DB error so the admin sees it.
     */
    public static function banIp(string $ip, ?string $reason, ?string $createdBy, int $days = 0): void
    {
        $ip = trim($ip);
        if ($ip === '' || $ip === 'unknown') {
            throw new \RuntimeException('Empty IP.');
        }
        $expires = $days > 0 ? gmdate('c', time() + $days * 86400) : null;
        Database::pdo()->prepare(
            "INSERT INTO bans (ip_address, reason, created_by, expires_at) VALUES (?, ?, ?, ?)"
        )->execute([$ip, $reason, $createdBy, $expires]);
    }

    /** Ban a guest_id directly (without the message-IP fan-out). */
    public static function banGuestId(string $guestId, ?string $reason, ?string $createdBy, int $days = 0): void
    {
        $guestId = trim($guestId);
        if ($guestId === '') {
            throw new \RuntimeException('Empty guest id.');
        }
        $expires = $days > 0 ? gmdate('c', time() + $days * 86400) : null;
        Database::pdo()->prepare(
            "INSERT INTO bans (guest_id, reason, created_by, expires_at) VALUES (?, ?, ?, ?)"
        )->execute([$guestId, $reason, $createdBy, $expires]);
    }

    /** Active (non-expired) bans, newest first. */
    public static function listActive(int $limit = 500): array
    {
        $stmt = Database::pdo()->prepare(
            "SELECT id, guest_id, ip_address, reason, created_by, created_at, expires_at
               FROM bans
              WHERE expires_at IS NULL OR expires_at > now()
              ORDER BY created_at DESC
              LIMIT ?"
        );
        $stmt->execute([$limit]);
        return $stmt->fetchAll();
    }

    /** Lift a ban by row id. */
    public static function unban(int $id): void
    {
        Database::pdo()->prepare("DELETE FROM bans WHERE id = ?")->execute([$id]);
    }
}
