<?php

declare(strict_types=1);

/**
 * UsernameService — validation, normalization, and generation for unique handles.
 *
 * Usernames are the @-mention handle. Stored and compared in a normalized
 * lowercase form; uniqueness is enforced case-insensitively (DB unique index on
 * lower(username)). DB-touching methods accept an optional PDO so migrate.php
 * (which builds its own connection and doesn't autoload Database) can reuse them.
 */
final class UsernameService
{
    public const MIN_LEN = 3;
    public const MAX_LEN = 20;

    // Blocked handles: brand, roles, app routes, support — matched case-insensitively
    // against the normalized form. Keeps impersonation + routing collisions out.
    private const RESERVED = [
        'admin', 'administrator', 'support', 'help', 'helpdesk', 'hilads', 'team',
        'staff', 'mod', 'moderator', 'root', 'system', 'official', 'api', 'www',
        'about', 'settings', 'me', 'everyone', 'here', 'all', 'null', 'undefined',
        'user', 'users', 'guest', 'ghost', 'anonymous', 'login', 'signup', 'logout',
        'auth', 'profile', 'event', 'events', 'pulse', 'pulses', 'city', 'cities',
        'notification', 'notifications',
    ];

    /** Canonical form used for storage and uniqueness comparison. */
    public static function normalize(string $username): string
    {
        return strtolower(trim($username));
    }

    /**
     * Validate FORMAT only (not availability). Returns null when valid, else a
     * human-readable reason. Rules: 3-20 chars; a-z 0-9 underscore; must start
     * and end alphanumeric; no consecutive underscores; not reserved.
     */
    public static function validate(string $username): ?string
    {
        $u   = self::normalize($username);
        $len = strlen($u);
        if ($len < self::MIN_LEN) return 'Username must be at least ' . self::MIN_LEN . ' characters';
        if ($len > self::MAX_LEN) return 'Username must be at most ' . self::MAX_LEN . ' characters';
        if (!preg_match('/^[a-z0-9]+(?:_[a-z0-9]+)*$/', $u)) {
            return 'Use only letters, numbers and single underscores — no spaces, leading/trailing or double underscores';
        }
        if (in_array($u, self::RESERVED, true)) {
            return 'That username is reserved';
        }
        return null;
    }

    public static function isValid(string $username): bool
    {
        return self::validate($username) === null;
    }

    /** Is the (normalized) username free? Pass $excludeUserId to ignore the caller's own row. */
    public static function isAvailable(string $username, ?string $excludeUserId = null, ?\PDO $pdo = null): bool
    {
        $pdo = $pdo ?? Database::pdo();
        $u   = self::normalize($username);
        if ($excludeUserId !== null) {
            $stmt = $pdo->prepare('SELECT 1 FROM users WHERE lower(username) = ? AND id != ? LIMIT 1');
            $stmt->execute([$u, $excludeUserId]);
        } else {
            $stmt = $pdo->prepare('SELECT 1 FROM users WHERE lower(username) = ? LIMIT 1');
            $stmt->execute([$u]);
        }
        return $stmt->fetchColumn() === false;
    }

    /**
     * Turn a display name into a valid base handle (no uniqueness guarantee).
     *   "SleekFlash"        → "sleekflash"
     *   "foggy_friend_1405" → "foggy_friend_1405"
     *   "José!! 22"         → "jose_22"
     * Falls back to "user" when nothing usable remains (the suffix loop in
     * generateUnique then turns the reserved "user" into "user2", etc.).
     */
    public static function slugify(string $displayName): string
    {
        $s = trim($displayName);
        $t = @iconv('UTF-8', 'ASCII//TRANSLIT', $s); // strip accents where possible
        if ($t !== false) $s = $t;
        $s = strtolower($s);
        $s = preg_replace('/[^a-z0-9]+/', '_', $s); // any run of non-alnum → one underscore
        $s = preg_replace('/_+/', '_', $s);          // collapse repeats
        $s = trim($s, '_');                          // no leading/trailing
        if (strlen($s) > self::MAX_LEN) $s = rtrim(substr($s, 0, self::MAX_LEN), '_');
        if (strlen($s) < self::MIN_LEN) $s = 'user';
        return $s;
    }

    /**
     * Generate a unique, valid handle from a base (display name or slug).
     * Tries the slug, then slug2, slug3, … truncating so the numeric suffix
     * keeps the whole within MAX_LEN. Checks availability against the DB.
     */
    public static function generateUnique(string $base, ?\PDO $pdo = null): string
    {
        $slug = self::slugify($base);
        if (self::isValid($slug) && self::isAvailable($slug, null, $pdo)) {
            return $slug;
        }
        for ($n = 2; $n < 100000; $n++) {
            $suffix    = (string) $n;
            $maxBase   = self::MAX_LEN - strlen($suffix);
            $candidate = rtrim(substr($slug, 0, max(1, $maxBase)), '_') . $suffix;
            if (self::isValid($candidate) && self::isAvailable($candidate, null, $pdo)) {
                return $candidate;
            }
        }
        // Practically unreachable fallback.
        return substr($slug, 0, 8) . bin2hex(random_bytes(4));
    }
}
