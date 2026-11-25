<?php

declare(strict_types=1);

/**
 * Back office accounts: one account per person (admin_users), a role, a password, 2FA (TOTP,
 * required for super admins), single-use recovery codes, database sessions with an idle and an
 * absolute timeout, a sign-in lockout, and the page permissions every admin route goes through
 * (admin_require_login → AdminAuth::authorize).
 *
 * The old shared ADMIN_USERNAME / ADMIN_PASSWORD login only works while no account exists, and
 * only to create the first super admin. Lost device: scripts/admin_recover.php (docs/admin-guide.md).
 */
final class AdminAuth
{
    public const ROLES = [
        'super_admin' => 'Super admin',
        'moderator'   => 'Moderator',
        'editor'      => 'Content editor',
        'viewer'      => 'Read-only',
    ];

    public const ROLE_HELP = [
        'super_admin' => 'Everything, including the Danger zone, app versions, settings and admin accounts. 2FA required.',
        'moderator'   => 'Photos, reports, messages, bans, players, cities, plans, and today\'s challenge moderation.',
        'editor'      => 'Daily challenges, special days, Hi questions, places, Worlds studio and promo.',
        'viewer'      => 'Sees every page except settings and the Danger zone, can\'t change anything.',
    ];

    /** Idle timeout and absolute session length, in seconds. */
    public const IDLE_SECONDS     = 2 * 3600;
    public const ABSOLUTE_SECONDS = 12 * 3600;

    /** Lockout: this many failed attempts in the window, per IP or per email. */
    public const MAX_FAILURES   = 5;
    public const FAILURE_WINDOW = 15 * 60;

    public const MIN_PASSWORD = 12;

    /**
     * Areas: which part of the back office a URL belongs to. First match wins (longest prefixes first).
     * 'any' = every signed-in admin; 'self' = my own account pages.
     */
    private const AREAS = [
        ['#^/admin/(login|logout)#',                      'public'],
        ['#^/admin/assets/#',                             'public'],
        ['#^/admin/account#',                             'self'],
        ['#^/admin/search#',                              'any'],
        ['#^/admin/?$#',                                  'any'],
        ['#^/admin/(danger|scores|ranks|thumbs)#',        'danger'],
        ['#^/admin/daily/spots/migration#',               'danger'],
        ['#^/admin/cities/city_\d+/merge#',               'danger'],
        ['#^/admin/settings#',                            'settings'],
        ['#^/admin/audit#',                               'settings'],
        ['#^/admin/app-versions#',                        'system'],
        ['#^/admin/(challenges|campaigns)#',              'archive'],
        ['#^/admin/(photos|reports|messages|bans|arrivals)#', 'moderation'],
        ['#^/admin/daily/today#',                         'live'],
        ['#^/admin/daily/(spots|picks)#',                 'places'],
        ['#^/admin/(daily/promo|worlds)#',                'studio'],
        ['#^/admin/(users|cities|events|topics|api/cities)#', 'community'],
        ['#^/admin/(daily|hi-questions)#',                'content'],
        ['#^/admin/(push|email)#',                        'growth'],
        ['#^/admin/(scoring|launch-season)#',             'game'],
    ];

    /** What each role may change. Every role may look at every area except the hidden ones. */
    private const EDIT = [
        'super_admin' => '*',
        'moderator'   => ['moderation', 'community', 'live'],
        'editor'      => ['content', 'places', 'studio', 'live'],
        'viewer'      => [],
    ];
    private const HIDDEN_FOR_OTHERS = ['danger', 'settings', 'system'];

    /** Area labels for the "not allowed" page. */
    public const AREA_LABELS = [
        'danger' => 'the Danger zone', 'settings' => 'Settings', 'system' => 'App versions & switches',
        'archive' => 'the Archive', 'moderation' => 'Moderation', 'live' => 'today\'s challenge',
        'places' => 'Places', 'studio' => 'Worlds studio and Promo', 'community' => 'Community',
        'content' => 'Daily challenges', 'growth' => 'Push and Email', 'game' => 'Game',
    ];

    private static ?array $user = null;
    private static bool $loaded = false;

    // ── Who is signed in ─────────────────────────────────────────────────────

