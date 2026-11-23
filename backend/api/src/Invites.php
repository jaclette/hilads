<?php

declare(strict_types=1);

/**
 * Invitations (scoring v2, P3, docs/scoring-v2-audit.md).
 *
 * - Each user has a stable invite code (users.invite_code, made on first use);
 *   the link is https://hilads.live/today?ref=CODE (/today is already an app
 *   link: the app opens on it, else the web).
 * - A click on the link (web landing or the app opening it) is kept in
 *   invite_clicks with the visitor's hashed IP.
 * - Signup: the code the client kept (app storage, web ?ref) credits that
 *   inviter; without one, a click from the same IP hash in the last
 *   invite_click_ttl_h hours does (a store install loses the link).
 * - The inviter earns friend_joined (+10) when the friend's FIRST photo is
 *   approved, at most invites_per_season per season, and crew_bonus (+50) once
 *   per season at the crew_size-th. Only for a distinct device: the friend's
 *   install id must be new (no older account on it) and not one of the
 *   inviter's. A shared network is only reported (friends often sign up
 *   together), in Admin › Scoring.
 * - Devices: user_devices (install id from X-Install-Id, hashed IP) recorded
 *   at signup, login and app boot; also feeds the fair-play report.
 *
 * IPs are only stored as a keyed hash (IP_HASH_SALT): enough to group, never
 * readable. Rows older than 90 days are pruned (prune()).
 */
final class Invites
{
    private const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I
    public const LINK_BASE = 'https://hilads.live/today?ref=';
    public const KEEP_DAYS = 90;

    /** A keyed hash of the caller's IP (null for an unknown address). */
    public static function ipHash(?string $ip = null): ?string
    {
        $ip ??= Request::ip();
        if ($ip === '' || $ip === 'unknown') return null;
        $salt = (string) (getenv('IP_HASH_SALT') ?: hash('sha256', 'hilads-ip|' . (string) getenv('DATABASE_URL')));
        return substr(hash_hmac('sha256', $ip, $salt), 0, 32);
    }

    /** The X-Install-Id header (a UUID-ish id the app keeps), else null. */
    public static function installId(): ?string
    {
        $id = trim((string) ($_SERVER['HTTP_X_INSTALL_ID'] ?? ''));
        return preg_match('/^[A-Za-z0-9_-]{8,64}$/', $id) ? $id : null;
    }

    public static function normalize(?string $code): ?string
    {
        $code = strtoupper(trim((string) $code));
        return preg_match('/^[A-Z0-9]{5,12}$/', $code) ? $code : null;
    }