    /** The signed-in admin (a fully signed-in session only), or null. */
    public static function user(): ?array
    {
        if (self::$loaded) return self::$user;
        self::$loaded = true;
        $id = (int) ($_SESSION['admin_uid'] ?? 0);
        if ($id <= 0) return null;
        $u = self::find($id);
        if ($u === null || $u['disabled_at'] !== null) {
            unset($_SESSION['admin_uid']);
            return null;
        }
        return self::$user = $u;
    }

    public static function id(): ?int
    {
        $u = self::user();
        return $u ? (int) $u['id'] : null;
    }

    public static function name(): ?string
    {
        return self::user()['name'] ?? null;
    }

    public static function role(): ?string
    {
        return self::user()['role'] ?? null;
    }

    public static function isSuper(): bool
    {
        return self::role() === 'super_admin';
    }

    /** Session timeouts. True when the session is still valid (and touches it). */
    public static function sessionAlive(): bool
    {
        $now = time();
        $at  = (int) ($_SESSION['admin_login_at'] ?? 0);
        $seen = (int) ($_SESSION['admin_seen_at'] ?? 0);
        if ($at === 0 || $now - $at > self::ABSOLUTE_SECONDS || $now - $seen > self::IDLE_SECONDS) {
            return false;
        }
        $_SESSION['admin_seen_at'] = $now;
        return true;
    }

    /** Mark the session as fully signed in for $u. */
    public static function signIn(array $u): void
    {
        session_regenerate_id(true);
        foreach (['admin_pending_uid', 'admin_enroll_uid', 'admin_bootstrap', 'admin_enroll_secret'] as $k) unset($_SESSION[$k]);
        $_SESSION['admin_uid']      = (int) $u['id'];
        $_SESSION['admin_login_at'] = time();
        $_SESSION['admin_seen_at']  = time();
        self::$loaded = false;
        AdminSessionHandler::$userId = (int) $u['id'];
        Database::pdo()->prepare("UPDATE admin_users SET last_login_at = now() WHERE id = ?")->execute([$u['id']]);
    }

    // ── Accounts ─────────────────────────────────────────────────────────────

    public static function hasAccounts(): bool
    {
        try {
            return (bool) Database::pdo()->query("SELECT EXISTS (SELECT 1 FROM admin_users)")->fetchColumn();
        } catch (\Throwable) {
            return false;   // table missing: migrate.php not run yet, the shared login still works
        }
    }

    public static function find(int $id): ?array
    {
        $st = Database::pdo()->prepare("SELECT * FROM admin_users WHERE id = ?");
        $st->execute([$id]);
        return $st->fetch(\PDO::FETCH_ASSOC) ?: null;
    }

    public static function findByEmail(string $email): ?array
    {
        $st = Database::pdo()->prepare("SELECT * FROM admin_users WHERE lower(email) = lower(?)");
        $st->execute([trim($email)]);
        return $st->fetch(\PDO::FETCH_ASSOC) ?: null;
    }

    /** @return list<array> */
    public static function all(): array
    {
        return Database::pdo()->query("SELECT * FROM admin_users ORDER BY disabled_at IS NOT NULL, created_at")->fetchAll(\PDO::FETCH_ASSOC);
    }

    /** A problem with a new password, or null when it is fine. */
    public static function passwordProblem(string $password, string $email = ''): ?string
    {
        if (mb_strlen($password) < self::MIN_PASSWORD) return 'Use at least ' . self::MIN_PASSWORD . ' characters.';
        if ($email !== '' && stripos($password, strtok($email, '@') ?: $email) !== false) return 'Don\'t put your email in your password.';
        if (count(array_unique(str_split($password))) < 5) return 'Use a less repetitive password.';
        return null;
    }

    public static function hash(string $password): string
    {
        return password_hash($password, defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT);
    }