    /** My invite code, made on first use. */
    public static function codeFor(string $userId): string
    {
        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("SELECT invite_code FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        $code = $stmt->fetchColumn();
        if (is_string($code) && $code !== '') return $code;
        for ($i = 0; $i < 8; $i++) {
            $code = '';
            for ($j = 0; $j < 7; $j++) $code .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
            try {
                $upd = $pdo->prepare("UPDATE users SET invite_code = ? WHERE id = ? AND invite_code IS NULL");
                $upd->execute([$code, $userId]);
                if ($upd->rowCount() === 1) return $code;
                $stmt->execute([$userId]);
                return (string) $stmt->fetchColumn();
            } catch (\PDOException $e) {
                if ($e->getCode() !== '23505') throw $e;   // the code is taken: another one
            }
        }
        throw new RuntimeException('Could not make an invite code.');
    }

    /** The inviter behind a code (a live, real account), else null. */
    public static function inviter(?string $code): ?array
    {
        $code = self::normalize($code);
        if ($code === null) return null;
        $stmt = Database::pdo()->prepare("
            SELECT id, username, display_name, profile_thumb_photo_url AS thumb FROM users
            WHERE invite_code = ? AND deleted_at IS NULL AND NOT is_demo AND NOT is_fake
        ");
        $stmt->execute([$code]);
        $r = $stmt->fetch(PDO::FETCH_ASSOC);
        return $r ?: null;
    }

    /** The link was opened (web landing, or the app on it). */
    public static function recordClick(string $code): bool
    {
        $inviter = self::inviter($code);
        if ($inviter === null) return false;
        Database::pdo()->prepare("INSERT INTO invite_clicks (code, inviter_user_id, ip_hash, platform) VALUES (?, ?, ?, ?)")
            ->execute([self::normalize($code), $inviter['id'], self::ipHash(), Request::platform()]);
        return true;
    }

    /**
     * A new account: who invited it. The code sent by the client first, else a recent click
     * from the same network. Never the user themself. Returns the inviter's id or null.
     */
    public static function attribute(string $newUserId, ?string $code): ?string
    {
        try {
            $via = 'code';
            $inviter = self::inviter($code);
            if ($inviter === null) {
                $hash = self::ipHash();
                if ($hash === null) return null;
                $ttl  = (int) Scoring::config()['invite_click_ttl_h'];
                $stmt = Database::pdo()->prepare("
                    SELECT c.inviter_user_id FROM invite_clicks c
                    WHERE c.ip_hash = ? AND c.created_at > now() - (? * interval '1 hour')
                    ORDER BY c.created_at DESC LIMIT 1
                ");
                $stmt->execute([$hash, $ttl]);
                $id = $stmt->fetchColumn();
                if ($id === false) return null;
                $inviter = ['id' => (string) $id];
                $via = 'ip';
            }
            if ($inviter['id'] === $newUserId) return null;
            $upd = Database::pdo()->prepare("
                UPDATE users SET invited_by_user_id = ?, invited_via = ?, invited_at = now()
                WHERE id = ? AND invited_by_user_id IS NULL
            ");
            $upd->execute([$inviter['id'], $via, $newUserId]);
            if ($upd->rowCount() === 1) {
                // "Minh joined Hilads with your link 🎉" (step 2 of 3 for the inviter).
                $stmt = Database::pdo()->prepare("SELECT username, display_name FROM users WHERE id = ?");
                $stmt->execute([$newUserId]);
                $f = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
                self::notify((string) $inviter['id'], 'daily_friend_signed_up', [
                    'friendId' => $newUserId, 'username' => $f['username'] ?? null,
                    'name' => ($f['display_name'] ?? '') !== '' ? $f['display_name'] : ('@' . ($f['username'] ?? '')),
                    'points' => Scoring::points('friend_joined'),
                ]);
            }
            return $inviter['id'];
        } catch (\Throwable $e) {
            error_log('[invites] attribute failed: ' . $e->getMessage());
            return null;
        }
    }

    /** Remember the device and network a user is on (signup, login, app boot). Never throws. */
    public static function recordDevice(string $userId): void
    {
        try {
            $install = self::installId();
            $hash    = self::ipHash();
            if ($install === null && $hash === null) return;
            Database::pdo()->prepare("
                INSERT INTO user_devices (user_id, install_id, ip_hash, platform) VALUES (?, ?, ?, ?)
                ON CONFLICT (user_id, install_id, ip_hash) DO UPDATE SET last_seen = now()
            ")->execute([$userId, $install ?? '', $hash ?? '', Request::platform()]);
        } catch (\Throwable $e) {
            error_log('[invites] device failed: ' . $e->getMessage());
        }
    }

    /**
     * Why an invite would not be credited (null = it can be): 'same_device' (the friend's
     * install is one of the inviter's), 'shared_device' (an older account is on the friend's
     * install: not a new person).
     */
    public static function blockReason(string $inviterId, string $friendId): ?string
    {
        $pdo = Database::pdo();
        $stmt = $pdo->prepare("
            SELECT
              EXISTS (SELECT 1 FROM user_devices f JOIN user_devices i ON i.install_id = f.install_id AND i.user_id = ?
                      WHERE f.user_id = ? AND f.install_id <> '') AS same_device,
              EXISTS (SELECT 1 FROM user_devices f JOIN user_devices o ON o.install_id = f.install_id AND o.user_id <> f.user_id
                      JOIN users ou ON ou.id = o.user_id
                      WHERE f.user_id = ? AND f.install_id <> '' AND ou.created_at < (SELECT created_at FROM users WHERE id = ?)) AS shared_device
        ");
        $stmt->execute([$inviterId, $friendId, $friendId, $friendId]);
        $r = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
        foreach (['same_device', 'shared_device'] as $k) {
            if (DailyProofRepository::bool($r[$k] ?? false)) return $k;
        }
        return null;
    }

    /**
     * An approved photo: when it is the author's first and they were invited, the inviter
     * earns friend_joined (+10, max invites_per_season this season) and at the crew_size-th
     * the crew_bonus (+50, once a season); they become friends. Idempotent. Never throws.
     */
    public static function onApprovedPhoto(array $proof): ?string
    {
        try {
            if (!Scoring::isV2((string) $proof['challenge_date'])) return null;
            $pdo  = Database::pdo();
            $stmt = $pdo->prepare("SELECT invited_by_user_id, display_name, username FROM users WHERE id = ?");
            $stmt->execute([$proof['user_id']]);
            $friend = $stmt->fetch(PDO::FETCH_ASSOC);
            $inviterId = $friend['invited_by_user_id'] ?? null;
            if (!$inviterId) return null;
            // Their first approved real photo only.
            $stmt = $pdo->prepare("SELECT count(*) FROM daily_proofs WHERE user_id = ? AND moderation_status = 'approved'
                                   AND NOT is_demo AND NOT is_seed AND NOT is_suggestion");
            $stmt->execute([$proof['user_id']]);
            if ((int) $stmt->fetchColumn() !== 1) return 'not_first';
            if (($why = self::blockReason((string) $inviterId, (string) $proof['user_id'])) !== null) {
                error_log("[invites] no credit {$inviterId} <- {$proof['user_id']}: {$why}");
                return $why;
            }
            $season = Scoring::season((string) $proof['challenge_date']);
            $count  = self::seasonCount((string) $inviterId, $season, 'friend_joined');
            if ($count >= (int) Scoring::config()['invites_per_season']) return 'cap';

            $ins = $pdo->prepare("
                INSERT INTO score_events (id, user_id, role, kind, points, city_id, month_ref, daily_challenge_id, subject_user_id)
                VALUES (?, ?, 'daily', 'friend_joined', ?, ?, ?, ?, ?)
                ON CONFLICT DO NOTHING RETURNING id
            ");
            $ins->execute([bin2hex(random_bytes(8)), $inviterId, Scoring::points('friend_joined'), $proof['city_id'] ?? null,
                           gmdate('Y-m'), $proof['challenge_id'], $proof['user_id']]);
            if ($ins->fetchColumn() === false) return 'already';
            $count++;
            self::befriend((string) $inviterId, (string) $proof['user_id']);
            $max = (int) Scoring::config()['crew_size'];
            self::notify((string) $inviterId, 'daily_friend_joined', [
                'friendId' => $proof['user_id'], 'name' => $friend['display_name'] ?: ('@' . $friend['username']),
                'username' => $friend['username'], 'points' => Scoring::points('friend_joined'), 'count' => min($count, $max), 'max' => $max,
            ]);

            if ($count === $max && self::seasonCount((string) $inviterId, $season, 'crew_bonus') === 0) {
                $ins = $pdo->prepare("
                    INSERT INTO score_events (id, user_id, role, kind, points, city_id, month_ref, daily_challenge_id)
                    VALUES (?, ?, 'daily', 'crew_bonus', ?, ?, ?, ?)
                    ON CONFLICT DO NOTHING RETURNING id
                ");
                $ins->execute([bin2hex(random_bytes(8)), $inviterId, Scoring::points('crew_bonus'), $proof['city_id'] ?? null, gmdate('Y-m'), $proof['challenge_id']]);
                if ($ins->fetchColumn() !== false) {
                    self::notify((string) $inviterId, 'daily_crew_bonus', ['season' => $season['key'], 'points' => Scoring::points('crew_bonus'), 'max' => $max]);
                }
            }
            MonthlyRankService::recalcAfterScoreChange((string) $inviterId);
            return 'credited';
        } catch (\Throwable $e) {
            error_log('[invites] credit failed: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Moderation removed or rejected a photo: the friend_joined it earned the inviter goes
     * (and the season's crew bonus when the crew is no longer complete).
     */
    public static function revokeForPhoto(string $friendId, string $challengeId): void
    {
        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("DELETE FROM score_events WHERE kind = 'friend_joined' AND subject_user_id = ? AND daily_challenge_id = ?
                               RETURNING user_id, (SELECT challenge_date::text FROM daily_challenges WHERE id = daily_challenge_id) AS date");
        $stmt->execute([$friendId, $challengeId]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $season = Scoring::season((string) $r['date']);
            if (self::seasonCount((string) $r['user_id'], $season, 'friend_joined') < (int) Scoring::config()['crew_size']) {
                $pdo->prepare("
                    DELETE FROM score_events se USING daily_challenges dc
                    WHERE dc.id = se.daily_challenge_id AND se.user_id = ? AND se.kind = 'crew_bonus'
                      AND dc.challenge_date BETWEEN ?::date AND ?::date
                ")->execute([$r['user_id'], $season['startsOn'], $season['endsOn']]);
            }
        }
    }

    /** Points rows of a kind earned in a season (by challenge date). */
    public static function seasonCount(string $userId, array $season, string $kind): int
    {
        $stmt = Database::pdo()->prepare("
            SELECT count(*) FROM score_events se JOIN daily_challenges dc ON dc.id = se.daily_challenge_id
            WHERE se.user_id = ? AND se.kind = ? AND dc.challenge_date BETWEEN ?::date AND ?::date
        ");
        $stmt->execute([$userId, $kind, $season['startsOn'], $season['endsOn']]);
        return (int) $stmt->fetchColumn();
    }

    /**
     * My crew this season, for the Passport card: {code, link, count, max, bonus, points,
     * friends: [{id, displayName, username, photoUrl, credited, joinedAt}]} (friends I invited
     * who signed up, newest first; credited = their first photo earned me the points this season).
     */
    public static function crew(string $userId, ?string $today = null): array
    {
        $today ??= DailyClock::currentDate();
        $season = Scoring::season($today);
        $code   = self::codeFor($userId);
        $stmt = Database::pdo()->prepare("
            SELECT u.id, u.display_name, u.username, u.profile_thumb_photo_url AS thumb, u.invited_at,
                   EXISTS (SELECT 1 FROM score_events se JOIN daily_challenges dc ON dc.id = se.daily_challenge_id
                           WHERE se.user_id = ? AND se.kind = 'friend_joined' AND se.subject_user_id = u.id
                             AND dc.challenge_date BETWEEN ?::date AND ?::date) AS credited,
                   EXISTS (SELECT 1 FROM daily_proofs p WHERE p.user_id = u.id AND p.moderation_status = 'approved'
                             AND NOT p.is_demo AND NOT p.is_seed AND NOT p.is_suggestion) AS played
            FROM users u
            WHERE u.invited_by_user_id = ? AND u.deleted_at IS NULL
            ORDER BY u.invited_at DESC LIMIT 50
        ");
        $stmt->execute([$userId, $season['startsOn'], $season['endsOn'], $userId]);
        $friends = array_map(static fn(array $r): array => [
            'id' => $r['id'], 'displayName' => $r['display_name'], 'username' => $r['username'],
            'photoUrl' => R2Uploader::thumbProxy($r['thumb']), 'credited' => DailyProofRepository::bool($r['credited']),
            // joined (no photo yet) | credited (+10) | played (a photo, no credit: same phone, an older account, the season's cap)
            'status'   => DailyProofRepository::bool($r['credited']) ? 'credited' : (DailyProofRepository::bool($r['played']) ? 'played' : 'joined'),
            'joinedAt' => $r['invited_at'] !== null ? strtotime((string) $r['invited_at']) : null,
        ], $stmt->fetchAll(PDO::FETCH_ASSOC));
        $max = (int) Scoring::config()['crew_size'];
        // Link opens this season (anonymous until the friend signs up).
        $clicks = 0;
        try {
            $c = Database::pdo()->prepare("SELECT count(*) FROM invite_clicks WHERE inviter_user_id = ? AND created_at >= ?::date");
            $c->execute([$userId, $season['startsOn']]);
            $clicks = (int) $c->fetchColumn();
        } catch (\Throwable) { /* before the migration */ }
        return [
            'code'    => $code,
            'clicks'  => $clicks,
            'perSeason' => (int) Scoring::config()['invites_per_season'],
            'link'    => self::LINK_BASE . $code,
            'count'   => min($max, self::seasonCount($userId, $season, 'friend_joined')),
            'max'     => $max,
            'bonus'   => self::seasonCount($userId, $season, 'crew_bonus') > 0,
            'points'  => ['friend' => Scoring::points('friend_joined'), 'crew' => Scoring::points('crew_bonus')],
            'season'  => $season['key'],
            'friends' => $friends,
        ];
    }

    /** Who invited this user (for "Invited by @minh"), else null. */
    public static function invitedBy(string $userId): ?array
    {
        $stmt = Database::pdo()->prepare("
            SELECT i.id, i.username, i.display_name, i.profile_thumb_photo_url AS thumb
            FROM users u JOIN users i ON i.id = u.invited_by_user_id AND i.deleted_at IS NULL
            WHERE u.id = ?
        ");
        $stmt->execute([$userId]);
        $r = $stmt->fetch(PDO::FETCH_ASSOC);
        return $r ? ['id' => $r['id'], 'username' => $r['username'], 'displayName' => $r['display_name'], 'photoUrl' => R2Uploader::thumbProxy($r['thumb'])] : null;
    }

    /** Inviter and friend become friends (both directions, as an accepted request). */
    private static function befriend(string $a, string $b): void
    {
        try {
            $stmt = Database::pdo()->prepare("INSERT INTO user_friends (user_id, friend_id) VALUES (?, ?) ON CONFLICT DO NOTHING");
            $stmt->execute([$a, $b]);
            $stmt->execute([$b, $a]);
        } catch (\Throwable $e) {
            error_log('[invites] befriend failed: ' . $e->getMessage());
        }
    }

    private static function notify(string $userId, string $type, array $data): void
    {
        try {
            if (!NotificationRepository::enabledFor($userId, $type)) return;
            [$title, $body] = NotificationI18n::scoring($type, 'en', $data);
            NotificationRepository::createUnchecked($userId, $type, (string) $title, $body, $data);
        } catch (\Throwable $e) {
            error_log('[invites] notification failed: ' . $e->getMessage());
        }
    }

    /** Drop invite clicks and device rows older than KEEP_DAYS (the privacy promise). */
    public static function prune(): int
    {
        $pdo = Database::pdo();
        $n  = $pdo->exec("DELETE FROM invite_clicks WHERE created_at < now() - interval '" . self::KEEP_DAYS . " days'");
        $n += $pdo->exec("UPDATE user_devices SET ip_hash = '' WHERE ip_hash <> '' AND last_seen < now() - interval '" . self::KEEP_DAYS . " days'
                          AND NOT EXISTS (SELECT 1 FROM user_devices d2 WHERE d2.user_id = user_devices.user_id
                                          AND d2.install_id = user_devices.install_id AND d2.ip_hash = '')");
        return (int) $n;
    }
}