    public static function create(string $email, string $name, string $password, string $role, bool $mustChange = false): int
    {
        if (!isset(self::ROLES[$role])) throw new \InvalidArgumentException('Unknown role.');
        $email = trim($email);
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw new \InvalidArgumentException('Enter a valid email address.');
        if (trim($name) === '') throw new \InvalidArgumentException('Enter a name.');
        if (self::findByEmail($email)) throw new \InvalidArgumentException('An admin with this email already exists.');
        $st = Database::pdo()->prepare("
            INSERT INTO admin_users (email, name, password_hash, role, must_change_password)
            VALUES (?, ?, ?, ?, ?) RETURNING id
        ");
        $st->execute([$email, trim($name), self::hash($password), $role, $mustChange ? 'true' : 'false']);
        return (int) $st->fetchColumn();
    }

    public static function setPassword(int $id, string $password, bool $mustChange = false): void
    {
        Database::pdo()->prepare("UPDATE admin_users SET password_hash = ?, must_change_password = ?, updated_at = now() WHERE id = ?")
            ->execute([self::hash($password), $mustChange ? 'true' : 'false', $id]);
    }

    public static function checkPassword(array $u, string $password): bool
    {
        if (!password_verify($password, (string) $u['password_hash'])) return false;
        if (password_needs_rehash((string) $u['password_hash'], defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT)) {
            self::setPassword((int) $u['id'], $password, (bool) $u['must_change_password']);
        }
        return true;
    }

    /** Sign out every session of an admin (except, optionally, the current one). */
    public static function endSessions(int $userId, bool $keepCurrent = false): int
    {
        $sql = "DELETE FROM admin_sessions WHERE admin_user_id = ?";
        $args = [$userId];
        if ($keepCurrent && session_id() !== '') {
            $sql .= " AND id <> ?";
            $args[] = AdminSessionHandler::key(session_id());
        }
        $st = Database::pdo()->prepare($sql);
        $st->execute($args);
        return $st->rowCount();
    }

    // ── 2FA ──────────────────────────────────────────────────────────────────

    public static function has2fa(array $u): bool
    {
        return !empty($u['totp_secret']) && $u['totp_enabled_at'] !== null;
    }

    /** Super admins can't work without 2FA. */
    public static function needs2fa(array $u): bool
    {
        return $u['role'] === 'super_admin';
    }

    /** Check a 6-digit code (one step either side), refusing a code already used. */
    public static function checkCode(array $u, string $code): bool
    {
        if (!self::has2fa($u)) return false;
        $step = AdminTotp::verify((string) $u['totp_secret'], $code, $u['totp_last_step'] !== null ? (int) $u['totp_last_step'] : null);
        if ($step === null) return false;
        Database::pdo()->prepare("UPDATE admin_users SET totp_last_step = ? WHERE id = ?")->execute([$step, $u['id']]);
        return true;
    }

    /** Turn 2FA on with a confirmed secret; returns fresh recovery codes (shown once). */
    public static function enable2fa(int $id, string $secret, int $step): array
    {
        Database::pdo()->prepare("UPDATE admin_users SET totp_secret = ?, totp_enabled_at = now(), totp_last_step = ?, updated_at = now() WHERE id = ?")
            ->execute([$secret, $step, $id]);
        return self::newRecoveryCodes($id);
    }

    public static function disable2fa(int $id): void
    {
        Database::pdo()->prepare("UPDATE admin_users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, recovery_codes = '[]'::jsonb, updated_at = now() WHERE id = ?")
            ->execute([$id]);
    }

    /** 10 new single-use codes (the old ones stop working). Stored as sha256 only. */
    public static function newRecoveryCodes(int $id): array
    {
        $codes = [];
        $hashes = [];
        for ($i = 0; $i < 10; $i++) {
            $raw = strtolower(AdminTotp::base32Encode(random_bytes(7)));   // 56 bits → 12 chars
            $code = substr($raw, 0, 4) . '-' . substr($raw, 4, 4) . '-' . substr($raw, 8, 4);
            $codes[] = $code;
            $hashes[] = self::codeHash($code);
        }
        Database::pdo()->prepare("UPDATE admin_users SET recovery_codes = ?::jsonb, updated_at = now() WHERE id = ?")
            ->execute([json_encode($hashes), $id]);
        return $codes;
    }

    public static function recoveryCodesLeft(array $u): int
    {
        return count(json_decode((string) $u['recovery_codes'], true) ?: []);
    }

    /** Use a recovery code instead of a 2FA code: true when it matched (it is then gone). */
    public static function useRecoveryCode(array $u, string $code): bool
    {
        $h = self::codeHash($code);
        $pdo = Database::pdo();
        $pdo->beginTransaction();
        $st = $pdo->prepare("SELECT recovery_codes FROM admin_users WHERE id = ? FOR UPDATE");
        $st->execute([$u['id']]);
        $list = json_decode((string) $st->fetchColumn(), true) ?: [];
        $i = array_search($h, $list, true);
        if ($i === false) { $pdo->rollBack(); return false; }
        array_splice($list, (int) $i, 1);
        $pdo->prepare("UPDATE admin_users SET recovery_codes = ?::jsonb WHERE id = ?")->execute([json_encode(array_values($list)), $u['id']]);
        $pdo->commit();
        return true;
    }

    public static function codeHash(string $code): string
    {
        return hash('sha256', preg_replace('/[^a-z2-7]/', '', strtolower($code)));
    }

    // ── Sign-in lockout ──────────────────────────────────────────────────────

    public static function locked(string $ip, string $email): bool
    {
        $st = Database::pdo()->prepare("
            SELECT count(*) FILTER (WHERE ip = :ip), count(*) FILTER (WHERE lower(email) = lower(:email))
            FROM admin_login_attempts
            WHERE NOT ok AND created_at > now() - make_interval(secs => :win)
        ");
        $st->execute([':ip' => $ip, ':email' => $email, ':win' => self::FAILURE_WINDOW]);
        [$byIp, $byEmail] = $st->fetch(\PDO::FETCH_NUM);
        return (int) $byIp >= self::MAX_FAILURES || ($email !== '' && (int) $byEmail >= self::MAX_FAILURES);
    }

    public static function attempt(string $ip, string $email, bool $ok): void
    {
        $pdo = Database::pdo();
        $pdo->prepare("INSERT INTO admin_login_attempts (ip, email, ok) VALUES (?, ?, ?)")->execute([$ip, $email, $ok ? 'true' : 'false']);
        if (random_int(1, 50) === 1) $pdo->exec("DELETE FROM admin_login_attempts WHERE created_at < now() - interval '30 days'");
    }

    public static function ip(): string
    {
        $ip = class_exists('Request') ? Request::ip() : ($_SERVER['REMOTE_ADDR'] ?? '');
        return is_string($ip) ? $ip : '';
    }

    // ── Permissions ──────────────────────────────────────────────────────────

    public static function area(string $uri): string
    {
        foreach (self::AREAS as [$re, $area]) {
            if (preg_match($re, $uri)) return $area;
        }
        return 'settings';   // an unmapped page: super admins only until it is placed
    }

    public static function canView(?string $role, string $area): bool
    {
        if ($role === null) return false;
        if (in_array($area, ['public', 'self', 'any'], true)) return true;
        return $role === 'super_admin' || !in_array($area, self::HIDDEN_FOR_OTHERS, true);
    }

    public static function canEdit(?string $role, string $area): bool
    {
        if ($role === null) return false;
        if ($area === 'archive') return false;          // read-only for everyone
        if (in_array($area, ['public', 'self'], true)) return true;
        $edit = self::EDIT[$role] ?? [];
        return $edit === '*' || in_array($area, $edit, true);
    }

    /** May the signed-in admin open this page (GET) or send this form (POST)? */
    public static function allowed(string $uri, string $method): bool
    {
        $area = self::area($uri);
        $role = self::role();
        return in_array($method, ['GET', 'HEAD'], true) ? self::canView($role, $area) : self::canEdit($role, $area);
    }

    // ── Audit ────────────────────────────────────────────────────────────────

    /** One line in the audit log, by the signed-in admin. */
    public static function log(string $action, ?string $entityType = null, ?string $entityId = null, ?array $before = null, ?array $after = null): void
    {
        DailyAdminService::audit($action, $entityType ?? 'admin', $entityId, $before, $after);
    }
}

/** RFC 6238 time-based codes (Google Authenticator, 1Password, Authy…): SHA-1, 6 digits, 30 s. */
final class AdminTotp
{
    private const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    public static function newSecret(): string
    {
        return self::base32Encode(random_bytes(20));
    }

    public static function base32Encode(string $bin): string
    {
        $bits = '';
        foreach (str_split($bin) as $c) $bits .= str_pad(decbin(ord($c)), 8, '0', STR_PAD_LEFT);
        $out = '';
        foreach (str_split($bits, 5) as $chunk) $out .= self::ALPHABET[bindec(str_pad($chunk, 5, '0'))];
        return $out;
    }

    public static function base32Decode(string $b32): string
    {
        $b32 = strtoupper(preg_replace('/[^A-Za-z2-7]/', '', $b32));
        $bits = '';
        foreach (str_split($b32) as $c) {
            $v = strpos(self::ALPHABET, $c);
            if ($v === false) continue;
            $bits .= str_pad(decbin($v), 5, '0', STR_PAD_LEFT);
        }
        $out = '';
        foreach (str_split($bits, 8) as $byte) {
            if (strlen($byte) === 8) $out .= chr(bindec($byte));
        }
        return $out;
    }

    public static function code(string $secret, int $step): string
    {
        $mac = hash_hmac('sha1', pack('J', $step), self::base32Decode($secret), true);
        $o = ord($mac[19]) & 0x0f;
        $n = ((ord($mac[$o]) & 0x7f) << 24) | (ord($mac[$o + 1]) << 16) | (ord($mac[$o + 2]) << 8) | ord($mac[$o + 3]);
        return str_pad((string) ($n % 1_000_000), 6, '0', STR_PAD_LEFT);
    }

    /** The matching step (now ±1), or null. A step not after $lastStep is refused (no replay). */
    public static function verify(string $secret, string $code, ?int $lastStep = null, ?int $now = null): ?int
    {
        $code = preg_replace('/\D/', '', $code);
        if (strlen($code) !== 6) return null;
        $t = intdiv($now ?? time(), 30);
        foreach ([$t, $t - 1, $t + 1] as $step) {
            if ($lastStep !== null && $step <= $lastStep) continue;
            if (hash_equals(self::code($secret, $step), $code)) return $step;
        }
        return null;
    }

    public static function uri(string $secret, string $account): string
    {
        return 'otpauth://totp/' . rawurlencode('Hilads Admin:' . $account)
             . '?secret=' . $secret . '&issuer=' . rawurlencode('Hilads Admin') . '&algorithm=SHA1&digits=6&period=30';
    }
}

/**
 * Admin PHP sessions stored in admin_sessions (survive deploys; "sign out everywhere" deletes rows).
 * The row id is a hash of the cookie value, so the table never holds a usable session id.
 */
final class AdminSessionHandler implements \SessionHandlerInterface
{
    public static ?int $userId = null;

    public static function key(string $sid): string
    {
        return hash('sha256', $sid);
    }

    public function open(string $path, string $name): bool { return true; }
    public function close(): bool { return true; }

    public function read(string $id): string|false
    {
        $st = Database::pdo()->prepare("SELECT data, admin_user_id FROM admin_sessions WHERE id = ? AND last_seen_at > now() - make_interval(secs => ?)");
        $st->execute([self::key($id), AdminAuth::ABSOLUTE_SECONDS]);
        $row = $st->fetch(\PDO::FETCH_ASSOC);
        if (!$row) return '';
        self::$userId = $row['admin_user_id'] !== null ? (int) $row['admin_user_id'] : null;
        return (string) $row['data'];
    }

    public function write(string $id, string $data): bool
    {
        $uid = isset($_SESSION['admin_uid']) ? (int) $_SESSION['admin_uid'] : (self::$userId ?? null);
        Database::pdo()->prepare("
            INSERT INTO admin_sessions (id, admin_user_id, data, ip, user_agent, last_seen_at)
            VALUES (?, ?, ?, ?, ?, now())
            ON CONFLICT (id) DO UPDATE SET admin_user_id = EXCLUDED.admin_user_id, data = EXCLUDED.data,
                ip = EXCLUDED.ip, user_agent = EXCLUDED.user_agent, last_seen_at = now()
        ")->execute([self::key($id), $uid ?: null, $data, AdminAuth::ip(), mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 300)]);
        return true;
    }

    public function destroy(string $id): bool
    {
        Database::pdo()->prepare("DELETE FROM admin_sessions WHERE id = ?")->execute([self::key($id)]);
        return true;
    }

    public function gc(int $max_lifetime): int|false
    {
        $st = Database::pdo()->prepare("DELETE FROM admin_sessions WHERE last_seen_at < now() - make_interval(secs => ?)");
        $st->execute([AdminAuth::ABSOLUTE_SECONDS]);
        return $st->rowCount();
    }
}
